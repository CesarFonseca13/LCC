import { and, desc, eq, gt, gte, inArray, isNotNull } from "drizzle-orm";
import type { Logger } from "pino";
import { schema, unsafeGlobalDb } from "@clinicaos/db";
import { IGNORABLE_UNSUPPORTED, PHONE_ONLY_MESSAGE_BODY, UNAVAILABLE_MESSAGE_BODY } from "@clinicaos/whatsapp";

/**
 * Mensagem sem texto que pede uma pessoa (áudio, foto, vídeo, documento,
 * localização, contato, mensagem que a Meta não entregou). Figurinha, GIF,
 * reação, edição, fixar mensagem e voto em enquete não pedem resposta.
 *
 * Com a atendente ligada, quem decide é ela (vê o marcador "[foto]", resolve o
 * texto que veio junto, avalia a urgência e passa para a equipe); o fim do turno
 * tem rede de segurança para foto/áudio/vídeo/documento e para o que só aparece
 * no celular. Sem atendente, a conversa vai direto para "precisa de você".
 */

const MEDIA_REASON: Record<string, string> = {
  audio: "mandou um áudio (ouça no WhatsApp do celular da clínica)",
  image: "mandou uma foto",
  video: "mandou um vídeo",
  document: "mandou um documento",
  location: "mandou uma localização",
};

const UNAVAILABLE_REASON =
  "mandou uma mensagem que não chegou ao sistema (veja no WhatsApp do celular da clínica)";
const PHONE_ONLY_REASON =
  "mandou algo que só aparece no WhatsApp do celular da clínica (enquete, visualização única, localização em tempo real...)";

/** Motivo da passagem para a equipe, ou null quando a mensagem não pede pessoa. */
export function mediaEscalationReason(
  messageType: string,
  rawType: string | undefined,
  body: string | null,
): string | null {
  if (rawType === "gif") return null;
  if (rawType?.startsWith("unsupported:")) {
    if (IGNORABLE_UNSUPPORTED.has(rawType.slice("unsupported:".length))) return null;
    return body === PHONE_ONLY_MESSAGE_BODY ? PHONE_ONLY_REASON : UNAVAILABLE_REASON;
  }
  if (rawType === "contacts") {
    const label = body?.replace(/^\[contato:?\s*|\]$/g, "").trim();
    return label ? `mandou um contato: ${label}` : "mandou um contato";
  }
  const base = MEDIA_REASON[messageType];
  if (!base) return null;
  const text = body?.trim();
  return text ? `${base}: "${text.slice(0, 120)}"` : base;
}

/** Anexos que a atendente nunca resolve sozinha: no fim do turno, se ela não
 *  passou a conversa para a equipe, o sistema passa (rede de segurança). */
export const HUMAN_ONLY_MEDIA = new Set(["audio", "image", "video", "document"]);

/** Mensagem JÁ GRAVADA que só uma pessoa resolve (o tipo original da Meta não
 *  fica no banco: o corpo marcador identifica o que só aparece no celular). */
export function storedHumanOnlyReason(type: string, body: string | null): string | null {
  if (HUMAN_ONLY_MEDIA.has(type)) return mediaEscalationReason(type, undefined, body);
  if (type === "other" && body === PHONE_ONLY_MESSAGE_BODY) return PHONE_ONLY_REASON;
  return null;
}

/** Mensagem JÁ GRAVADA que agenda turno da atendente (texto, anexo, contato,
 *  mensagem indisponível). Figurinha, GIF, reação ("Reagiu com 👍") e o que veio
 *  sem nada não agendam — e por isso não podem descartar um turno em andamento. */
export function storedMessageTriggersTurn(type: string, body: string | null): boolean {
  if (type === "text") return Boolean(body?.trim());
  if (HUMAN_ONLY_MEDIA.has(type) || type === "location") return true;
  if (type === "other" && body) {
    return body === UNAVAILABLE_MESSAGE_BODY || body === PHONE_ONLY_MESSAGE_BODY || body.startsWith("[contato");
  }
  return false;
}

/** Anexo sem atendente ligada: direto para a equipe. */
export function escalateMediaToHuman(
  clinicId: string,
  conversationId: string,
  customerId: string | null,
  reason: string,
  logger: Logger,
): Promise<boolean> {
  return escalateToTeam(clinicId, conversationId, customerId, reason, logger);
}

/**
 * Passa para a equipe ("precisa de você") uma conversa que estava no automático,
 * com o motivo no aviso. Devolve false quando ela já não estava no automático
 * (já com a equipe ou já esperando): nada de aviso repetido.
 */
export async function escalateToTeam(
  clinicId: string,
  conversationId: string,
  customerId: string | null,
  reason: string,
  logger: Logger,
): Promise<boolean> {
  const db = unsafeGlobalDb();
  // Só quem estava no automático: conversa já com a equipe (ou já esperando) não
  // gera alerta repetido — e o turno da IA que estava agendado é cancelado
  const moved = await db
    .update(schema.conversations)
    .set({ mode: "waiting_human", aiTurnAfter: null })
    .where(and(eq(schema.conversations.id, conversationId), eq(schema.conversations.mode, "ai")))
    .returning({ id: schema.conversations.id });
  if (!moved[0]) return false;

  const customer = customerId
    ? (
        await db
          .select({ name: schema.customers.fullName })
          .from(schema.customers)
          .where(eq(schema.customers.id, customerId))
          .limit(1)
      )[0]
    : undefined;
  await db.insert(schema.notifications).values({
    clinicId,
    type: "conversation_needs_human",
    title: `${customer?.name ?? "Cliente"} precisa de você no WhatsApp`,
    body: `${reason.charAt(0).toUpperCase()}${reason.slice(1)}.`,
    refTable: "conversations",
    refId: conversationId,
  });
  // Sem o motivo no log: pode trazer legenda com dado de saúde
  logger.info({ conversationId }, "conversa passada para a equipe");
  return true;
}

// ── Urgência em conversa que já espera a equipe ───────────────────────

/**
 * Queixa de saúde (texto sem acento, minúsculas). Formas reais de relatar efeito
 * adverso (dor, inchaço, falta de ar, vômito, "passei mal", dose dobrada...) e
 * NUNCA palavras soltas que aparecem em conversa comum ("pus o comprovante",
 * "que tonta", "portão vermelho", "sem ar condicionado"). Lista para revisar
 * com o médico da clínica.
 */
const HEALTH_RE = new RegExp(
  "\\b(" +
    [
      "dor|dores|doendo|doeu|doer|doi muito|dolorid\\w*",
      "inchad\\w*|inchac\\w*|inchou|inchan\\w*",
      "vermelhidao|avermelhad\\w*|(ficou|esta|ta|todo|toda|muito|bem) vermelh\\w*",
      "reacao alergica|alergi\\w*|(tive|deu|dando|teve|tendo) (uma )?reac(ao|oes)",
      "coceira|cocando|ardend\\w*|ardencia|queimand\\w*",
      "falta de ar|(fiquei|estou|to|tou|ficando) sem ar(?! condicionado)|nao consigo respirar|dificuldade (para|pra|de) respirar",
      "(saiu|saindo|sai|com|muito) sangue|sangue (no|na|nos|nas) (local|lugar|urina|fezes|vomito)|sangr\\w*",
      "febre",
      "(com|saindo|saiu|sai|soltando|tem|cheio de|cheia de|formou|formando) pus",
      "infecc\\w*|infeccion\\w*",
      "(ficou|esta|ta|deixou) rox[oa]|mancha roxa|hematoma\\w*",
      "tontura|tonteira|(estou|to|tou|fiquei|me sinto|sentindo|ficando) tont[ao]",
      "desmai\\w*",
      "vomit\\w*|vomito\\w*",
      "enjoo\\w*|enjoad[ao]|enjoando|nausea\\w*",
      "diarreia",
      "palpitac\\w*|taquicardia|coracao (acelerado|disparado)",
      "passando mal|passei mal|(to|tou|estou|fiquei|me sentindo|sentindo) (muito |bem )?mal|nao (to|tou|estou) bem|mal estar",
      "hipoglicemia|glicose (baixa|caiu|muito alta)|desidrat\\w*",
      "caroc\\w*|nodul\\w*|endurec\\w*",
      "fraqueza|tremedeira|tremendo|suando frio|suor frio",
      "pressao (alta|baixa|caiu)|visao (turva|embacada)",
      "dose (dobrada|errada|a mais)|(apliquei|tomei)( a dose| o remedio| a injecao| a caneta)? (duas|2) vezes",
      "nao consigo (comer|beber|engolir)|gravida|pancreatite",
      "urgente|urgencia|emergencia",
    ].join("|") +
    ")\\b",
);
/** "não é urgente", "sem urgência": tira antes de testar. */
const NOT_URGENT_RE = /\b(nao (e|eh|tem|precisa ser) (nada )?urgen\w*|sem urgencia|nada urgente)\b/g;
/** Marca de quem relata o que está sentindo (1ª pessoa / estado atual). */
const FIRST_PERSON_RE = /\b(estou|to|tou|fiquei|ficou|meu|minha|comigo|sinto|senti|tive|tenho|esta|ta)\b/;

function normalizeHealthText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function looksLikeHealthComplaint(text: string): boolean {
  const t = normalizeHealthText(text).replace(NOT_URGENT_RE, " ");
  if (!HEALTH_RE.test(t)) return false;
  // Pergunta de venda ("a aplicação dói?", "dá enjoo?", "quais as reações?") não é
  // queixa: termina em "?" e não fala de si
  if (/\?\s*$/.test(text.trim()) && !FIRST_PERSON_RE.test(t)) return false;
  return true;
}

/** "obrigada", "ok", "valeu", 🙏 — cortesia que não pede resposta nem equipe. */
const COURTESY_RE =
  /^(ok|okay|obrigad[ao]s?|brigad[ao]|muito obrigad[ao]|valeu|vlw|ta bom|ta|beleza|blz|de nada|tchau|igualmente|certo|entendi|combinado|perfeito|amem|amen)$/;

export function isCourtesyOnly(text: string | null): boolean {
  if (text === null) return true; // figurinha/reação sem texto
  if (/\?/.test(text)) return false;
  const t = normalizeHealthText(text);
  if (!t) return true; // só emoji / pontuação
  if (t.split(" ").length > 4 || looksLikeHealthComplaint(text)) return false;
  return COURTESY_RE.test(t.replace(/\s+(querida|doutor|doutora|dra|dr|moca|mo)$/, ""));
}

/** Corpo que é só nome de arquivo ("laudo_alergia.pdf") não é fala da cliente. */
function looksLikeFileName(body: string): boolean {
  return /^\S+\.[a-z0-9]{2,5}$/i.test(body.trim());
}

async function latestNotice(conversationId: string) {
  const db = unsafeGlobalDb();
  return (
    await db
      .select({
        type: schema.notifications.type,
        body: schema.notifications.body,
        createdAt: schema.notifications.createdAt,
      })
      .from(schema.notifications)
      .where(
        and(
          eq(schema.notifications.refTable, "conversations"),
          eq(schema.notifications.refId, conversationId),
          inArray(schema.notifications.type, ["conversation_needs_human", "conversation_urgent"]),
        ),
      )
      .orderBy(desc(schema.notifications.createdAt))
      .limit(1)
  )[0];
}

async function insertUrgent(
  clinicId: string,
  conversationId: string,
  customerId: string | null,
  text: string,
  previousReason: string | null,
  logger: Logger,
): Promise<void> {
  const db = unsafeGlobalDb();
  const customer = customerId
    ? (
        await db
          .select({ name: schema.customers.fullName })
          .from(schema.customers)
          .where(eq(schema.customers.id, customerId))
          .limit(1)
      )[0]
    : undefined;
  const antes = previousReason?.trim() ? ` — antes: ${previousReason.trim().slice(0, 80)}` : "";
  await db.insert(schema.notifications).values({
    clinicId,
    type: "conversation_urgent",
    title: `${customer?.name ?? "Cliente"} precisa de você no WhatsApp (urgente)`,
    body: `Nova mensagem: "${text.trim().slice(0, 120)}"${antes}`,
    refTable: "conversations",
    refId: conversationId,
  });
  logger.warn({ conversationId }, "queixa de saúde → conversa marcada como urgente");
}

/** Texto conhecido (ex.: legenda do anexo na clínica sem atendente): se é queixa
 *  de saúde e o aviso atual da conversa não é urgente, grava o urgente. */
export async function flagUrgentText(
  clinicId: string,
  conversationId: string,
  customerId: string | null,
  text: string | null,
  logger: Logger,
): Promise<void> {
  if (!text || looksLikeFileName(text) || !looksLikeHealthComplaint(text)) return;
  const last = await latestNotice(conversationId);
  if (last?.type === "conversation_urgent") return;
  await insertUrgent(clinicId, conversationId, customerId, text, last?.body ?? null, logger);
}

/**
 * Conversa que já espera a equipe (ou acabou de ser passada a ela): se alguma
 * mensagem da cliente na janela é queixa de saúde e o aviso atual ainda não é
 * urgente, grava um aviso URGENTE com a frase (o painel destaca, sobe na fila e
 * alerta no computador). Não muda o modo.
 * Janela: `after` (exclusivo: o que a atendente NÃO leu no turno que escalou),
 * `from` (inclusivo: a espera inteira, quando a escalada não passou pela IA) ou,
 * sem nenhum, as mensagens depois do aviso atual.
 */
export async function flagUrgentIfHealth(
  clinicId: string,
  conversationId: string,
  customerId: string | null,
  logger: Logger,
  window: { after?: Date; from?: Date } = {},
): Promise<void> {
  const db = unsafeGlobalDb();
  const last = await latestNotice(conversationId);
  if (last?.type === "conversation_urgent") return;

  const lowerBound = window.from
    ? gte(schema.messages.createdAt, window.from)
    : gt(
        schema.messages.createdAt,
        window.after ?? last?.createdAt ?? new Date(Date.now() - 30 * 60_000),
      );
  // As MAIS RECENTES primeiro: numa espera longa, a mensagem nova sempre entra
  const recent = await db
    .select({ type: schema.messages.type, body: schema.messages.body })
    .from(schema.messages)
    .where(
      and(
        eq(schema.messages.conversationId, conversationId),
        eq(schema.messages.direction, "inbound"),
        isNotNull(schema.messages.body),
        lowerBound,
      ),
    )
    .orderBy(desc(schema.messages.createdAt))
    .limit(50);
  const texts = recent
    .filter(
      (m) =>
        m.body &&
        m.body !== UNAVAILABLE_MESSAGE_BODY &&
        m.body !== PHONE_ONLY_MESSAGE_BODY &&
        !m.body.startsWith("[contato") &&
        !(m.type === "document" && looksLikeFileName(m.body)),
    )
    .map((m) => m.body as string);
  if (texts.length === 0) return;
  // Uma frase sozinha, ou a queixa quebrada em vários balões ("falta" / "de ar")
  const hit = texts.find((t) => looksLikeHealthComplaint(t));
  const joined = [...texts].reverse().join(" ");
  if (!hit && !looksLikeHealthComplaint(joined)) return;
  await insertUrgent(clinicId, conversationId, customerId, hit ?? joined.slice(-120), last?.body ?? null, logger);
}
