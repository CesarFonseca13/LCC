import { and, asc, desc, eq, gt, inArray, isNotNull, lte, sql } from "drizzle-orm";
import type { Logger } from "pino";
import { classifyByKeywords, classifyReply } from "@clinicaos/ai/classify";
import { parseClinicAiProvider, resolveClinicAiConfig } from "@clinicaos/ai/provider";
import { renderTemplate } from "@clinicaos/core/template-render";
import { utcToZoned } from "@clinicaos/core/timezone";
import { schema, unsafeGlobalDb } from "@clinicaos/db";
import { flagUrgentIfHealth, isCourtesyOnly, storedMessageTriggersTurn } from "./media-escalation";
import { getSpendStatus, recordAiUsage } from "./spend";

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
  if (!conversation) return;
  // Só classifica quando o atendimento automático está no controle. Conversa já
  // esperando a equipe: "confirmo" em resposta ao lembrete confirma (com travas) e
  // queixa de saúde que chegar agora vira URGENTE no painel
  if (conversation.mode !== "ai") {
    if (conversation.mode === "waiting_human") {
      await flagUrgentIfHealth(clinicId, conversationId, customerId, logger);
      await confirmReminderReplyWhileWaiting(clinicId, conversationId, customerId, logger).catch((err) =>
        logger.warn({ conversationId, err: err instanceof Error ? err.message : String(err) }, "confirmação pelo lembrete falhou"),
      );
    }
    return;
  }

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
      .select({
        name: schema.clinics.name,
        timezone: schema.clinics.timezone,
        settings: schema.clinics.settings,
      })
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

  // Passou do limite de gastos sem excedente liberado? Só palavras-chave (grátis).
  const spendBlocked = clinic
    ? (await getSpendStatus({ id: clinicId, timezone: clinic.timezone, settings: clinic.settings })).blocked
    : false;
  const { intent, via } = await classifyReply(
    text,
    { procedureName, appointmentWhen: when },
    spendBlocked ? null : resolveClinicAiConfig(clinic?.settings, process.env),
    ({ model, ...usage }) => {
      void recordAiUsage({
        clinicId,
        purpose: "classifier",
        model,
        usage,
        ownKey: parseClinicAiProvider(clinic?.settings).mode === "custom",
      }).catch((err) => logger.warn({ err }, "registro de uso do classificador falhou"));
    },
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

/** Lembretes que pedem confirmação de presença. */
const CONFIRMATION_REMINDERS = ["reminder_24h", "confirm_2h"];

/** Texto sem acento, minúsculas, pontuação vira espaço (mantém 👍 e ✅). */
function plain(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s👍✅]/gu, " ")
    .replace(/👍|✅/gu, (e) => ` ${e} `)
    .replace(/\s+/g, " ")
    .trim();
}

/** Confirmação FORTE como mensagem INTEIRA ("Sim, confirmo!", "Confirmo minha
 *  presença 👍"). Nunca trecho de frase: "depois te confirmo", "não confirmo
 *  ainda" e "não estarei aí" não podem confirmar. */
const STRONG_CONFIRM_RE =
  /^(s+i+m+ )?(confirmo|confirmad[oa]|pode confirmar|estarei (ai|la)|vou sim|presenca confirmada|confirmo (a )?(minha )?presenca)( (sim|obrigad[ao]))*( (👍|✅))*$/u;
/** Confirmação FRACA ("sim", "ok", 👍): só vale como resposta direta ao lembrete. */
const WEAK_CONFIRM_RE =
  /^(s+i+m+|s|ok|okay|blz|beleza|perfeito|fechado|combinado|claro|com certeza|pode ser|certo|isso|👍|✅)( (sim|obrigad[ao]|👍|✅))*$/u;
/** Cumprimento solto, que não muda nada. */
const GREETING_RE = /^(oi+|ola|bom dia|boa tarde|boa noite)( tudo bem)?$/;

/**
 * Decide, só com o que a cliente escreveu, se dá para confirmar sozinho com
 * segurança. Regras: TODA mensagem dela desde o lembrete é confirmação, cortesia
 * ("obrigada") ou cumprimento — qualquer outra coisa (recusa sem palavra-chave,
 * "não vai dar", dúvida, queixa, pedido) deixa com a equipe; entre as mensagens
 * que chegaram depois da última fala da clínica há uma confirmação; e, se a
 * clínica falou depois do lembrete, essa confirmação precisa ser explícita
 * ("ok" pode ser resposta à atendente). Puro: testável sem banco.
 */
export function reminderReplyConfirms(
  windowTexts: string[],
  candidateTexts: string[],
  clinicSpokeAfterReminder: boolean,
): boolean {
  if (windowTexts.length === 0 || candidateTexts.length === 0) return false;
  const kind = (t: string): "strong" | "weak" | "neutral" | "other" => {
    if (t.includes("?")) return "other"; // pergunta nunca é confirmação ("pode confirmar?")
    const p = plain(t);
    if (STRONG_CONFIRM_RE.test(p)) return "strong";
    if (WEAK_CONFIRM_RE.test(p)) return "weak";
    if (GREETING_RE.test(p) || isCourtesyOnly(t)) return "neutral";
    return "other";
  };
  if (windowTexts.some((t) => kind(t) === "other")) return false;
  const kinds = candidateTexts.map(kind);
  return clinicSpokeAfterReminder ? kinds.includes("strong") : kinds.some((k) => k === "strong" || k === "weak");
}

/** Saída que a cliente vê ou vai ver (aprovação pendente, recusada, expirada ou
 *  falha não contam como "a clínica falou"). */
const VISIBLE_OUTBOUND = new Set(["queued", "sending", "sent", "delivered", "read"]);

/** Texto da cliente pedindo para cancelar/remarcar (mesmas palavras do classificador). */
export function asksToChangeAppointment(text: string): boolean {
  const intent = classifyByKeywords(text);
  return intent === "cancel" || intent === "reschedule";
}

/** O motivo da espera (aviso da equipe) é cancelar/remarcar? Lê palavra-chave, o
 *  motivo livre que a atendente escreve ("quer trocar o horário", "pediu para
 *  adiar", "não poderá comparecer") e a legenda citada no aviso. */
export function noticeIsAboutChangingAppointment(body: string): boolean {
  const p = plain(body);
  if (/remarc|reagend|cancel|desmarc/.test(p)) return true;
  if (/\bnao (vai|pode|podera|consegue|conseguira) (ir|comparecer|vir)\b|\bfalt(ar|ara)\b/.test(p)) return true;
  return asksToChangeAppointment(body);
}

/**
 * Conversa esperando a equipe ("precisa de você" — a cliente mandou um anexo, por
 * exemplo) e a cliente responde ao LEMBRETE com "confirmo": confirma o agendamento
 * DAQUELE lembrete, em silêncio (a equipe responde junto com o assunto pendente).
 * Travas: lembrete de confirmação ENVIADO nas últimas 48 h; ninguém da equipe
 * escreveu depois dele; o motivo da espera não é cancelar/remarcar; toda mensagem
 * dela desde o lembrete é confirmação/cortesia/cumprimento (reminderReplyConfirms);
 * agendamento ainda "agendado" e no futuro. Vale com e sem atendente virtual.
 * Devolve true se confirmou.
 */
export async function confirmReminderReplyWhileWaiting(
  clinicId: string,
  conversationId: string,
  customerId: string,
  logger: Logger,
): Promise<boolean> {
  const db = unsafeGlobalDb();
  // Hora em que o lembrete SAIU (com Aprovações, ele pode ter sido criado bem antes)
  const sentAtExpr = sql`COALESCE(${schema.messages.sentAt}, ${schema.messages.createdAt})`;
  const reminder = (
    await db
      .select({
        createdAt: schema.messages.createdAt,
        sentAt: schema.messages.sentAt,
        automationRunId: schema.messages.automationRunId,
      })
      .from(schema.messages)
      .where(
        and(
          eq(schema.messages.clinicId, clinicId),
          eq(schema.messages.conversationId, conversationId),
          eq(schema.messages.direction, "outbound"),
          inArray(schema.messages.automationId, CONFIRMATION_REMINDERS),
          inArray(schema.messages.status, ["sent", "delivered", "read"]),
          sql`${sentAtExpr} > now() - interval '48 hours'`,
          isNotNull(schema.messages.automationRunId),
        ),
      )
      .orderBy(sql`${sentAtExpr} DESC`)
      .limit(1)
  )[0];
  if (!reminder?.automationRunId) return false;
  const reminderAt = new Date(reminder.sentAt ?? reminder.createdAt);

  // Motivo atual da espera é cancelar/remarcar (palavra-chave, motivo livre da
  // atendente como "quer trocar o horário"/"pediu para adiar", ou "não poderá
  // comparecer"): a equipe está tratando disso
  const notice = (
    await db
      .select({ body: schema.notifications.body })
      .from(schema.notifications)
      .where(
        and(
          eq(schema.notifications.clinicId, clinicId),
          eq(schema.notifications.refTable, "conversations"),
          eq(schema.notifications.refId, conversationId),
          inArray(schema.notifications.type, ["conversation_needs_human", "conversation_urgent"]),
        ),
      )
      .orderBy(desc(schema.notifications.createdAt))
      .limit(1)
  )[0];
  if (notice?.body && noticeIsAboutChangingAppointment(notice.body)) return false;

  // Pedido de cancelar/remarcar nas 72 h ANTES do lembrete (ex.: com a conversa já
  // esperando a equipe, que não classifica nada): a equipe ainda vai tratar
  const before = await db
    .select({ body: schema.messages.body })
    .from(schema.messages)
    .where(
      and(
        eq(schema.messages.clinicId, clinicId),
        eq(schema.messages.conversationId, conversationId),
        eq(schema.messages.direction, "inbound"),
        isNotNull(schema.messages.body),
        gt(schema.messages.createdAt, new Date(reminderAt.getTime() - 72 * 3_600_000)),
        lte(schema.messages.createdAt, reminderAt),
      ),
    )
    .orderBy(desc(schema.messages.createdAt))
    .limit(50);
  if (before.some((m) => m.body && asksToChangeAppointment(m.body))) return false;

  // Tudo desde o lembrete, das mais NOVAS para trás (conversa longa não esconde o fim)
  const after = (
    await db
      .select({
        direction: schema.messages.direction,
        author: schema.messages.author,
        type: schema.messages.type,
        body: schema.messages.body,
        status: schema.messages.status,
      })
      .from(schema.messages)
      .where(
        and(
          eq(schema.messages.clinicId, clinicId),
          eq(schema.messages.conversationId, conversationId),
          gt(schema.messages.createdAt, reminderAt),
        ),
      )
      .orderBy(desc(schema.messages.createdAt))
      .limit(100)
  ).reverse();
  const visibleOut = (m: (typeof after)[number]) => m.direction === "outbound" && VISIBLE_OUTBOUND.has(m.status);
  // Uma pessoa da equipe escreveu depois do lembrete: ela está conduzindo
  if (after.some((m) => visibleOut(m) && m.author === "human")) return false;
  const clinicSpoke = after.some(visibleOut);
  const isText = (m: (typeof after)[number]) => m.direction === "inbound" && m.type === "text" && Boolean(m.body);
  // Janela de bloqueio: TODA mensagem dela que pede resposta — áudio, foto,
  // documento etc. entram como "[anexo]" (uma recusa por áudio ou na legenda não
  // pode virar confirmação por causa de um "ok" depois). Reação/figurinha não contam.
  const windowTexts = after
    .filter((m) => m.direction === "inbound" && storedMessageTriggersTurn(m.type, m.body))
    .map((m) => (m.type === "text" ? (m.body as string) : "[anexo]"));
  // Candidatas: só o que chegou depois da última fala da clínica (o resto a atendente já leu)
  let lastOut = -1;
  after.forEach((m, i) => {
    if (visibleOut(m)) lastOut = i;
  });
  const candidateTexts = after.slice(lastOut + 1).filter(isText).map((m) => m.body as string);
  if (!reminderReplyConfirms(windowTexts, candidateTexts, clinicSpoke)) return false;

  const run = (
    await db
      .select({ appointmentId: schema.automationRuns.appointmentId })
      .from(schema.automationRuns)
      .where(eq(schema.automationRuns.id, reminder.automationRunId))
      .limit(1)
  )[0];
  if (!run?.appointmentId) return false;
  const appointment = (
    await db
      .select({
        id: schema.appointments.id,
        status: schema.appointments.status,
        startsAt: schema.appointments.startsAt,
        customerId: schema.appointments.customerId,
      })
      .from(schema.appointments)
      .where(eq(schema.appointments.id, run.appointmentId))
      .limit(1)
  )[0];
  if (
    !appointment ||
    appointment.customerId !== customerId ||
    appointment.status !== "scheduled" ||
    new Date(appointment.startsAt).getTime() <= Date.now()
  ) {
    return false;
  }
  const tz =
    (
      await db
        .select({ timezone: schema.clinics.timezone })
        .from(schema.clinics)
        .where(eq(schema.clinics.id, clinicId))
        .limit(1)
    )[0]?.timezone ?? "America/Sao_Paulo";
  await confirmAppointment(clinicId, conversationId, customerId, appointment.id, tz, logger, { reply: false });
  logger.info({ conversationId, appointmentId: appointment.id }, "resposta ao lembrete confirmou presença (conversa com a equipe)");
  return true;
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

/** Confirma a presença: o agendamento e os outros serviços da MESMA visita
 *  (visit_group_id) que ainda estão "agendado", com histórico e fim da cadência de
 *  cada um. Devolve o agendamento confirmado (null se ele já não estava "agendado"). */
export async function confirmVisit(
  clinicId: string,
  customerId: string,
  appointmentId: string,
  source: "customer_whatsapp" | "ai_agent",
  stopReason: string,
): Promise<typeof schema.appointments.$inferSelect | null> {
  const db = unsafeGlobalDb();
  // FSM: scheduled → confirmed, com fonte auditável
  const updated = await db
    .update(schema.appointments)
    .set({ status: "confirmed", statusChangedAt: new Date() })
    .where(
      and(eq(schema.appointments.id, appointmentId), eq(schema.appointments.status, "scheduled")),
    )
    .returning();
  const appointment = updated[0];
  if (!appointment) return null;
  const others = appointment.visitGroupId
    ? await db
        .update(schema.appointments)
        .set({ status: "confirmed", statusChangedAt: new Date() })
        .where(
          and(
            eq(schema.appointments.visitGroupId, appointment.visitGroupId),
            eq(schema.appointments.customerId, customerId),
            eq(schema.appointments.status, "scheduled"),
          ),
        )
        .returning({ id: schema.appointments.id })
    : [];
  const ids = [appointment.id, ...others.map((o) => o.id)];
  await db.insert(schema.appointmentStatusHistory).values(
    ids.map((id) => ({
      clinicId,
      appointmentId: id,
      fromStatus: "scheduled" as const,
      toStatus: "confirmed" as const,
      source,
    })),
  );
  // Cadência de CONFIRMAÇÃO: objetivo atingido (a cobrança de 2h morre aqui). O
  // lembrete de 45 min e os pré-cuidados continuam: eles valem para quem confirmou
  await db
    .update(schema.automationRuns)
    .set({ status: "goal_reached", stopReason, nextRunAt: null, finishedAt: new Date() })
    .where(
      and(
        inArray(schema.automationRuns.appointmentId, ids),
        eq(schema.automationRuns.status, "active"),
        inArray(schema.automationRuns.automationId, CONFIRMATION_REMINDERS),
      ),
    );
  return appointment;
}

async function confirmAppointment(
  clinicId: string,
  conversationId: string,
  customerId: string,
  appointmentId: string,
  tz: string,
  logger: Logger,
  opts: { reply?: boolean } = {},
): Promise<void> {
  const db = unsafeGlobalDb();

  const appointment = await confirmVisit(
    clinicId,
    customerId,
    appointmentId,
    "customer_whatsapp",
    "cliente confirmou pelo WhatsApp",
  );
  if (!appointment) return;
  // Conversa que espera a equipe: confirma em silêncio (a equipe responde junto
  // com o assunto pendente — nada de "qualquer coisa é só me chamar" por cima)
  if (opts.reply === false) {
    logger.info({ appointmentId }, "confirmado via WhatsApp (sem resposta automática: conversa com a equipe)");
    return;
  }

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
  // A verdade é o que a dona VÊ no card de Automações (desligada sem registro)
  const replyEnabled = setting?.enabled ?? false;
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

  // A confirmação já está gravada: falha ao montar/enfileirar a resposta não pode
  // derrubar o resto do processamento da mensagem
  try {
    const extras = (
      await db
        .select({
          clinica: schema.clinics.name,
          procedimento: schema.procedures.name,
          profissional: schema.professionals.name,
        })
        .from(schema.appointments)
        .innerJoin(schema.clinics, eq(schema.clinics.id, schema.appointments.clinicId))
        .leftJoin(schema.procedures, eq(schema.procedures.id, schema.appointments.procedureId))
        .leftJoin(schema.professionals, eq(schema.professionals.id, schema.appointments.professionalId))
        .where(eq(schema.appointments.id, appointment.id))
        .limit(1)
    )[0];
    const zoned = utcToZoned(new Date(appointment.startsAt), tz);
    const [y, m, d] = zoned.dateISO.split("-");
    // Mesmas variáveis que a tela de Automações oferece (sem elas o texto não renderiza)
    const body = renderTemplate(
      setting?.messageTemplate ?? definition.defaultTemplate,
      {
        nome: customer.fullName.split(" ")[0] ?? customer.fullName,
        data: `${d}/${m}/${y}`,
        hora: zoned.timeHHMM,
        clinica: extras?.clinica ?? "",
        procedimento: extras?.procedimento ?? "seu atendimento",
        profissional: extras?.profissional ?? "nossa equipe",
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
  } catch (err) {
    logger.warn(
      { appointmentId, err: err instanceof Error ? err.message : String(err) },
      "confirmado via WhatsApp, mas a resposta automática não pôde ser montada",
    );
  }
}
