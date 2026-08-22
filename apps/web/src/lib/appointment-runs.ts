import { and, eq, sql } from "drizzle-orm";
import { schema, type Tx } from "@clinicaos/db";

/**
 * Materializa as runs da cadência de confirmação (24h/2h/45min/pré-cuidados)
 * de um agendamento. Usada pelo painel E pelo agendamento online público —
 * next_run_at é a fila real; o worker revalida tudo na execução.
 */
export async function materializeConfirmationRuns(
  tx: Tx,
  clinicId: string,
  appointmentId: string,
  customerId: string,
  startsAt: Date,
  procedureId?: string | null,
): Promise<void> {
  const enabled = await tx
    .select({ automationId: schema.automationSettings.automationId })
    .from(schema.automationSettings)
    .where(
      and(
        eq(schema.automationSettings.clinicId, clinicId),
        eq(schema.automationSettings.enabled, true),
        sql`${schema.automationSettings.automationId} IN
          ('reminder_24h','confirm_2h','reminder_45min','pre_care')`,
      ),
    );
  const enabledSet = new Set(enabled.map((e) => e.automationId));
  const now = Date.now();
  const untilStart = startsAt.getTime() - now;

  const plan: { automationId: string; offsetMs: number; minGapMs: number }[] = [
    { automationId: "reminder_24h", offsetMs: 24 * 3_600_000, minGapMs: 2 * 3_600_000 },
    { automationId: "confirm_2h", offsetMs: 2 * 3_600_000, minGapMs: 20 * 60_000 },
    { automationId: "reminder_45min", offsetMs: 45 * 60_000, minGapMs: 10 * 60_000 },
  ];

  // Pré-cuidados: só se o procedimento tem texto cadastrado; antecedência configurável
  if (enabledSet.has("pre_care") && procedureId) {
    const proc = (
      await tx
        .select({
          preCare: schema.procedures.preCare,
          hoursBefore: schema.procedures.preCareHoursBefore,
        })
        .from(schema.procedures)
        .where(eq(schema.procedures.id, procedureId))
        .limit(1)
    )[0];
    if (proc?.preCare) {
      plan.push({
        automationId: "pre_care",
        offsetMs: (proc.hoursBefore ?? 24) * 3_600_000,
        minGapMs: 30 * 60_000,
      });
    }
  }

  for (const item of plan) {
    if (!enabledSet.has(item.automationId)) continue;
    const idealAt = startsAt.getTime() - item.offsetMs;
    // Marco que já passou NÃO dispara na hora — "posso confirmar sua
    // presença?" minutos depois de a cliente acabar de marcar é cara de
    // robô; o próximo marco da cadência cobre a confirmação. Exceção:
    // pré-cuidados ainda são úteis na hora se houver folga (informação
    // nova, não pergunta redundante).
    if (idealAt <= now) {
      if (item.automationId !== "pre_care" || untilStart < item.minGapMs) continue;
    }
    const nextRunAt = new Date(Math.max(idealAt, now));
    await tx
      .insert(schema.automationRuns)
      .values({
        clinicId,
        automationId: item.automationId,
        customerId,
        appointmentId,
        nextRunAt,
      })
      .onConflictDoNothing();
  }
}
