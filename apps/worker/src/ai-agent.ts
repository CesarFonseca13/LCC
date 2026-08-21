import { and, asc, desc, eq, gt, gte, inArray, isNotNull, lte, ne, sql } from "drizzle-orm";
import type { Logger } from "pino";
import {
  runAgentTurn,
  type AgentPersona,
  type AgentToolExecutors,
} from "@clinicaos/ai/agent";
import { resolveAiConfig } from "@clinicaos/ai/provider";
import { todayISO, utcToZoned, zonedToUtc } from "@clinicaos/core/timezone";
import { findSlots, parseSlotId, schema, unsafeGlobalDb } from "@clinicaos/db";

/**
 * Turnos da IA conversacional.
 * Debounce no Postgres: cada inbound empurra conversations.ai_turn_after;
 * o sweep processa turnos vencidos — humanos mandam 3 mensagens picadas,
 * a assistente responde ao conjunto.
 */

const DEBOUNCE_MS = 10_000;

export function aiEnabled(): boolean {
  return resolveAiConfig(process.env) !== null;
}

interface ClinicAiSettings {
  enabled: boolean;
  assistantName: string;
  tone: AgentPersona["tone"];
}

function parseAiSettings(settings: unknown): ClinicAiSettings {
  const ai = ((settings ?? {}) as Record<string, unknown>).ai as
    | Record<string, unknown>
    | undefined;
  const tone = ai?.tone;
  return {
    enabled: ai?.enabled === true,
    assistantName:
      typeof ai?.assistantName === "string" && ai.assistantName.trim()
        ? ai.assistantName.trim()
        : "Ana",
    tone: tone === "elegante" || tone === "animada" ? tone : "acolhedora",
  };
}

/** Chamado no inbound: agenda (ou empurra) o turno da conversa. */
export async function scheduleAiTurn(conversationId: string): Promise<void> {
  const db = unsafeGlobalDb();
  await db
    .update(schema.conversations)
    .set({ aiTurnAfter: new Date(Date.now() + DEBOUNCE_MS) })
    .where(eq(schema.conversations.id, conversationId));
}

/** A clínica tem IA ligada? (persona configurada em Configurações) */
export async function clinicHasAiEnabled(clinicId: string): Promise<boolean> {
  if (!aiEnabled()) return false;
  const db = unsafeGlobalDb();
  const clinic = (
    await db
      .select({ settings: schema.clinics.settings })
      .from(schema.clinics)
      .where(eq(schema.clinics.id, clinicId))
      .limit(1)
  )[0];
  return clinic ? parseAiSettings(clinic.settings).enabled : false;
}

/** Sweep: processa conversas com turno vencido. */
export async function processAiTurns(logger: Logger): Promise<void> {
  if (!aiEnabled()) return;
  const db = unsafeGlobalDb();
  const due = await db
    .select({ id: schema.conversations.id })
    .from(schema.conversations)
    .where(
      and(isNotNull(schema.conversations.aiTurnAfter), lte(schema.conversations.aiTurnAfter, new Date())),
    )
    .limit(5);

  for (const { id } of due) {
    // Claim: zera o marcador; se chegar mensagem nova durante o turno, ele volta
    const claimed = await db
      .update(schema.conversations)
      .set({ aiTurnAfter: null })
      .where(
        and(
          eq(schema.conversations.id, id),
          isNotNull(schema.conversations.aiTurnAfter),
          lte(schema.conversations.aiTurnAfter, new Date()),
        ),
      )
      .returning();
    const conversation = claimed[0];
    if (!conversation) continue;

    try {
      await runTurn(conversation, logger);
    } catch (err) {
      logger.error(
        { conversationId: id, err: err instanceof Error ? err.message : String(err) },
        "falha no turno da IA",
      );
    }
  }
}

type ConversationRow = typeof schema.conversations.$inferSelect;

async function runTurn(conversation: ConversationRow, logger: Logger): Promise<void> {
  const db = unsafeGlobalDb();
  if (conversation.mode !== "ai" || !conversation.customerId) return;

  const clinic = (
    await db
      .select()
      .from(schema.clinics)
      .where(eq(schema.clinics.id, conversation.clinicId))
      .limit(1)
  )[0];
  if (!clinic) return;
  const aiSettings = parseAiSettings(clinic.settings);
  if (!aiSettings.enabled) return;

  // Kill-switch mensal de custo
  const capTokens = Number(process.env.AI_MONTHLY_TOKEN_CAP ?? 5_000_000);
  const monthStart = `${todayISO(clinic.timezone).slice(0, 7)}-01`;
  const used = (
    await db
      .select({
        total: sql<number>`COALESCE(sum(input_tokens + output_tokens), 0)::int`,
      })
      .from(schema.aiUsage)
      .where(
        and(
          eq(schema.aiUsage.clinicId, conversation.clinicId),
          gte(schema.aiUsage.createdAt, zonedToUtc(monthStart, "00:00", clinic.timezone)),
        ),
      )
  )[0];
  if ((used?.total ?? 0) >= capTokens) {
    logger.warn({ clinicId: conversation.clinicId }, "cap mensal de IA atingido — turno vai p/ humano");
    await db
      .update(schema.conversations)
      .set({ mode: "waiting_human" })
      .where(eq(schema.conversations.id, conversation.id));
    await db.insert(schema.notifications).values({
      clinicId: conversation.clinicId,
      type: "conversation_needs_human",
      title: "Limite mensal da assistente atingido",
      body: "As conversas passam para atendimento humano até o próximo mês (ou aumento do limite).",
      refTable: "conversations",
      refId: conversation.id,
    });
    return;
  }

  const customer = (
    await db
      .select()
      .from(schema.customers)
      .where(eq(schema.customers.id, conversation.customerId))
      .limit(1)
  )[0];
  if (!customer || customer.optedOutAt) return;

  const tz = clinic.timezone;

  // ── Contexto ─────────────────────────────────────────────────────
  const procedures = await db
    .select({
      id: schema.procedures.id,
      name: schema.procedures.name,
      price: schema.procedures.price,
      durationMinutes: schema.procedures.durationMinutes,
    })
    .from(schema.procedures)
    .where(and(eq(schema.procedures.clinicId, clinic.id), eq(schema.procedures.active, true)));

  const upcoming = (
    await db
      .select()
      .from(schema.appointments)
      .where(
        and(
          eq(schema.appointments.customerId, customer.id),
          inArray(schema.appointments.status, ["scheduled", "confirmed"]),
          gt(schema.appointments.startsAt, new Date()),
        ),
      )
      .orderBy(asc(schema.appointments.startsAt))
      .limit(1)
  )[0];

  let upcomingLabel: string | null = null;
  let activeGoal: string | null = null;
  if (upcoming) {
    const z = utcToZoned(new Date(upcoming.startsAt), tz);
    const [, m, d] = z.dateISO.split("-");
    const procName =
      procedures.find((p) => p.id === upcoming.procedureId)?.name ?? "atendimento";
    upcomingLabel = `${procName}, ${d}/${m} às ${z.timeHHMM} — status ${
      upcoming.status === "confirmed" ? "confirmado" : "aguardando confirmação"
    } (id: ${upcoming.id})`;
    if (upcoming.status === "scheduled") {
      activeGoal = `obter a confirmação de presença do agendamento de ${d}/${m} às ${z.timeHHMM}`;
    }
  }

  const packages = await db
    .select({
      sessionsTotal: schema.customerPackages.sessionsTotal,
      sessionsUsed: schema.customerPackages.sessionsUsed,
      packageName: schema.packages.name,
    })
    .from(schema.customerPackages)
    .innerJoin(schema.packages, eq(schema.packages.id, schema.customerPackages.packageId))
    .where(
      and(
        eq(schema.customerPackages.customerId, customer.id),
        eq(schema.customerPackages.status, "active"),
      ),
    );
  const packageSummary =
    packages.length > 0
      ? packages
          .map(
            (p) => `${p.packageName}: ${p.sessionsTotal - p.sessionsUsed} sessões restantes`,
          )
          .join("; ")
      : null;

  const visits = (
    await db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.customerHistoryEntries)
      .where(eq(schema.customerHistoryEntries.customerId, customer.id))
  )[0];

  const historyRows = await db
    .select({
      direction: schema.messages.direction,
      author: schema.messages.author,
      body: schema.messages.body,
      type: schema.messages.type,
    })
    .from(schema.messages)
    .where(
      and(
        eq(schema.messages.conversationId, conversation.id),
        inArray(schema.messages.status, ["received", "sent", "delivered", "read"]),
      ),
    )
    .orderBy(desc(schema.messages.createdAt))
    .limit(30);
  const history = historyRows
    .reverse()
    .filter((m) => m.body)
    .map((m) => ({
      role: m.direction === "inbound" ? ("customer" as const) : ("assistant" as const),
      text: m.body!,
    }));
  if (history.length === 0 || history[history.length - 1]!.role !== "customer") return;

  const nowZ = utcToZoned(new Date(), tz);
  const weekdays = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
  const [ny, nm, nd] = nowZ.dateISO.split("-");

  const businessHoursLabel = businessHoursToLabel(
    (clinic.businessHours ?? {}) as Record<string, [string, string][]>,
  );

  // ── Executores das ferramentas ───────────────────────────────────
  let escalationReason: string | null = null;
  const executors: AgentToolExecutors = {
    async consultarHorarios(procedimentoNome) {
      const proc = matchProcedure(procedures, procedimentoNome);
      if (!proc) {
        return `Procedimento não encontrado no catálogo. Opções: ${procedures.map((p) => p.name).join(", ")}.`;
      }
      const slots = await findSlots(db, clinic.id, tz, proc.durationMinutes);
      if (slots.length === 0) {
        return "Nenhum horário livre nos próximos 7 dias — ofereça passar para a equipe verificar outras opções.";
      }
      return `Horários livres para ${proc.name}:\n${slots
        .map((s) => `- ${s.label} [slot_id: ${s.slotId}]`)
        .join("\n")}`;
    },

    async agendar(slotId, procedimentoNome) {
      const proc = matchProcedure(procedures, procedimentoNome);
      if (!proc) throw new Error("Procedimento não encontrado.");
      const parsed = parseSlotId(slotId);
      if (!parsed) throw new Error("slot_id inválido — consulte os horários de novo.");
      const startsAt = new Date(parsed.startISO);
      if (startsAt.getTime() < Date.now()) throw new Error("Esse horário já passou.");
      const endsAt = new Date(startsAt.getTime() + proc.durationMinutes * 60_000);

      const [created] = await db
        .insert(schema.appointments)
        .values({
          clinicId: clinic.id,
          customerId: customer.id,
          professionalId: parsed.professionalId,
          procedureId: proc.id,
          startsAt,
          endsAt,
          price: proc.price,
          origin: "ai_agent",
        })
        .returning({ id: schema.appointments.id });
      if (!created) throw new Error("Não consegui agendar — o horário pode ter sido ocupado.");
      await db.insert(schema.appointmentStatusHistory).values({
        clinicId: clinic.id,
        appointmentId: created.id,
        fromStatus: null,
        toStatus: "scheduled",
        source: "ai_agent",
      });
      await materializeRuns(clinic.id, created.id, customer.id, startsAt);
      const z = utcToZoned(startsAt, tz);
      const [, m2, d2] = z.dateISO.split("-");
      return `Agendado com sucesso: ${proc.name} em ${d2}/${m2} às ${z.timeHHMM} (id: ${created.id}).`;
    },

    async reagendar(agendamentoId, slotId) {
      const original = (
        await db
          .select()
          .from(schema.appointments)
          .where(
            and(
              eq(schema.appointments.id, agendamentoId),
              eq(schema.appointments.customerId, customer.id),
            ),
          )
          .limit(1)
      )[0];
      if (!original || !["scheduled", "confirmed"].includes(original.status)) {
        throw new Error("Agendamento não encontrado ou não pode ser remarcado.");
      }
      const parsed = parseSlotId(slotId);
      if (!parsed) throw new Error("slot_id inválido — consulte os horários de novo.");
      const startsAt = new Date(parsed.startISO);
      const duration =
        new Date(original.endsAt).getTime() - new Date(original.startsAt).getTime();

      await db
        .update(schema.appointments)
        .set({ status: "rescheduled", statusChangedAt: new Date() })
        .where(eq(schema.appointments.id, original.id));
      await db
        .update(schema.automationRuns)
        .set({ status: "cancelled", stopReason: "remarcado pela IA", nextRunAt: null, finishedAt: new Date() })
        .where(
          and(
            eq(schema.automationRuns.appointmentId, original.id),
            eq(schema.automationRuns.status, "active"),
          ),
        );
      const [created] = await db
        .insert(schema.appointments)
        .values({
          clinicId: clinic.id,
          customerId: customer.id,
          professionalId: parsed.professionalId,
          procedureId: original.procedureId,
          startsAt,
          endsAt: new Date(startsAt.getTime() + duration),
          price: original.price,
          customerPackageId: original.customerPackageId,
          origin: "ai_agent",
        })
        .returning({ id: schema.appointments.id });
      if (!created) throw new Error("Não consegui remarcar — o horário pode ter sido ocupado.");
      await db
        .update(schema.appointments)
        .set({ rescheduledToId: created.id })
        .where(eq(schema.appointments.id, original.id));
      await db.insert(schema.appointmentStatusHistory).values({
        clinicId: clinic.id,
        appointmentId: created.id,
        fromStatus: null,
        toStatus: "scheduled",
        source: "ai_agent",
        reason: "reagendamento via assistente",
      });
      await materializeRuns(clinic.id, created.id, customer.id, startsAt);
      const z = utcToZoned(startsAt, tz);
      const [, m2, d2] = z.dateISO.split("-");
      return `Remarcado para ${d2}/${m2} às ${z.timeHHMM}.`;
    },

    async cancelar(agendamentoId, motivo) {
      const updated = await db
        .update(schema.appointments)
        .set({ status: "cancelled", statusChangedAt: new Date(), cancelReason: motivo })
        .where(
          and(
            eq(schema.appointments.id, agendamentoId),
            eq(schema.appointments.customerId, customer.id),
            inArray(schema.appointments.status, ["scheduled", "confirmed"]),
          ),
        )
        .returning({ id: schema.appointments.id });
      if (!updated[0]) throw new Error("Agendamento não encontrado.");
      await db.insert(schema.appointmentStatusHistory).values({
        clinicId: clinic.id,
        appointmentId: agendamentoId,
        fromStatus: "scheduled",
        toStatus: "cancelled",
        source: "ai_agent",
        reason: motivo,
      });
      await db
        .update(schema.automationRuns)
        .set({ status: "cancelled", stopReason: "cancelado pela cliente", nextRunAt: null, finishedAt: new Date() })
        .where(
          and(
            eq(schema.automationRuns.appointmentId, agendamentoId),
            eq(schema.automationRuns.status, "active"),
          ),
        );
      return "Cancelado com sucesso.";
    },

    async confirmarPresenca(agendamentoId) {
      const updated = await db
        .update(schema.appointments)
        .set({ status: "confirmed", statusChangedAt: new Date() })
        .where(
          and(
            eq(schema.appointments.id, agendamentoId),
            eq(schema.appointments.customerId, customer.id),
            eq(schema.appointments.status, "scheduled"),
          ),
        )
        .returning({ id: schema.appointments.id });
      if (!updated[0]) return "Esse agendamento já está confirmado.";
      await db.insert(schema.appointmentStatusHistory).values({
        clinicId: clinic.id,
        appointmentId: agendamentoId,
        fromStatus: "scheduled",
        toStatus: "confirmed",
        source: "customer_whatsapp",
      });
      await db
        .update(schema.automationRuns)
        .set({ status: "goal_reached", stopReason: "confirmado via assistente", nextRunAt: null, finishedAt: new Date() })
        .where(
          and(
            eq(schema.automationRuns.appointmentId, agendamentoId),
            eq(schema.automationRuns.status, "active"),
          ),
        );
      return "Presença confirmada.";
    },

    async consultarPacote() {
      return packageSummary ?? "A cliente não tem pacotes ativos.";
    },

    async escalarParaHumano(motivo, urgencia) {
      escalationReason = motivo;
      await db
        .update(schema.conversations)
        .set({ mode: "waiting_human" })
        .where(eq(schema.conversations.id, conversation.id));
      await db.insert(schema.notifications).values({
        clinicId: clinic.id,
        type: "conversation_needs_human",
        title: `${customer.fullName} precisa de você no WhatsApp${urgencia === "alta" ? " (urgente)" : ""}`,
        body: motivo,
        refTable: "conversations",
        refId: conversation.id,
      });
      return "Conversa passada para a equipe. Diga à cliente que alguém da equipe já vai falar com ela.";
    },

    async registrarOptOut() {
      await db
        .update(schema.customers)
        .set({ optedOutAt: new Date() })
        .where(eq(schema.customers.id, customer.id));
      await db
        .update(schema.automationRuns)
        .set({ status: "cancelled", stopReason: "opt-out", nextRunAt: null, finishedAt: new Date() })
        .where(
          and(
            eq(schema.automationRuns.customerId, customer.id),
            eq(schema.automationRuns.status, "active"),
          ),
        );
      return "Opt-out registrado. Despeça-se com carinho e diga que ela pode chamar quando quiser.";
    },
  };

  // ── Chamada do agente ────────────────────────────────────────────
  const aiConfig = resolveAiConfig(process.env);
  if (!aiConfig) return; // aiEnabled() já barrou antes — cinto de segurança

  const reply = await runAgentTurn(
    {
      persona: { assistantName: aiSettings.assistantName, tone: aiSettings.tone },
      clinic: {
        name: clinic.name,
        city: clinic.addressCity,
        businessHoursLabel,
        catalog: procedures.map((p) => ({
          name: p.name,
          price: Number(p.price).toLocaleString("pt-BR", { minimumFractionDigits: 2 }),
          durationMinutes: p.durationMinutes,
        })),
      },
      customer: {
        firstName: customer.fullName.split(" ")[0] ?? customer.fullName,
        isNew: customer.status === "lead" && (visits?.count ?? 0) === 0,
        visitsCount: visits?.count ?? 0,
        upcomingAppointment: upcomingLabel,
        activeGoal,
        packageSummary,
      },
      nowLabel: `${weekdays[nowZ.weekday]}, ${nd}/${nm}/${ny}, ${nowZ.timeHHMM} (horário de Brasília)`,
      history,
    },
    executors,
    { config: aiConfig },
  );

  await db.insert(schema.aiUsage).values({
    clinicId: clinic.id,
    purpose: "agent",
    model: aiConfig.agentModel,
    inputTokens: reply.usage.inputTokens,
    outputTokens: reply.usage.outputTokens,
  });

  // Interrupção: chegou mensagem nova durante o turno? Descarta os balões.
  const fresh = (
    await db
      .select({ aiTurnAfter: schema.conversations.aiTurnAfter })
      .from(schema.conversations)
      .where(eq(schema.conversations.id, conversation.id))
      .limit(1)
  )[0];
  if (fresh?.aiTurnAfter) {
    logger.info({ conversationId: conversation.id }, "turno interrompido por mensagem nova");
    return;
  }

  // Releitura AO VIVO antes de falar: se uma humana assumiu a conversa (takeover)
  // ou a cliente mandou mensagem nova durante o turno, a resposta é descartada —
  // a IA nunca fala por cima de ninguém
  const live = (
    await db
      .select({
        mode: schema.conversations.mode,
        lastInboundAt: schema.conversations.lastInboundAt,
      })
      .from(schema.conversations)
      .where(eq(schema.conversations.id, conversation.id))
      .limit(1)
  )[0];
  if (
    !live ||
    live.mode !== "ai" ||
    (live.lastInboundAt &&
      conversation.lastInboundAt &&
      live.lastInboundAt > conversation.lastInboundAt)
  ) {
    logger.info(
      { conversationId: conversation.id, mode: live?.mode },
      "turno da IA descartado (takeover ou nova mensagem durante o turno)",
    );
    return;
  }

  // Balões: espaçados 2.5–5s entre si (nunca rajada)
  let offset = 2_000 + Math.floor(Math.random() * 3_000);
  for (const balloon of reply.balloons) {
    await db.insert(schema.messages).values({
      clinicId: clinic.id,
      conversationId: conversation.id,
      direction: "outbound",
      author: "ai",
      body: balloon,
      status: "queued",
      automationId: "ai_agent",
      scheduledFor: new Date(Date.now() + offset),
    });
    offset += 2_500 + Math.floor(Math.random() * 2_500);
  }
  await db
    .update(schema.conversations)
    .set({ lastMessageAt: new Date() })
    .where(eq(schema.conversations.id, conversation.id));

  logger.info(
    {
      conversationId: conversation.id,
      balloons: reply.balloons.length,
      escalated: reply.escalated,
      reason: escalationReason,
      tokens: reply.usage,
    },
    "turno da IA concluído",
  );
}

// ── Utilitários ──────────────────────────────────────────────────────

function matchProcedure(
  procedures: { id: string; name: string; price: string; durationMinutes: number }[],
  name: string | null,
) {
  if (!name) return procedures[0] ?? null;
  const normalized = name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
  return (
    procedures.find((p) => {
      const pn = p.name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
      return pn === normalized || pn.includes(normalized) || normalized.includes(pn);
    }) ?? null
  );
}

function businessHoursToLabel(hours: Record<string, [string, string][]>): string {
  const week = hours.mon?.[0];
  const sat = hours.sat?.[0];
  const parts: string[] = [];
  if (week) parts.push(`segunda a sexta das ${week[0]} às ${week[1]}`);
  if (sat) parts.push(`sábado das ${sat[0]} às ${sat[1]}`);
  return parts.length > 0 ? parts.join(", ") : "segunda a sexta em horário comercial";
}

/** Materializa a cadência de confirmação (mesma regra da criação pelo painel). */
async function materializeRuns(
  clinicId: string,
  appointmentId: string,
  customerId: string,
  startsAt: Date,
): Promise<void> {
  const db = unsafeGlobalDb();
  const enabled = await db
    .select({ automationId: schema.automationSettings.automationId })
    .from(schema.automationSettings)
    .where(
      and(
        eq(schema.automationSettings.clinicId, clinicId),
        eq(schema.automationSettings.enabled, true),
        inArray(schema.automationSettings.automationId, [
          "reminder_24h",
          "confirm_2h",
          "reminder_45min",
        ]),
      ),
    );
  const enabledSet = new Set(enabled.map((e) => e.automationId));
  const now = Date.now();
  const untilStart = startsAt.getTime() - now;
  const plan = [
    { automationId: "reminder_24h", offsetMs: 24 * 3_600_000, minGapMs: 2 * 3_600_000 },
    { automationId: "confirm_2h", offsetMs: 2 * 3_600_000, minGapMs: 20 * 60_000 },
    { automationId: "reminder_45min", offsetMs: 45 * 60_000, minGapMs: 10 * 60_000 },
  ];
  for (const item of plan) {
    if (!enabledSet.has(item.automationId)) continue;
    const idealAt = startsAt.getTime() - item.offsetMs;
    if (idealAt <= now && untilStart < item.minGapMs) continue;
    await db
      .insert(schema.automationRuns)
      .values({
        clinicId,
        automationId: item.automationId,
        customerId,
        appointmentId,
        nextRunAt: new Date(Math.max(idealAt, now)),
      })
      .onConflictDoNothing();
  }
}

