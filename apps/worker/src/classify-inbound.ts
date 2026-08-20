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

  // ── Resposta à coleta de feedback (nota 0–10) ────────────────────
  const handled = await maybeHandleFeedbackRating(clinicId, conversation, customerId, text, logger);
  if (handled) return;

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

/**
 * Nota de 0 a 10 respondendo à coleta de feedback:
 * ≥9 → agradece + convite para avaliar no Google (se configurado);
 * ≤8 → alerta "feedback negativo" para a equipe recuperar a cliente.
 */
async function maybeHandleFeedbackRating(
  clinicId: string,
  conversation: typeof schema.conversations.$inferSelect,
  customerId: string,
  text: string,
  logger: Logger,
): Promise<boolean> {
  const match = text.trim().match(/^(?:nota\s*)?(10|[0-9])\s*[!.]*$/i);
  if (!match) return false;
  const rating = Number(match[1]);

  const db = unsafeGlobalDb();
  // Só interpreta como nota se pedimos feedback nas últimas 48h e ainda não agradecemos
  const asked = (
    await db
      .select({ id: schema.messages.id, createdAt: schema.messages.createdAt })
      .from(schema.messages)
      .where(
        and(
          eq(schema.messages.conversationId, conversation.id),
          eq(schema.messages.automationId, "feedback_request"),
          gt(schema.messages.createdAt, new Date(Date.now() - 48 * 3_600_000)),
        ),
      )
      .limit(1)
  )[0];
  if (!asked) return false;
  const thanked = (
    await db
      .select({ id: schema.messages.id })
      .from(schema.messages)
      .where(
        and(
          eq(schema.messages.conversationId, conversation.id),
          eq(schema.messages.automationId, "feedback_thanks"),
          gt(schema.messages.createdAt, asked.createdAt),
        ),
      )
      .limit(1)
  )[0];
  if (thanked) return false;

  const customer = (
    await db
      .select({ fullName: schema.customers.fullName })
      .from(schema.customers)
      .where(eq(schema.customers.id, customerId))
      .limit(1)
  )[0];
  const firstName = customer?.fullName.split(" ")[0] ?? "querida";

  if (rating >= 9) {
    const clinic = (
      await db
        .select({ googleReviewUrl: schema.clinics.googleReviewUrl })
        .from(schema.clinics)
        .where(eq(schema.clinics.id, clinicId))
        .limit(1)
    )[0];
    const body = clinic?.googleReviewUrl
      ? `Ahh que alegria, ${firstName}! 💛 Se puder, nos ajudaria MUITO deixando essa avaliação aqui no Google: ${clinic.googleReviewUrl}`
      : `Ahh que alegria, ${firstName}! 💛 Obrigada demais pelo carinho — até a próxima!`;
    await db.insert(schema.messages).values({
      clinicId,
      conversationId: conversation.id,
      direction: "outbound",
      author: "automation",
      body,
      status: "queued",
      automationId: "feedback_thanks",
      scheduledFor: new Date(Date.now() + 3_000 + Math.floor(Math.random() * 5_000)),
    });
    logger.info({ conversationId: conversation.id, rating }, "feedback positivo → agradecimento");
  } else {
    // Nota baixa NUNCA recebe link de avaliação — vira recuperação humana
    await db
      .update(schema.conversations)
      .set({ mode: "waiting_human" })
      .where(eq(schema.conversations.id, conversation.id));
    await db.insert(schema.notifications).values({
      clinicId,
      type: "conversation_needs_human",
      title: `Feedback negativo de ${customer?.fullName ?? "cliente"} (nota ${rating})`,
      body: "Recuperar essa cliente é tarefa humana — fale com ela com carinho.",
      refTable: "conversations",
      refId: conversation.id,
    });
    logger.warn({ conversationId: conversation.id, rating }, "feedback negativo → humano");
  }
  return true;
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
