import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gt, gte, inArray, isNotNull, isNull, lte, ne, sql } from "drizzle-orm";
import type { Logger } from "pino";
import {
  runAgentTurn,
  type AgentPersona,
  type AgentToolExecutors,
} from "@clinicaos/ai/agent";
import { parseClinicAiProvider, resolveClinicAiConfig } from "@clinicaos/ai/provider";
import { activePromo, suggestOffers } from "@clinicaos/core/offers";
import { customerPriceLabel, formatPriceNumber, priceMode } from "@clinicaos/core/procedure-price";
import { addDaysISO, todayISO, utcToZoned, zonedToUtc } from "@clinicaos/core/timezone";
import {
  clinicServesPeriod,
  eligibleProfessionalIds,
  findSlots,
  isRealDateISO,
  MAX_SLOT_SEARCH_DAYS,
  openRangesOn,
  parseSlotId,
  rangeHasStart,
  rangeTouchesPeriod,
  schema,
  unsafeGlobalDb,
  type FreeSlot,
} from "@clinicaos/db";
import {
  escalateToTeam,
  flagUrgentIfHealth,
  isCourtesyOnly,
  looksLikeHealthComplaint,
  storedHumanOnlyReason,
  storedMessageTriggersTurn,
} from "./media-escalation";
import { getSpendStatus, notifySpendThresholds, recordAiUsage } from "./spend";

/**
 * Turnos da IA conversacional.
 * Debounce no Postgres: cada inbound empurra conversations.ai_turn_after;
 * o sweep processa turnos vencidos — humanos mandam 3 mensagens picadas,
 * a assistente responde ao conjunto.
 */

const DEBOUNCE_MS = 10_000;


interface ClinicAiSettings {
  enabled: boolean;
  assistantName: string;
  tone: AgentPersona["tone"];
  /** Venda complementar pela assistente (padrão: ligada). */
  offers: boolean;
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
    offers: ai?.offers !== false,
  };
}

/** Tipo de anexo → marcador no histórico da atendente. */
const MEDIA_MARKER: Record<string, string> = {
  image: "foto",
  audio: "áudio",
  video: "vídeo",
  document: "documento",
  location: "localização",
  sticker: "figurinha",
};
/** Anexo que a CLÍNICA mandou (pelo celular, na coexistência). */
const OUTBOUND_MEDIA: Record<string, string> = {
  image: "uma foto",
  audio: "um áudio",
  video: "um vídeo",
  document: "um documento",
  location: "uma localização",
  sticker: "uma figurinha",
};
/** Anexo da cliente que ainda conta para a rede de segurança (cobre as novas
 *  tentativas do turno quando o provedor da IA falha por até 30 min). */
const PENDING_MEDIA_WINDOW_MS = 45 * 60_000;
const WEEKDAYS_SHORT = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const WEEKDAYS_LONG = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];

/** "quinta-feira, 12/11" */
function dayName(dateISO: string): string {
  const weekday = new Date(`${dateISO}T12:00:00Z`).getUTCDay();
  const [, m, d] = dateISO.split("-");
  return `${WEEKDAYS_LONG[weekday]}, ${d}/${m}`;
}

/** "na quinta-feira, 12/11" / "no sábado, 14/11" — o dia da semana sempre junto
 *  da data, para a atendente perceber se pediu o dia errado. */
function dayPhrase(dateISO: string): string {
  const weekday = new Date(`${dateISO}T12:00:00Z`).getUTCDay();
  return `${weekday === 0 || weekday === 6 ? "no" : "na"} ${dayName(dateISO)}`;
}

/** Minuto do dia (no fuso) daqui a `aheadMs`, arredondado para CIMA (a busca
 *  compara com segundos). Infinity = já virou o dia. */
function minuteOfTodayAhead(tz: string, todayISODate: string, aheadMs: number): number {
  const z = utcToZoned(new Date(Date.now() + aheadMs + 59_999), tz);
  if (z.dateISO !== todayISODate) return Number.POSITIVE_INFINITY;
  const [h, m] = z.timeHHMM.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** Primeiro minuto em que ainda dá para começar uma visita hoje (antecedência de 1h30, igual à busca). */
function earliestStartMinuteToday(tz: string, todayISODate: string): number {
  return minuteOfTodayAhead(tz, todayISODate, 90 * 60_000);
}

/** Calendário dos próximos 14 dias para o prompt: a atendente copia a data em vez de calcular. */
export function upcomingCalendar(todayISODate: string, days = 14): string {
  return Array.from({ length: days }, (_, i) => {
    const date = addDaysISO(todayISODate, i);
    const [, m, d] = date.split("-");
    const weekday = WEEKDAYS_SHORT[new Date(`${date}T12:00:00Z`).getUTCDay()];
    const prefix = i === 0 ? "hoje " : i === 1 ? "amanhã " : "";
    return `${prefix}${weekday} ${d}/${m} = ${date}`;
  }).join("; ");
}

function daysBetweenISO(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
}

/** Anexo sem legenda espera mais: quem manda foto ou áudio costuma escrever a
 *  explicação logo depois, e os dois precisam cair no MESMO turno (a queixa
 *  digitada é o que define a urgência). O texto seguinte puxa o turno para antes. */
export const MEDIA_DEBOUNCE_MS = 45_000;

/** Chamado no inbound: agenda (ou empurra) o turno da conversa. */
export async function scheduleAiTurn(conversationId: string, delayMs = DEBOUNCE_MS): Promise<void> {
  const db = unsafeGlobalDb();
  await db
    .update(schema.conversations)
    .set({ aiTurnAfter: new Date(Date.now() + delayMs) })
    .where(eq(schema.conversations.id, conversationId));
}

/** A clínica tem IA ligada? Persona ativa + algum provedor utilizável
 *  (o dela própria em Configurações OU o padrão do sistema no env). */
export async function clinicHasAiEnabled(clinicId: string): Promise<boolean> {
  const db = unsafeGlobalDb();
  const clinic = (
    await db
      .select({ settings: schema.clinics.settings })
      .from(schema.clinics)
      .where(eq(schema.clinics.id, clinicId))
      .limit(1)
  )[0];
  if (!clinic || !parseAiSettings(clinic.settings).enabled) return false;
  return resolveClinicAiConfig(clinic.settings, process.env) !== null;
}

/** Sweep: processa conversas com turno vencido. (Sem gate global de env:
 *  clínica pode ter chave própria mesmo sem chave padrão no servidor.) */
export async function processAiTurns(logger: Logger): Promise<void> {
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
      // Turno com erro NÃO deixa a cliente no vácuo. O relógio conta desde a
      // PRIMEIRA mensagem dela ainda sem resposta (a cada mensagem nova o turno é
      // reagendado, então "última mensagem" nunca envelheceria enquanto ela insiste)
      try {
        const pending = await unansweredSince(id);
        const failingTooLong =
          !pending.since || Date.now() - pending.since.getTime() >= 30 * 60_000;
        if (pending.humanOnlyReason || pending.healthComplaint || failingTooLong) {
          // Anexo que só uma pessoa resolve ou queixa de saúde: vai para a equipe já
          // na 1ª falha. Texto comum: depois de ~30 min tentando. Cliente nenhuma
          // fica sem resposta sem a equipe saber.
          await escalateToTeam(
            conversation.clinicId,
            id,
            conversation.customerId,
            pending.humanOnlyReason
              ? `a atendente está fora do ar por uma falha técnica e a cliente ${pending.humanOnlyReason} — responda pela equipe`
              : "a atendente não conseguiu responder por uma falha técnica — responda pela equipe",
            logger,
          );
          await flagUrgentIfHealth(
            conversation.clinicId,
            id,
            conversation.customerId,
            logger,
            pending.since ? { from: pending.since } : {},
          );
        } else {
          await db
            .update(schema.conversations)
            .set({ aiTurnAfter: new Date(Date.now() + 60_000) })
            .where(
              and(eq(schema.conversations.id, id), isNull(schema.conversations.aiTurnAfter)),
            );
        }
      } catch (e) {
        logger.error({ conversationId: id, err: e instanceof Error ? e.message : String(e) }, "falha ao tratar o erro do turno");
      }
    }
  }
}

/** Mensagens da cliente desde a última fala da clínica (atendente ou equipe;
 *  automação não conta como resposta): quando começou a espera, se há anexo
 *  recente que só uma pessoa resolve e se há queixa de saúde. Figurinha e reação
 *  não contam como espera. */
async function unansweredSince(
  conversationId: string,
): Promise<{ since: Date | null; humanOnlyReason: string | null; healthComplaint: boolean }> {
  const db = unsafeGlobalDb();
  const rows = await db
    .select({
      direction: schema.messages.direction,
      author: schema.messages.author,
      type: schema.messages.type,
      body: schema.messages.body,
      createdAt: schema.messages.createdAt,
    })
    .from(schema.messages)
    .where(
      and(
        eq(schema.messages.conversationId, conversationId),
        inArray(schema.messages.status, ["received", "sent", "delivered", "read"]),
      ),
    )
    .orderBy(desc(schema.messages.createdAt))
    .limit(30);
  let since: Date | null = null;
  let humanOnlyReason: string | null = null;
  let healthComplaint = false;
  for (const m of rows) {
    if (m.direction !== "inbound") {
      if (m.author === "automation") continue; // lembrete no meio não é resposta
      break;
    }
    if (!storedMessageTriggersTurn(m.type, m.body)) continue;
    since = new Date(m.createdAt);
    if (Date.now() - new Date(m.createdAt).getTime() < PENDING_MEDIA_WINDOW_MS) {
      humanOnlyReason ??= storedHumanOnlyReason(m.type, m.body);
    }
    if (m.body && looksLikeHealthComplaint(m.body)) healthComplaint = true;
  }
  return { since, humanOnlyReason, healthComplaint };
}

type ConversationRow = typeof schema.conversations.$inferSelect;

/** Ficha de informações oficiais (Conhecimento → Ficha da clínica) vira texto
 *  de prompt. Só campos preenchidos; vazio total = null (seção não aparece). */
export function knowledgeFactsText(settings: unknown): string | null {
  const k = ((settings ?? {}) as Record<string, unknown>).knowledge as
    | Record<string, unknown>
    | undefined;
  if (!k) return null;
  const campos: [string, string][] = [
    ["comoChegar", "Endereço e como chegar"],
    ["estacionamento", "Estacionamento"],
    ["pagamento", "Pagamento e parcelamento"],
    ["convenios", "Convênios aceitos"],
    ["cancelamento", "Política de cancelamento e atraso"],
    ["observacoes", "Outras informações"],
  ];
  const linhas = campos
    .map(([key, label]) => {
      const v = k[key];
      return typeof v === "string" && v.trim() ? `- ${label}: ${v.trim()}` : null;
    })
    .filter((l): l is string => l !== null);
  return linhas.length > 0 ? linhas.join("\n") : null;
}

/** Cliente sumiu no meio da conversa? Depois de ~5 min de silêncio numa
 *  pergunta em aberto, a Ana dá UM toque gentil — como uma recepção de
 *  verdade faria. No máximo um toque por rodada de silêncio (o marcador
 *  fica para trás quando a cliente responde), e nunca em conversa fria
 *  (janela de 45 min). O modelo ainda pode vetar com [SEM_MENSAGEM]. */
export async function processConversationNudges(logger: Logger): Promise<void> {
  const db = unsafeGlobalDb();
  const candidates = await db
    .select()
    .from(schema.conversations)
    .where(
      and(
        eq(schema.conversations.mode, "ai"),
        isNotNull(schema.conversations.customerId),
        isNotNull(schema.conversations.lastInboundAt),
        sql`${schema.conversations.lastMessageAt} > ${schema.conversations.lastInboundAt}`,
        sql`${schema.conversations.lastMessageAt} BETWEEN now() - interval '45 minutes' AND now() - interval '5 minutes'`,
        sql`(${schema.conversations.nudgeSentAt} IS NULL OR ${schema.conversations.nudgeSentAt} < ${schema.conversations.lastInboundAt})`,
      ),
    )
    .limit(5);

  for (const conversation of candidates) {
    // Nada no meio do caminho: balão ainda saindo = não é silêncio da cliente
    const pending = (
      await db
        .select({ id: schema.messages.id })
        .from(schema.messages)
        .where(
          and(
            eq(schema.messages.conversationId, conversation.id),
            inArray(schema.messages.status, ["queued", "sending"]),
          ),
        )
        .limit(1)
    )[0];
    if (pending) continue;

    // A última fala precisa ser da Ana, entregue, com pergunta em aberto
    const last = (
      await db
        .select({
          direction: schema.messages.direction,
          author: schema.messages.author,
          status: schema.messages.status,
          body: schema.messages.body,
        })
        .from(schema.messages)
        .where(eq(schema.messages.conversationId, conversation.id))
        .orderBy(desc(schema.messages.createdAt))
        .limit(1)
    )[0];
    if (!last || last.direction !== "outbound" || last.author !== "ai") continue;
    if (!["sent", "delivered", "read"].includes(last.status)) continue;
    if (!last.body?.includes("?")) continue;
    if (!(await clinicHasAiEnabled(conversation.clinicId))) continue;

    // Claim: um toque por rodada, mesmo com dois workers ou crash no meio
    const claimed = await db
      .update(schema.conversations)
      .set({ nudgeSentAt: new Date() })
      .where(
        and(
          eq(schema.conversations.id, conversation.id),
          sql`(${schema.conversations.nudgeSentAt} IS NULL OR ${schema.conversations.nudgeSentAt} < ${schema.conversations.lastInboundAt})`,
        ),
      )
      .returning({ id: schema.conversations.id });
    if (!claimed[0]) continue;

    const minutes = Math.max(
      5,
      Math.round((Date.now() - new Date(conversation.lastMessageAt!).getTime()) / 60_000),
    );
    try {
      await runTurn(conversation, logger, minutes);
    } catch (err) {
      logger.error(
        { conversationId: conversation.id, err: err instanceof Error ? err.message : String(err) },
        "falha no toque de silêncio",
      );
    }
  }
}

async function runTurn(
  conversation: ConversationRow,
  logger: Logger,
  nudgeMinutes?: number,
): Promise<void> {
  const db = unsafeGlobalDb();
  if (!conversation.customerId) return;
  const conversationCustomerId = conversation.customerId;
  if (conversation.mode !== "ai") {
    // Conversa já esperando a equipe: a atendente não fala, mas queixa de saúde
    // que chegar agora (ex.: a explicação digitada depois da foto) vira URGENTE
    if (conversation.mode === "waiting_human" && !nudgeMinutes) {
      await flagUrgentIfHealth(conversation.clinicId, conversation.id, conversationCustomerId, logger);
    }
    return;
  }
  // Escalada que NÃO passa pela atendente (limite de gastos, cap, opt-out): a
  // queixa de saúde que disparou o turno precisa ser triada mesmo assim
  const flagPendingHealth = async () => {
    const pending = await unansweredSince(conversation.id);
    await flagUrgentIfHealth(
      conversation.clinicId,
      conversation.id,
      conversationCustomerId,
      logger,
      pending.since ? { from: pending.since } : {},
    );
  };

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

  // Limite mensal de gastos em reais (Configurações → Gastos com API). Passou e a
  // clínica não liberou excedente → o turno vai para humano, sem gastar.
  const spend = await getSpendStatus(clinic);
  if (spend.blocked) {
    // Toque de silêncio (a cliente não escreveu nada): só não cutuca — nada de
    // mandar para a equipe uma conversa que não tem fala da cliente para responder
    if (nudgeMinutes) return;
    logger.warn({ clinicId: conversation.clinicId, spent: spend.spentBrl }, "limite de gastos atingido — turno vai p/ humano");
    await db
      .update(schema.conversations)
      .set({ mode: "waiting_human" })
      .where(eq(schema.conversations.id, conversation.id));
    // Motivo na própria conversa (o painel mostra por que ela está esperando)
    await db.insert(schema.notifications).values({
      clinicId: conversation.clinicId,
      type: "conversation_needs_human",
      title: "Atendente pausada: limite de gastos do mês atingido",
      body: "Responda esta conversa pela equipe. Depois de ajustar o limite em Configurações → Gastos com API, clique em “Devolver para o automático” nesta conversa.",
      refTable: "conversations",
      refId: conversation.id,
    });
    await notifySpendThresholds(clinic, logger);
    await flagPendingHealth();
    return;
  }

  // Kill-switch mensal de custo. Variável ausente, VAZIA ou inválida = padrão
  // de 5M — Number("") é 0 e transformaria o cap num "IA desligada" silencioso.
  const capEnv = Number(process.env.AI_MONTHLY_TOKEN_CAP);
  const capTokens = Number.isFinite(capEnv) && capEnv > 0 ? capEnv : 5_000_000;
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
    if (nudgeMinutes) return; // toque de silêncio: só não cutuca
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
    await flagPendingHealth();
    return;
  }

  const customer = (
    await db
      .select()
      .from(schema.customers)
      .where(eq(schema.customers.id, conversation.customerId))
      .limit(1)
  )[0];
  if (!customer) return;
  if (customer.optedOutAt) {
    // Pediu para não receber mensagens automáticas, mas ESCREVEU: a atendente não
    // responde — e a equipe precisa saber (nunca silêncio sem ninguém avisado).
    // Só um "obrigada"/"ok"/🙏 depois da despedida não chama ninguém.
    if (!nudgeMinutes) {
      const ultima = (
        await db
          .select({ type: schema.messages.type, body: schema.messages.body })
          .from(schema.messages)
          .where(and(eq(schema.messages.conversationId, conversation.id), eq(schema.messages.direction, "inbound")))
          .orderBy(desc(schema.messages.createdAt))
          .limit(1)
      )[0];
      // Cortesia = texto curto ("obrigada") ou figurinha; foto, áudio etc. sempre chamam a equipe
      const cortesia = ultima
        ? (ultima.type === "text" || ultima.type === "sticker") && isCourtesyOnly(ultima.body)
        : true;
      if (!cortesia) {
        const moved = await escalateToTeam(
          clinic.id,
          conversation.id,
          customer.id,
          "cliente que pediu para não receber mensagens automáticas escreveu — responda pela equipe",
          logger,
        );
        if (moved) await flagPendingHealth();
      }
    }
    return;
  }

  const tz = clinic.timezone;

  // ── Contexto ─────────────────────────────────────────────────────
  const procedures = await db
    .select({
      id: schema.procedures.id,
      name: schema.procedures.name,
      price: schema.procedures.price,
      priceOnRequest: schema.procedures.priceOnRequest,
      durationMinutes: schema.procedures.durationMinutes,
    })
    .from(schema.procedures)
    .where(and(eq(schema.procedures.clinicId, clinic.id), eq(schema.procedures.active, true)));
  const procedurePriceOnRequest = new Map(procedures.map((p) => [p.id, p.priceOnRequest]));

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
    // Visita com vários serviços: o contexto mostra TODOS e a duração total — para
    // remarcar, a atendente consulta com a lista certa (senão o horário não cabe)
    const visita = upcoming.visitGroupId
      ? await db
          .select({
            procedureId: schema.appointments.procedureId,
            startsAt: schema.appointments.startsAt,
            endsAt: schema.appointments.endsAt,
          })
          .from(schema.appointments)
          .where(
            and(
              eq(schema.appointments.visitGroupId, upcoming.visitGroupId),
              eq(schema.appointments.customerId, customer.id),
              inArray(schema.appointments.status, ["scheduled", "confirmed"]),
            ),
          )
          .orderBy(asc(schema.appointments.startsAt))
      : [upcoming];
    const procName = visita
      .map((a) => procedures.find((p) => p.id === a.procedureId)?.name ?? "atendimento")
      .join(" + ");
    const visitaMin = visita.reduce(
      (acc, a) => acc + Math.round((new Date(a.endsAt).getTime() - new Date(a.startsAt).getTime()) / 60_000),
      0,
    );
    upcomingLabel = `${procName}${visita.length > 1 ? ` (${visitaMin} min, na mesma visita)` : ""}, ${dayName(z.dateISO)} às ${z.timeHHMM} — status ${
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
      createdAt: schema.messages.createdAt,
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
  // Anexos entram como marcador ("[áudio]", "[foto: legenda]"): a atendente sabe
  // que existiram, mas que não pode ouvi-los nem vê-los (regra no prompt). O que a
  // clínica mandou vira "[a clínica enviou uma foto]" — nunca um marcador que a
  // atendente possa achar que é fala dela e repetir
  const chronological = historyRows.reverse();
  const history = chronological
    .map((m) => {
      const inbound = m.direction === "inbound";
      const media = inbound ? MEDIA_MARKER[m.type] : OUTBOUND_MEDIA[m.type];
      const text = media
        ? inbound
          ? `[${media}${m.body ? `: ${m.body}` : ""}]`
          : `[a clínica enviou ${media}${m.body ? `: ${m.body}` : ""}]`
        : m.body;
      return {
        role: inbound ? ("customer" as const) : ("assistant" as const),
        text,
      };
    })
    .filter((m): m is { role: "customer" | "assistant"; text: string } => Boolean(m.text));
  if (history.length === 0 || history[history.length - 1]!.role !== "customer") return;

  // Rede de segurança: foto, áudio, vídeo, documento (ou algo que só aparece no
  // celular) que a cliente mandou desde a última fala da clínica (recente) — se a
  // atendente não passar a conversa para a equipe neste turno, o sistema passa
  let pendingHumanReason: string | null = null;
  for (let i = chronological.length - 1; i >= 0; i--) {
    const m = chronological[i]!;
    if (m.direction !== "inbound") break;
    const reason = storedHumanOnlyReason(m.type, m.body);
    if (reason && Date.now() - new Date(m.createdAt).getTime() < PENDING_MEDIA_WINDOW_MS) {
      pendingHumanReason = reason;
      break;
    }
  }

  const nowZ = utcToZoned(new Date(), tz);
  const weekdays = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
  const [ny, nm, nd] = nowZ.dateISO.split("-");

  const businessHoursLabel = businessHoursToLabel(
    (clinic.businessHours ?? {}) as Record<string, [string, string][]>,
  );
  // Endereço e telefone oficiais (Configurações → Dados da clínica) — a IA só
  // fala de localização/contato com o que está aqui ou na base de conhecimento
  const clinicAddress =
    [
      clinic.addressStreet
        ? `${clinic.addressStreet}${clinic.addressNumber ? `, ${clinic.addressNumber}` : ""}`
        : null,
      clinic.addressComplement,
      clinic.addressDistrict,
      clinic.addressCity
        ? clinic.addressState
          ? `${clinic.addressCity}/${clinic.addressState}`
          : clinic.addressCity
        : null,
      clinic.addressZip ? `CEP ${clinic.addressZip}` : null,
    ]
      .filter(Boolean)
      .join(", ") || null;
  const clinicPhone =
    clinic.phone?.replace(/^\+55(\d{2})(\d{4,5})(\d{4})$/, "($1) $2-$3") ?? null;

  // ── Executores das ferramentas ───────────────────────────────────
  let urgentThisTurn = false;
  // Foi ESTE turno que tirou a conversa do automático? Só ele manda a despedida
  let movedByThisTurn = false;
  // Apelidos curtos de slot (H1, H2...) → id real. Modelo econômico erra ao
  // copiar ids longos (uuid+ISO); apelido de 2 letras é à prova de digitação.
  // Numeração ÚNICA no turno (nunca recomeça): duas consultas na mesma resposta
  // (quinta e sexta, ou dia cheio + próximas opções) não podem dividir o "H3"
  // Cada apelido guarda também a duração da consulta que o gerou: horário achado
  // para 60 min não pode virar visita de 90 (passaria do fechamento ou de um bloqueio)
  const slotAliases = new Map<string, { slotId: string; minutes: number }>();
  let aliasSeq = 0;
  const resolveSlot = (raw: string): { slotId: string; minutes: number | null } => {
    const hit = slotAliases.get(raw.trim().toUpperCase());
    return hit ? { slotId: hit.slotId, minutes: hit.minutes } : { slotId: raw, minutes: null };
  };
  const listSlots = (slots: FreeSlot[], minutes: number): string =>
    slots
      .map((s) => {
        const alias = `H${++aliasSeq}`;
        slotAliases.set(alias, { slotId: s.slotId, minutes });
        return `- ${s.label} [slot_id: ${alias}]`;
      })
      .join("\n");
  const hours = (clinic.businessHours ?? {}) as Record<string, [string, string][]>;
  const executors: AgentToolExecutors = {
    async consultarHorarios(procedimentosNomes, filtro) {
      const procs = matchProcedures(procedures, procedimentosNomes);
      if (typeof procs === "string") return procs; // mensagem de "não encontrado"
      const totalMin = procs.reduce((acc, p) => acc + p.durationMinutes, 0);
      // Só profissionais que realizam TODOS os procedimentos da visita
      const aptas = await eligibleProfessionalIds(db, clinic.id, procs.map((p) => p.id));
      if (aptas.length === 0) {
        return procs.length > 1
          ? "Nenhuma profissional realiza TODOS esses procedimentos na mesma visita. Ofereça marcar em visitas separadas (consulte cada procedimento sozinho) ou escale para a equipe combinar."
          : "Nenhuma profissional ativa realiza esse procedimento — escale para a equipe.";
      }
      const turno = filtro?.turno ?? null;
      const turnoLabel = turno === "manha" ? " de manhã" : turno === "tarde" ? " à tarde" : turno === "noite" ? " à noite" : "";
      const hoje = todayISO(tz);
      const limite = addDaysISO(hoje, MAX_SLOT_SEARCH_DAYS);
      const [, limM, limD] = limite.split("-");
      const data = filtro?.data ?? null;
      if (data && !isRealDateISO(data)) {
        return `Data "${data}" inválida: chame consultar_horarios de novo com uma data real no formato AAAA-MM-DD, copiada da lista PRÓXIMOS DIAS (hoje é ${hoje}). Se a cliente citou um dia que não existe, confirme com ela.`;
      }
      if (data && data < hoje) {
        return `A data ${data} já passou (hoje é ${hoje}). Confirme com a cliente qual dia ela quer.`;
      }
      if (data && data > limite) {
        return `A agenda só está aberta até ${limD}/${limM}; ${data} ainda não pode ser marcado. Diga isso à cliente com naturalidade e ofereça uma data até ${limD}/${limM}, ou escale para a equipe.`;
      }
      const nomes = procs.map((p) => p.name).join(" + ");
      const combo = procs.length > 1 ? ` (${totalMin} min no total, em sequência)` : "";

      const outroDia = "pergunte qual outro dia ou turno serve, ou consulte-o antes de citar qualquer horário";

      if (data) {
        const dia = dayPhrase(data);
        const faixas = (rs: [string, string][]) => rs.map(([a, b]) => `${a} às ${b}`).join(" e ");
        // Clínica fechada nesse dia ou turno (ou sem espaço para essa duração):
        // isso não é "lotado" nem caso para a equipe
        const ranges = openRangesOn(hours, data);
        if (ranges.length === 0) {
          return `A clínica não atende ${dia} (horário de atendimento: ${businessHoursLabel}). Diga isso com naturalidade e ${outroDia}.`;
        }
        if (turno && !ranges.some((r) => rangeTouchesPeriod(r, turno))) {
          return `A clínica não atende${turnoLabel} ${dia} (nesse dia: ${faixas(ranges)}). Diga isso com naturalidade e ${outroDia}.`;
        }
        if (!ranges.some((r) => rangeHasStart(r, turno, totalMin))) {
          return `${dia.charAt(0).toUpperCase()}${dia.slice(1)}${turnoLabel} não cabe ${nomes} (${totalMin} min) no horário de atendimento (nesse dia: ${faixas(ranges)}). Diga isso com naturalidade e ${outroDia}.`;
        }
        // Dia pedido: a lista COMPLETA do dia (ou do turno) — nada de "não tenho às 17h" por corte
        const slots = await findSlots(db, clinic.id, tz, totalMin, 48, aptas, {
          fromDate: data,
          onlyThatDay: true,
          period: turno,
        });
        if (slots.length > 0) {
          return `Horários livres para ${nomes}${combo} ${dia}${turnoLabel} (lista completa${turno ? " desse turno" : " do dia"}):\n${listSlots(slots, totalMin)}`;
        }
        // Sem horário: hoje já passou da hora (antecedência de 1h30) ou a agenda está cheia/bloqueada
        const tarde =
          data === hoje &&
          !ranges.some((r) => rangeHasStart(r, turno, totalMin, earliestStartMinuteToday(tz, hoje)));
        // Hoje: o turno/expediente já acabou, ou ainda não acabou mas não dá 1h30 de antecedência
        const encerrado =
          tarde && !ranges.some((r) => rangeHasStart(r, turno, totalMin, minuteOfTodayAhead(tz, hoje, 0)));
        const motivo = encerrado
          ? `hoje${turnoLabel} o atendimento já terminou`
          : tarde
            ? `hoje${turnoLabel} já não dá mais para marcar: é preciso pelo menos 1h30 de antecedência`
            : "agenda cheia ou bloqueada";
        // Próximas opções, sem passar da agenda aberta
        const inicio = addDaysISO(data, 1);
        if (inicio > limite) {
          return `Não há horário livre ${dia}${turnoLabel} (${motivo}), e a agenda só está aberta até ${limD}/${limM}. Ofereça passar para a equipe verificar outras opções.`;
        }
        const dias = Math.min(14, daysBetweenISO(inicio, limite) + 1);
        const depois = await findSlots(db, clinic.id, tz, totalMin, 6, aptas, {
          fromDate: inicio,
          period: turno,
          perDay: 2,
          days: dias,
        });
        if (depois.length === 0) {
          return `Não há horário livre ${dia}${turnoLabel} (${motivo}) nem ${dias === 1 ? "no dia seguinte" : `nos ${dias} dias seguintes`} — ofereça passar para a equipe verificar outras opções.`;
        }
        return `Não há horário livre ${dia}${turnoLabel} (${motivo}). Próximas opções${turnoLabel} (os primeiros de cada dia):\n${listSlots(depois, totalMin)}`;
      }

      // Sem dia: espalha pelos próximos dias (3 por dia)
      if (turno && !clinicServesPeriod(hours, turno, totalMin)) {
        return `A clínica não atende${turnoLabel}${procs.length > 1 || totalMin > 60 ? ` (ou não cabe ${nomes}, ${totalMin} min, nesse turno)` : ""} — horário de atendimento: ${businessHoursLabel}. Diga isso com naturalidade e ${outroDia}.`;
      }
      const janela = turno ? 14 : 8;
      const slots = await findSlots(db, clinic.id, tz, totalMin, 6, aptas, { period: turno, perDay: 3, days: janela });
      if (slots.length === 0) {
        return `Nenhum horário livre${turnoLabel} nos próximos ${janela} dias — ofereça passar para a equipe verificar outras opções.`;
      }
      return `Horários livres para ${nomes}${combo}${turnoLabel} (só os primeiros de cada dia; para ver um dia inteiro, consulte com data):\n${listSlots(slots, totalMin)}`;
    },

    async agendar(slotId, procedimentosNomes) {
      // Garantia mecânica: agendamento só nasce com nome completo de verdade
      // na ficha (relê AGORA — atualizar_cadastro pode ter rodado neste turno)
      const freshName =
        (
          await db
            .select({ fullName: schema.customers.fullName })
            .from(schema.customers)
            .where(eq(schema.customers.id, customer.id))
            .limit(1)
        )[0]?.fullName ?? "";
      if (!nameReliability(freshName).confirmed) {
        return "NÃO AGENDADO: a ficha ainda não tem o nome completo da cliente. Pergunte o nome completo dela com naturalidade, registre com atualizar_cadastro e só então chame agendar de novo.";
      }
      const procs = matchProcedures(procedures, procedimentosNomes);
      if (typeof procs === "string") throw new Error(procs);
      const resolved = resolveSlot(slotId);
      const parsed = parseSlotId(resolved.slotId);
      if (!parsed) throw new Error("slot_id inválido — consulte os horários de novo.");
      const startsAt = new Date(parsed.startISO);
      if (startsAt.getTime() < Date.now()) throw new Error("Esse horário já passou.");
      const visitaMin = procs.reduce((acc, p) => acc + p.durationMinutes, 0);
      if (resolved.minutes !== null && visitaMin > resolved.minutes) {
        return `NÃO AGENDADO: esse horário veio de uma consulta para ${resolved.minutes} min, e a visita (${procs.map((p) => p.name).join(" + ")}) tem ${visitaMin} min. Chame consultar_horarios com esses mesmos procedimentos e use um slot_id da lista nova.`;
      }
      // Trava: a profissional do slot precisa realizar todos os procedimentos
      const aptas = await eligibleProfessionalIds(db, clinic.id, procs.map((p) => p.id));
      if (!aptas.includes(parsed.professionalId)) {
        throw new Error(
          "Essa profissional não realiza esse(s) procedimento(s) — consulte os horários de novo com a lista certa.",
        );
      }

      // Vários serviços = UMA visita: blocos emendados, mesmo grupo.
      // Transação: ou a visita inteira nasce, ou nada nasce (agenda nunca
      // fica com metade de um combo se um bloco conflitar).
      const groupId = procs.length > 1 ? randomUUID() : null;
      let cursor = startsAt;
      const createdIds: string[] = [];
      try {
        await db.transaction(async (t) => {
          for (const proc of procs) {
            const segEnd = new Date(cursor.getTime() + proc.durationMinutes * 60_000);
            const [created] = await t
              .insert(schema.appointments)
              .values({
                clinicId: clinic.id,
                customerId: customer.id,
                professionalId: parsed.professionalId,
                procedureId: proc.id,
                startsAt: cursor,
                endsAt: segEnd,
                price: proc.price,
                origin: "ai_agent",
                visitGroupId: groupId,
              })
              .returning({ id: schema.appointments.id });
            if (!created) throw new Error("conflito");
            await t.insert(schema.appointmentStatusHistory).values({
              clinicId: clinic.id,
              appointmentId: created.id,
              fromStatus: null,
              toStatus: "scheduled",
              source: "ai_agent",
            });
            createdIds.push(created.id);
            cursor = segEnd;
          }
        });
      } catch {
        throw new Error(
          "Não consegui agendar — o horário pode ter acabado de ser ocupado. Consulte os horários de novo.",
        );
      }

      // Lembretes: só o PRIMEIRO bloco da visita (um lembrete por visita, nunca rajada)
      await materializeRuns(clinic.id, createdIds[0]!, customer.id, startsAt);
      // Funil corre sozinho: agendou → card vai para "Agendou avaliação"
      await db.execute(sql`
        INSERT INTO pipeline_stages (clinic_id, name, sort)
        SELECT ${clinic.id}, 'Agendou avaliação', 3
        WHERE NOT EXISTS (SELECT 1 FROM pipeline_stages
                          WHERE clinic_id = ${clinic.id} AND name = 'Agendou avaliação')
      `);
      // Valor da negociação = soma da visita (só se ninguém preencheu antes). Serviço sob
      // avaliação não tem valor ainda: nesse caso a negociação fica sem valor, nunca R$ 0
      const anyOnRequest = procs.some((p) => procedurePriceOnRequest.get(p.id));
      const totalPrice = anyOnRequest ? null : procs.reduce((acc, p) => acc + Number(p.price), 0).toFixed(2);
      const nomes = procs.map((p) => p.name).join(" + ");
      await db.execute(sql`
        UPDATE deals d SET stage_id = s.id, updated_at = now(),
          value = COALESCE(d.value, NULLIF(${totalPrice}::numeric, 0)),
          notes = COALESCE(NULLIF(d.notes, ''), ${"Agendou: " + nomes})
        FROM pipeline_stages s
        WHERE d.clinic_id = ${clinic.id} AND d.customer_id = ${customer.id}
          AND d.status = 'open'
          AND s.clinic_id = d.clinic_id AND s.name = 'Agendou avaliação'
      `);
      const z = utcToZoned(startsAt, tz);
      return `Agendado com sucesso: ${nomes} ${dayPhrase(z.dateISO)} às ${z.timeHHMM}${procs.length > 1 ? " (em sequência, na mesma visita)" : ""} (id: ${createdIds[0]}).`;
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
      // Visita com vários serviços? Remarca o GRUPO inteiro (blocos em ordem)
      const grupo = original.visitGroupId
        ? await db
            .select()
            .from(schema.appointments)
            .where(
              and(
                eq(schema.appointments.visitGroupId, original.visitGroupId),
                eq(schema.appointments.customerId, customer.id),
                inArray(schema.appointments.status, ["scheduled", "confirmed"]),
              ),
            )
            .orderBy(asc(schema.appointments.startsAt))
        : [original];
      const resolved = resolveSlot(slotId);
      const parsed = parseSlotId(resolved.slotId);
      if (!parsed) throw new Error("slot_id inválido — consulte os horários de novo.");
      const startsAt = new Date(parsed.startISO);
      if (startsAt.getTime() < Date.now()) throw new Error("Esse horário já passou.");
      // A visita inteira precisa caber no horário escolhido: consulta feita só com o
      // 1º serviço (60 min) não serve para remarcar uma visita de 90
      const visitaMin = grupo.reduce(
        (acc, a) => acc + Math.round((new Date(a.endsAt).getTime() - new Date(a.startsAt).getTime()) / 60_000),
        0,
      );
      const nomesGrupo = grupo
        .map((a) => procedures.find((p) => p.id === a.procedureId)?.name ?? "atendimento")
        .join(" + ");
      const procIdsGrupo = grupo.map((a) => a.procedureId).filter((x): x is string => Boolean(x));
      const aptasGrupo = await eligibleProfessionalIds(db, clinic.id, procIdsGrupo);
      // Horário achado para uma duração menor que a da visita (consulta só com o 1º
      // serviço, ou serviço encurtado depois de marcar): confere a agenda DE VERDADE
      // com a duração da visita. Cabe → segue. Não cabe → devolve os horários desse
      // dia que cabem (já com a duração certa: o próximo reagendar passa direto)
      if (
        (resolved.minutes !== null && visitaMin > resolved.minutes) ||
        !aptasGrupo.includes(parsed.professionalId)
      ) {
        const diaSlot = utcToZoned(startsAt, tz).dateISO;
        const cabem = await findSlots(db, clinic.id, tz, visitaMin, 48, aptasGrupo, {
          fromDate: diaSlot,
          onlyThatDay: true,
        });
        if (!cabem.some((s) => s.slotId === resolved.slotId)) {
          if (cabem.length === 0) {
            return `NÃO REMARCADO: essa visita (${nomesGrupo}, ${visitaMin} min) não cabe nesse horário e não há outro livre ${dayPhrase(diaSlot)}. Pergunte outro dia à cliente e consulte esse dia.`;
          }
          return `NÃO REMARCADO: essa visita (${nomesGrupo}, ${visitaMin} min) não cabe nesse horário. Horários ${dayPhrase(diaSlot)} em que ela cabe (use um destes slot_id no reagendar):\n${listSlots(cabem, visitaMin)}`;
        }
      }

      const novoGrupo = grupo.length > 1 ? randomUUID() : null;
      let cursor = startsAt;
      let firstCreatedId: string | null = null;
      try {
        await db.transaction(async (t) => {
          for (const antigo of grupo) {
            const duration =
              new Date(antigo.endsAt).getTime() - new Date(antigo.startsAt).getTime();
            await t
              .update(schema.appointments)
              .set({ status: "rescheduled", statusChangedAt: new Date() })
              .where(eq(schema.appointments.id, antigo.id));
            await t.insert(schema.appointmentStatusHistory).values({
              clinicId: clinic.id,
              appointmentId: antigo.id,
              fromStatus: antigo.status,
              toStatus: "rescheduled",
              source: "ai_agent",
              reason: "remarcado pela cliente via assistente",
            });
            await t
              .update(schema.automationRuns)
              .set({ status: "cancelled", stopReason: "remarcado pela IA", nextRunAt: null, finishedAt: new Date() })
              .where(
                and(
                  eq(schema.automationRuns.appointmentId, antigo.id),
                  eq(schema.automationRuns.status, "active"),
                ),
              );
            const segEnd = new Date(cursor.getTime() + duration);
            const [created] = await t
              .insert(schema.appointments)
              .values({
                clinicId: clinic.id,
                customerId: customer.id,
                professionalId: parsed.professionalId,
                procedureId: antigo.procedureId,
                startsAt: cursor,
                endsAt: segEnd,
                price: antigo.price,
                customerPackageId: antigo.customerPackageId,
                origin: "ai_agent",
                visitGroupId: novoGrupo,
              })
              .returning({ id: schema.appointments.id });
            if (!created) throw new Error("conflito");
            await t
              .update(schema.appointments)
              .set({ rescheduledToId: created.id })
              .where(eq(schema.appointments.id, antigo.id));
            await t.insert(schema.appointmentStatusHistory).values({
              clinicId: clinic.id,
              appointmentId: created.id,
              fromStatus: null,
              toStatus: "scheduled",
              source: "ai_agent",
              reason: "reagendamento via assistente",
            });
            firstCreatedId ??= created.id;
            cursor = segEnd;
          }
        });
      } catch {
        throw new Error(
          "Não consegui remarcar — o horário pode ter acabado de ser ocupado. Consulte os horários de novo.",
        );
      }
      await materializeRuns(clinic.id, firstCreatedId!, customer.id, startsAt);
      const z = utcToZoned(startsAt, tz);
      return `Remarcado para ${dayName(z.dateISO)} às ${z.timeHHMM}${grupo.length > 1 ? " (a visita inteira, com todos os serviços)" : ""}.`;
    },

    async cancelar(agendamentoId, motivo) {
      const alvo = (
        await db
          .select({
            id: schema.appointments.id,
            visitGroupId: schema.appointments.visitGroupId,
          })
          .from(schema.appointments)
          .where(
            and(
              eq(schema.appointments.id, agendamentoId),
              eq(schema.appointments.customerId, customer.id),
              inArray(schema.appointments.status, ["scheduled", "confirmed"]),
            ),
          )
          .limit(1)
      )[0];
      if (!alvo) throw new Error("Agendamento não encontrado.");
      // Visita com vários serviços: cancelar a visita cancela TODOS os blocos
      const ids = alvo.visitGroupId
        ? (
            await db
              .select({ id: schema.appointments.id })
              .from(schema.appointments)
              .where(
                and(
                  eq(schema.appointments.visitGroupId, alvo.visitGroupId),
                  eq(schema.appointments.customerId, customer.id),
                  inArray(schema.appointments.status, ["scheduled", "confirmed"]),
                ),
              )
          ).map((r) => r.id)
        : [alvo.id];
      for (const id of ids) {
        await db
          .update(schema.appointments)
          .set({ status: "cancelled", statusChangedAt: new Date(), cancelReason: motivo })
          .where(eq(schema.appointments.id, id));
        await db.insert(schema.appointmentStatusHistory).values({
          clinicId: clinic.id,
          appointmentId: id,
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
              eq(schema.automationRuns.appointmentId, id),
              eq(schema.automationRuns.status, "active"),
            ),
          );
      }
      return "Cancelado com sucesso.";
    },

    async atualizarCadastro(dados) {
      const fresh = (
        await db
          .select()
          .from(schema.customers)
          .where(eq(schema.customers.id, customer.id))
          .limit(1)
      )[0];
      if (!fresh) return "Ficha não encontrada.";

      const clean = (v: string | undefined, max: number): string | null =>
        typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;

      type Fillable = Partial<{
        fullName: string;
        email: string;
        cpf: string;
        rg: string;
        birthDate: string;
        insuranceName: string;
        insurancePlan: string;
        addressStreet: string;
        addressNumber: string;
        addressDistrict: string;
        addressCity: string;
      }>;
      const updates: Fillable & { updatedAt?: Date } = {};
      const saved: string[] = [];
      const kept: string[] = [];
      const fill = (
        key: keyof Fillable,
        label: string,
        current: unknown,
        value: string | null,
      ) => {
        if (!value) return;
        // SÓ completa campo vazio — o que a clínica preencheu é intocável
        if (current && String(current).trim()) {
          kept.push(label);
          return;
        }
        updates[key] = value;
        saved.push(label);
      };

      // Nome: telefone-como-nome ou só o primeiro nome (pushName) conta como
      // "não preenchido de verdade"; nome completo digitado pela clínica fica
      const nome = clean(dados.nome_completo, 120);
      if (nome && nome.split(/\s+/).length >= 2) {
        const current = fresh.fullName.trim();
        if (/^\+?\d+$/.test(current) || current.split(/\s+/).length < 2) {
          updates.fullName = nome;
          saved.push("nome completo");
        } else {
          kept.push("nome");
        }
      }

      const email = clean(dados.email, 160)?.toLowerCase() ?? null;
      fill(
        "email",
        "e-mail",
        fresh.email,
        email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? email : null,
      );
      const cpfDigits = (dados.cpf ?? "").replace(/\D/g, "");
      fill(
        "cpf",
        "CPF",
        fresh.cpf,
        cpfDigits.length === 11
          ? cpfDigits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4")
          : null,
      );
      fill("rg", "RG", fresh.rg, clean(dados.rg, 20));

      const birthMatch = (dados.data_nascimento ?? "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
      let birthISO: string | null = null;
      if (birthMatch) {
        const iso = `${birthMatch[3]}-${birthMatch[2]}-${birthMatch[1]}`;
        const parsed = new Date(`${iso}T12:00:00`);
        if (
          !Number.isNaN(parsed.getTime()) &&
          parsed.getTime() < Date.now() &&
          Number(birthMatch[3]) > 1900
        ) {
          birthISO = iso;
        }
      }
      fill("birthDate", "nascimento", fresh.birthDate, birthISO);
      fill("insuranceName", "convênio", fresh.insuranceName, clean(dados.convenio, 80));
      fill("insurancePlan", "plano", fresh.insurancePlan, clean(dados.plano, 80));
      fill("addressStreet", "rua", fresh.addressStreet, clean(dados.endereco_rua, 160));
      fill("addressNumber", "número", fresh.addressNumber, clean(dados.endereco_numero, 20));
      fill("addressDistrict", "bairro", fresh.addressDistrict, clean(dados.endereco_bairro, 80));
      fill("addressCity", "cidade", fresh.addressCity, clean(dados.endereco_cidade, 80));

      if (saved.length > 0) {
        updates.updatedAt = new Date();
        await db
          .update(schema.customers)
          .set(updates)
          .where(eq(schema.customers.id, customer.id));
      }

      const parts: string[] = [];
      if (saved.length) parts.push(`Guardado na ficha: ${saved.join(", ")}.`);
      if (kept.length) {
        parts.push(
          `Já preenchidos pela clínica (mantidos — se a cliente pediu correção, escale para a equipe): ${kept.join(", ")}.`,
        );
      }
      if (!parts.length) parts.push("Nenhum dado válido para guardar.");
      parts.push("Siga a conversa naturalmente, sem mencionar sistema ou ficha.");
      return parts.join(" ");
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

    async consultarInformacoes(pergunta) {
      const q = pergunta.trim();
      if (!q) return "Nada encontrado (pergunta vazia).";
      // Busca em português no Postgres + fallback por semelhança de título
      const res = await db.execute(sql`
        SELECT title, content FROM kb_entries
        WHERE clinic_id = ${clinic.id} AND active
          AND (search @@ plainto_tsquery('portuguese', ${q})
               OR title ILIKE '%' || ${q} || '%')
        ORDER BY ts_rank(search, plainto_tsquery('portuguese', ${q})) DESC
        LIMIT 4
      `);
      const found = res.rows as { title: string; content: string }[];
      if (found.length === 0) {
        return "Nada encontrado na base de conhecimento da clínica sobre isso. NÃO invente a resposta: diga que vai confirmar com a equipe e escale.";
      }
      return (
        "INFORMAÇÕES OFICIAIS ENCONTRADAS (responda usando SOMENTE isto):\n" +
        found.map((r) => `— ${r.title}: ${r.content}`).join("\n")
      );
    },

    async escalarParaHumano(motivo, urgencia) {
      // Escalou duas vezes no mesmo turno? A urgência nunca cai (alta + normal = alta)
      const raised = urgencia === "alta" && !urgentThisTurn;
      urgentThisTurn ||= urgencia === "alta";
      // Só tira do automático: se a equipe ASSUMIU no meio do turno (resposta pelo
      // celular ou pelo painel), o takeover vale — nada de "precisa de você" por cima
      const moved = await db
        .update(schema.conversations)
        .set({ mode: "waiting_human" })
        .where(and(eq(schema.conversations.id, conversation.id), eq(schema.conversations.mode, "ai")))
        .returning({ id: schema.conversations.id });
      if (moved[0]) {
        movedByThisTurn = true;
      } else {
        const atual = (
          await db
            .select({ mode: schema.conversations.mode })
            .from(schema.conversations)
            .where(eq(schema.conversations.id, conversation.id))
            .limit(1)
        )[0];
        if (atual?.mode === "human") {
          return "A equipe já assumiu esta conversa agora: não escreva nada para a cliente. Chame responder_cliente com um balão curto qualquer — ele NÃO será enviado.";
        }
        // Já esperando a equipe (escalada anterior deste turno ou outro caminho):
        // só registra de novo se a urgência subiu
        if (!raised) return "Conversa passada para a equipe. Diga à cliente que alguém da equipe já vai falar com ela.";
      }
      await db.insert(schema.notifications).values({
        clinicId: clinic.id,
        // Urgente tem tipo próprio: o painel destaca em vermelho e alerta no computador
        type: urgentThisTurn ? "conversation_urgent" : "conversation_needs_human",
        title: `${customer.fullName} precisa de você no WhatsApp${urgentThisTurn ? " (urgente)" : ""}`,
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

    // Venda complementar: MESMAS regras do card "Sugerir também" da caixa de
    // Conversas — só o que a clínica marcou em "Oferecer junto" ou retorno
    // vencido do histórico dela; nunca inferência sobre a pessoa.
    async sugerirComplementos(procedimentosNomes, filtro) {
      const procs = matchProcedures(procedures, procedimentosNomes);
      if (typeof procs === "string") return "nenhuma";
      // Mesmo dia/turno que a cliente pediu em consultar_horarios: oferta "na mesma
      // visita" num outro dia desmontaria o pedido dela
      const ofertaData = filtro?.data && isRealDateISO(filtro.data) && filtro.data >= todayISO(tz) ? filtro.data : null;
      const ofertaTurno = filtro?.turno ?? null;
      const ofertaOpts = ofertaData
        ? { fromDate: ofertaData, onlyThatDay: true, period: ofertaTurno }
        : ofertaTurno
          ? { period: ofertaTurno, perDay: 1, days: 14 }
          : {};
      const semHorario = ofertaData
        ? `  horários: nenhum livre ${dayPhrase(ofertaData)}${ofertaTurno ? ` (${ofertaTurno === "manha" ? "de manhã" : ofertaTurno === "tarde" ? "à tarde" : "à noite"})` : ""} — se oferecer, diga que a equipe confirma o horário`
        : "  horários: nenhum livre nos próximos dias — se oferecer, diga que a equipe confirma o horário";
      const catalogRows = await db
        .select({
          id: schema.procedures.id,
          name: schema.procedures.name,
          price: schema.procedures.price,
          priceOnRequest: schema.procedures.priceOnRequest,
          active: schema.procedures.active,
          returnDays: schema.procedures.returnDays,
          offerNote: schema.procedures.offerNote,
          promoText: schema.procedures.promoText,
          promoUntil: schema.procedures.promoUntil,
          durationMinutes: schema.procedures.durationMinutes,
        })
        .from(schema.procedures)
        .where(eq(schema.procedures.clinicId, clinic.id));
      const pairings = await db
        .select({ procedureId: schema.procedurePairings.procedureId, relatedId: schema.procedurePairings.relatedId })
        .from(schema.procedurePairings)
        .where(eq(schema.procedurePairings.clinicId, clinic.id));
      const doneAppts = await db
        .select({ procedureId: schema.appointments.procedureId, startsAt: schema.appointments.startsAt })
        .from(schema.appointments)
        .where(and(eq(schema.appointments.customerId, customer.id), eq(schema.appointments.status, "showed")));
      const doneHist = await db
        .select({ procedureId: schema.customerHistoryEntries.procedureId, occurredOn: schema.customerHistoryEntries.occurredOn })
        .from(schema.customerHistoryEntries)
        .where(eq(schema.customerHistoryEntries.customerId, customer.id));
      const history = [
        ...doneAppts
          .filter((a) => a.procedureId)
          .map((a) => ({ procedureId: a.procedureId!, lastOn: utcToZoned(new Date(a.startsAt), tz).dateISO })),
        ...doneHist.filter((h) => h.procedureId).map((h) => ({ procedureId: h.procedureId!, lastOn: h.occurredOn })),
      ];
      const futureAppts = await db
        .select({ procedureId: schema.appointments.procedureId })
        .from(schema.appointments)
        .where(
          and(
            eq(schema.appointments.customerId, customer.id),
            inArray(schema.appointments.status, ["scheduled", "confirmed"]),
            gt(schema.appointments.startsAt, new Date()),
          ),
        );
      const upcomingIds = futureAppts.map((u) => u.procedureId).filter((x): x is string => Boolean(x));
      const suggestions = suggestOffers({
        askedIds: procs.map((p) => p.id),
        upcomingIds,
        history,
        catalog: catalogRows.map((p) => ({ ...p, price: Number(p.price) })),
        pairings,
        today: todayISO(tz),
        customerFirstName: null,
        max: 2,
      });
      if (suggestions.length === 0) return "nenhuma";
      const durationOf = new Map(catalogRows.map((p) => [p.id, p.durationMinutes]));
      const priceRowOf = new Map(catalogRows.map((p) => [p.id, p]));
      const linhas: string[] = [];
      for (const s of suggestions) {
        const comboIds = s.pairedWithId ? [s.pairedWithId, s.procedure.id] : [s.procedure.id];
        let combined = comboIds.length > 1;
        let pros = await eligibleProfessionalIds(db, clinic.id, comboIds);
        let slots = await findSlots(
          db,
          clinic.id,
          tz,
          comboIds.reduce((acc, id) => acc + (durationOf.get(id) ?? 60), 0),
          3,
          pros,
          ofertaOpts,
        );
        if (slots.length === 0 && combined) {
          combined = false;
          pros = await eligibleProfessionalIds(db, clinic.id, [s.procedure.id]);
          slots = await findSlots(db, clinic.id, tz, durationOf.get(s.procedure.id) ?? 60, 3, pros, ofertaOpts);
        }
        if (pros.length === 0) continue;
        const promo = activePromo(s.procedure, todayISO(tz));
        linhas.push(
          [
            `- ${s.procedure.name} (${customerPriceLabel(priceRowOf.get(s.procedure.id) ?? { price: s.procedure.price, priceOnRequest: false })}${
              priceRowOf.get(s.procedure.id)?.priceOnRequest ? " — não cite valor; o profissional define na avaliação" : ""
            })`,
            `  motivo: ${s.why}`,
            s.procedure.offerNote ? `  como a clínica quer oferecer: "${s.procedure.offerNote}"` : null,
            promo ? `  promoção vigente: ${promo}` : null,
            slots.length === 0
              ? semHorario
              : `  horários ${combined ? "na MESMA visita que o pedido" : "(visita separada)"}: ${slots.map((x) => x.label).join("; ")}`,
          ]
            .filter(Boolean)
            .join("\n"),
        );
      }
      if (linhas.length === 0) return "nenhuma";
      return `Ofertas complementares AUTORIZADAS pela clínica (ofereça no máximo uma, uma única vez, em uma frase leve; use só estes horários):\n${linhas.join("\n")}`;
    },
  };

  // ── Chamada do agente ────────────────────────────────────────────
  // Provedor da própria clínica (Configurações) ou o padrão do sistema
  const aiConfig = resolveClinicAiConfig(clinic.settings, process.env);
  if (!aiConfig) return; // clinicHasAiEnabled já barrou antes — cinto de segurança

  const reply = await runAgentTurn(
    {
      persona: { assistantName: aiSettings.assistantName, tone: aiSettings.tone },
      clinic: {
        name: clinic.name,
        city: clinic.addressCity,
        address: clinicAddress,
        phone: clinicPhone,
        businessHoursLabel,
        catalog: procedures.map((p) => ({
          name: p.name,
          price: formatPriceNumber(p.price),
          priceMode: priceMode(p),
          durationMinutes: p.durationMinutes,
        })),
        facts: knowledgeFactsText(clinic.settings),
        offersEnabled: aiSettings.offers,
      },
      customer: {
        firstName: nameReliability(customer.fullName).firstName,
        nameConfirmed: nameReliability(customer.fullName).confirmed,
        isNew: customer.status === "lead" && (visits?.count ?? 0) === 0,
        visitsCount: visits?.count ?? 0,
        upcomingAppointment: upcomingLabel,
        activeGoal,
        packageSummary,
      },
      nowLabel: `${weekdays[nowZ.weekday]}, ${nd}/${nm}/${ny}, ${nowZ.timeHHMM} (horário de Brasília)`,
      calendarLabel: upcomingCalendar(nowZ.dateISO),
      history,
      nudge: nudgeMinutes ? { minutes: nudgeMinutes } : undefined,
    },
    executors,
    { config: aiConfig },
  );

  await recordAiUsage({
    clinicId: clinic.id,
    purpose: "agent",
    model: aiConfig.agentModel,
    usage: reply.usage,
    ownKey: parseClinicAiProvider(clinic.settings).mode === "custom",
  });
  await notifySpendThresholds(clinic, logger).catch((err) =>
    logger.warn({ err }, "aviso de gastos falhou"),
  );

  // Releitura AO VIVO antes de falar: se uma humana assumiu a conversa (takeover)
  // ou a cliente mandou mensagem nova durante o turno, a resposta é descartada —
  // a IA nunca fala por cima de ninguém, e o turno seguinte responde ao conjunto
  const live = (
    await db
      .select({
        mode: schema.conversations.mode,
        lastInboundAt: schema.conversations.lastInboundAt,
        aiTurnAfter: schema.conversations.aiTurnAfter,
      })
      .from(schema.conversations)
      .where(eq(schema.conversations.id, conversation.id))
      .limit(1)
  )[0];
  // Mensagem nova que pede resposta (texto, anexo...) — figurinha e reação não
  // descartam a resposta: elas não agendam turno, e a cliente ficaria sem nada
  let newerNeedsTurn = Boolean(live?.aiTurnAfter);
  if (!newerNeedsTurn && live?.lastInboundAt && conversation.lastInboundAt && live.lastInboundAt > conversation.lastInboundAt) {
    const newer = await db
      .select({ type: schema.messages.type, body: schema.messages.body })
      .from(schema.messages)
      .where(
        and(
          eq(schema.messages.conversationId, conversation.id),
          eq(schema.messages.direction, "inbound"),
          gt(schema.messages.createdAt, conversation.lastInboundAt),
        ),
      )
      .limit(20);
    newerNeedsTurn = newer.some((m) => storedMessageTriggersTurn(m.type, m.body));
  }
  // Escalou sem urgência? O que chegou DURANTE o turno a atendente não leu — se é
  // queixa de saúde (a explicação digitada depois da foto), a conversa vira urgente
  if (reply.escalated && !urgentThisTurn) {
    const lidaAte = chronological[chronological.length - 1]?.createdAt;
    await flagUrgentIfHealth(clinic.id, conversation.id, customer.id, logger, {
      after: lidaAte ? new Date(lidaAte) : undefined,
    });
  }

  // Exceção: quando foi ESTE turno que tirou a conversa do automático, a despedida
  // ("vou chamar alguém da equipe") PRECISA sair — a conversa já está com a equipe
  // e nenhum turno seguinte vai falar com ela. Equipe que assumiu (human) ou outro
  // turno que escalou antes: nada sai daqui
  const modeOk =
    live?.mode === "ai" || (live?.mode === "waiting_human" && reply.escalated && movedByThisTurn);
  if (!live || !modeOk || (newerNeedsTurn && !reply.escalated)) {
    logger.info(
      { conversationId: conversation.id, mode: live?.mode },
      "turno da IA descartado (takeover ou nova mensagem durante o turno)",
    );
    return;
  }

  // Turno de toque em que o modelo decidiu ficar em silêncio: nada a enviar
  if (reply.balloons.length === 0) {
    logger.info({ conversationId: conversation.id }, "toque dispensado pelo modelo (conversa já encerrada)");
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

  // Rede de segurança: foto, áudio, vídeo, documento (ou o que só aparece no
  // celular) SEMPRE chega a uma pessoa. Se a atendente respondeu sem passar a
  // conversa para a equipe, o sistema passa agora (os balões dela saem normalmente)
  if (pendingHumanReason && !reply.escalated) {
    await escalateToTeam(clinic.id, conversation.id, customer.id, pendingHumanReason, logger);
  }

  // Sem o motivo da escalada no log: ele pode trazer queixa de saúde (fica em notifications, sob RLS)
  logger.info(
    {
      conversationId: conversation.id,
      balloons: reply.balloons.length,
      escalated: reply.escalated,
      urgent: urgentThisTurn,
      tokens: reply.usage,
      tools: reply.toolTrace,
    },
    "turno da IA concluído",
  );
}

// ── Utilitários ──────────────────────────────────────────────────────

/** Nome "de verdade" = 2+ palavras e não é telefone. Perfil do WhatsApp com
 *  apelido de uma palavra serve para cumprimentar, não para agendar. */
function nameReliability(fullName: string): { firstName: string; confirmed: boolean } {
  const name = fullName.trim();
  if (!name || /^\+?\d+$/.test(name)) return { firstName: "", confirmed: false };
  const words = name.split(/\s+/);
  return { firstName: words[0] ?? "", confirmed: words.length >= 2 };
}

function matchProcedure(
  procedures: { id: string; name: string; price: string; durationMinutes: number }[],
  name: string | null,
) {
  if (!name) return procedures[0] ?? null;
  const norm = (s: string) =>
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  const pedido = norm(name);
  if (!pedido) return null;
  const catalogo = procedures.map((p) => ({ p, n: norm(p.name) }));
  // Nome exato primeiro — "Consulta" nunca pode virar "Consulta de retorno" (outra
  // duração, outro serviço) só porque o catálogo veio em outra ordem
  return (
    catalogo.find((c) => c.n === pedido)?.p ??
    catalogo.filter((c) => c.n.startsWith(pedido)).sort((a, b) => a.n.length - b.n.length)[0]?.p ??
    catalogo.filter((c) => c.n.includes(pedido)).sort((a, b) => a.n.length - b.n.length)[0]?.p ??
    catalogo.filter((c) => pedido.includes(c.n)).sort((a, b) => b.n.length - a.n.length)[0]?.p ??
    null
  );
}

/** Uma OU várias na mesma visita. Lista vazia = primeiro do catálogo (compat).
 *  Nome desconhecido → devolve STRING com a mensagem de erro para o modelo. */
export function matchProcedures(
  procedures: { id: string; name: string; price: string; durationMinutes: number }[],
  nomes: string[],
): { id: string; name: string; price: string; durationMinutes: number }[] | string {
  if (nomes.length === 0) {
    const first = procedures[0];
    return first ? [first] : "Catálogo vazio — escale para a equipe.";
  }
  const achados: { id: string; name: string; price: string; durationMinutes: number }[] = [];
  // "Limpeza de Pele + Peeling" numa string só (copiado do contexto) = dois serviços
  const separados = nomes.flatMap((n) => n.split(/\s*\+\s*/)).filter((n) => n.trim());
  for (const nome of separados) {
    const proc = matchProcedure(procedures, nome);
    if (!proc) {
      return `Procedimento "${nome}" não encontrado no catálogo. Opções: ${procedures.map((p) => p.name).join(", ")}.`;
    }
    // Mesmo procedimento repetido na lista não duplica a visita
    if (!achados.some((a) => a.id === proc.id)) achados.push(proc);
  }
  return achados;
}

const DAY_ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
const DAY_NAMES: Record<string, string> = {
  mon: "segunda",
  tue: "terça",
  wed: "quarta",
  thu: "quinta",
  fri: "sexta",
  sat: "sábado",
  sun: "domingo",
};

/** "segunda a sexta das 08:00 às 19:00, sábado das 09:00 às 14:00 (não atende: domingo)" —
 *  agrupa dias consecutivos com o mesmo horário; dia ausente = fechado. */
function businessHoursToLabel(hours: Record<string, [string, string][]>): string {
  const groups: { days: string[]; label: string }[] = [];
  for (const day of DAY_ORDER) {
    const ranges = hours[day] ?? [];
    if (ranges.length === 0) continue;
    const label = ranges.map(([open, close]) => `das ${open} às ${close}`).join(" e ");
    const last = groups[groups.length - 1];
    const prevDay = DAY_ORDER[DAY_ORDER.indexOf(day) - 1];
    if (last && last.label === label && last.days[last.days.length - 1] === prevDay) {
      last.days.push(day);
    } else {
      groups.push({ days: [day], label });
    }
  }
  if (groups.length === 0) return "segunda a sexta em horário comercial";
  const parts = groups.map((g) => {
    const first = DAY_NAMES[g.days[0]!];
    const last = DAY_NAMES[g.days[g.days.length - 1]!];
    const dias =
      g.days.length === 1 ? first : g.days.length === 2 ? `${first} e ${last}` : `${first} a ${last}`;
    return `${dias} ${g.label}`;
  });
  const fechados = DAY_ORDER.filter((d) => (hours[d] ?? []).length === 0).map((d) => DAY_NAMES[d]);
  const nota = fechados.length > 0 ? ` (não atende: ${fechados.join(", ")})` : "";
  return parts.join(", ") + nota;
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
  const plan = [
    { automationId: "reminder_24h", offsetMs: 24 * 3_600_000 },
    { automationId: "confirm_2h", offsetMs: 2 * 3_600_000 },
    { automationId: "reminder_45min", offsetMs: 45 * 60_000 },
  ];
  for (const item of plan) {
    if (!enabledSet.has(item.automationId)) continue;
    const idealAt = startsAt.getTime() - item.offsetMs;
    // Marco que já passou não dispara na hora — a cliente ACABOU de marcar
    // nesta conversa; pedir confirmação em seguida é cara de robô. O
    // próximo marco da cadência (2h/45min) cobre a confirmação.
    if (idealAt <= now) continue;
    await db
      .insert(schema.automationRuns)
      .values({
        clinicId,
        automationId: item.automationId,
        customerId,
        appointmentId,
        nextRunAt: new Date(idealAt),
      })
      .onConflictDoNothing();
  }
}

