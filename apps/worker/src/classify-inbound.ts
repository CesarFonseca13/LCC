import { and, asc, eq, gt, inArray } from "drizzle-orm";
import type { Logger } from "pino";
import { classifyReply } from "@clinicaos/ai/classify";
import { renderTemplate } from "@clinicaos/core/template-render";
import { utcToZoned } from "@clinicaos/core/timezone";
import { schema, unsafeGlobalDb } from "@clinicaos/db";

/**
 * Classifica a resposta da cliente (Fase 1 — sem conversa livre):
 *  - confirmação → agendamento confirmado + cadência goal_reached + resposta simpática
 *  - qualquer outra coisa → conversa marcada "precisa de você" + notificação
 * Nunca age no escuro: ambíguo vai para humano.
 */
export async function classifyInbound(
  clinicId: string,
  conversationId: string,
  customerId: string,
  text: string,
  logger: Logger,
): Promise<void> {
  const db = unsafeGlobalDb();

  const conversation = (
    await db
      .select()
      .from(schema.conversations)
      .where(eq(schema.conversations.id, conversationId))
      .limit(1)
  )[0];
  // Só classifica quando o atendimento automático está no controle
  if (!conversation || conversation.mode !== "ai") return;

  const appointment = (
    await db
      .select()
      .from(schema.appointments)
      .where(
        and(
          eq(schema.appointments.customerId, customerId),
          inArray(schema.appointments.status, ["scheduled", "confirmed"]),
          gt(schema.appointments.startsAt, new Date()),
        ),
      )
      .orderBy(asc(schema.appointments.startsAt))
      .limit(1)
  )[0];

  const clinic = (
    await db
      .select({ name: schema.clinics.name, timezone: schema.clinics.timezone })
      .from(schema.clinics)
      .where(eq(schema.clinics.id, clinicId))
      .limit(1)
  )[0];
  const tz = clinic?.timezone ?? "America/Sao_Paulo";

  let when = "";
  let procedureName: string | null = null;
  if (appointment) {
    const zoned = utcToZoned(new Date(appointment.startsAt), tz);
    const [, m, d] = zoned.dateISO.split("-");
    when = `${d}/${m} às ${zoned.timeHHMM}`;
    if (appointment.procedureId) {
      procedureName =
        (
          await db
            .select({ name: schema.procedures.name })
            .from(schema.procedures)
            .where(eq(schema.procedures.id, appointment.procedureId))
            .limit(1)
        )[0]?.name ?? null;
    }
  }

  const { intent, via } = await classifyReply(
    text,
    { procedureName, appointmentWhen: when },
    process.env.ANTHROPIC_API_KEY || undefined,
  );
  logger.info({ conversationId, intent, via }, "resposta classificada");

  if (intent === "confirm" && appointment && appointment.status === "scheduled") {
    await confirmAppointment(clinicId, conversationId, customerId, appointment.id, tz, logger);
    return;
  }
  if (intent === "confirm" && appointment) {
    // Já estava confirmado — nada a fazer, não incomoda ninguém
    return;
  }

  // Tudo que não é confirmação vira atendimento humano (Fase 1)
  await db
    .update(schema.conversations)
    .set({ mode: "waiting_human" })
    .where(
      and(eq(schema.conversations.id, conversationId), eq(schema.conversations.mode, "ai")),
    );

  const customer = (
    await db
      .select({ name: schema.customers.fullName })
      .from(schema.customers)
      .where(eq(schema.customers.id, customerId))
      .limit(1)
  )[0];
  const reasonLabel: Record<string, string> = {
    cancel: "quer cancelar",
    reschedule: "quer remarcar",
    question: "fez uma pergunta",
    other: "enviou uma mensagem",
  };
  await db.insert(schema.notifications).values({
    clinicId,
    type: "conversation_needs_human",
    title: `${customer?.name ?? "Cliente"} precisa de você no WhatsApp`,
    body: `${reasonLabel[intent] ?? "enviou uma mensagem"}: "${text.slice(0, 120)}"`,
    refTable: "conversations",
    refId: conversationId,
  });
}

async function confirmAppointment(
  clinicId: string,
  conversationId: string,
  customerId: string,
  appointmentId: string,
  tz: string,
  logger: Logger,
): Promise<void> {
  const db = unsafeGlobalDb();

  // FSM: scheduled → confirmed, com fonte auditável "customer_whatsapp"
  const updated = await db
    .update(schema.appointments)
    .set({ status: "confirmed", statusChangedAt: new Date() })
    .where(
      and(eq(schema.appointments.id, appointmentId), eq(schema.appointments.status, "scheduled")),
    )
    .returning();
  const appointment = updated[0];
  if (!appointment) return;

  await db.insert(schema.appointmentStatusHistory).values({
    clinicId,
    appointmentId,
    fromStatus: "scheduled",
    toStatus: "confirmed",
    source: "customer_whatsapp",
  });

  // Cadência de confirmação: objetivo atingido (a cobrança de 2h morre aqui)
  await db
    .update(schema.automationRuns)
    .set({
      status: "goal_reached",
      stopReason: "cliente confirmou pelo WhatsApp",
      nextRunAt: null,
      finishedAt: new Date(),
    })
    .where(
      and(
        eq(schema.automationRuns.appointmentId, appointmentId),
        eq(schema.automationRuns.status, "active"),
      ),
    );

  // Resposta simpática (reativa = direct-send, nunca passa por aprovação)
  const setting = (
    await db
      .select()
      .from(schema.automationSettings)
      .where(
        and(
          eq(schema.automationSettings.clinicId, clinicId),
          eq(schema.automationSettings.automationId, "reply_on_confirm"),
        ),
      )
      .limit(1)
  )[0];
  const replyEnabled = setting?.enabled ?? true; // respostas reativas: ligadas por default
  if (!replyEnabled) {
    logger.info({ appointmentId }, "confirmado via WhatsApp (resposta automática desligada)");
    return;
  }

  const definition = (
    await db
      .select()
      .from(schema.automationDefinitions)
      .where(eq(schema.automationDefinitions.id, "reply_on_confirm"))
      .limit(1)
  )[0];
  const customer = (
    await db
      .select({ fullName: schema.customers.fullName })
      .from(schema.customers)
      .where(eq(schema.customers.id, customerId))
      .limit(1)
  )[0];
  if (!definition || !customer) return;

  const zoned = utcToZoned(new Date(appointment.startsAt), tz);
  const [y, m, d] = zoned.dateISO.split("-");
  const body = renderTemplate(
    setting?.messageTemplate ?? definition.defaultTemplate,
    {
      nome: customer.fullName.split(" ")[0] ?? customer.fullName,
      data: `${d}/${m}/${y}`,
      hora: zoned.timeHHMM,
    },
    { html: false },
  );

  await db.insert(schema.messages).values({
    clinicId,
    conversationId,
    direction: "outbound",
    author: "automation",
    body,
    status: "queued",
    automationId: "reply_on_confirm",
    // Resposta rápida, mas nunca instantânea demais (3–10s)
    scheduledFor: new Date(Date.now() + 3_000 + Math.floor(Math.random() * 7_000)),
  });
  logger.info({ appointmentId }, "confirmado via WhatsApp + resposta enviada");
}
