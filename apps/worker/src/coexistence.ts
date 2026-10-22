import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { Logger } from "pino";
import { brPhoneVariants, waDigitsToE164 } from "@clinicaos/whatsapp";
import { schema, unsafeGlobalDb } from "@clinicaos/db";
import { cleanPushName, ensureConversation, type Conn } from "./whatsapp";

/**
 * Importação da coexistência (API oficial + app WhatsApp Business no celular).
 * Depois da conexão, pedimos à Meta a agenda de contatos e até 6 meses de
 * conversas; a resposta chega em lotes pelos webhooks smb_app_state_sync e
 * history, gravados como eventos META_CONTACTS / META_HISTORY. Aqui eles viram
 * fichas, conversas e mensagens — SEM acordar a Ana, sem contar como "não lida"
 * e sem abrir negociação no funil (é passado, não demanda nova).
 * Cada lote é atômico (uma transação): falhou no meio, nada fica pela metade e
 * o evento é retentado pelo processador.
 */

type EventRow = typeof schema.whatsappEvents.$inferSelect;

interface ContactItem {
  type?: string;
  action?: string;
  contact?: { full_name?: string; first_name?: string; phone_number?: string };
}

interface HistoryMessage {
  from?: string;
  to?: string;
  id?: string;
  timestamp?: string | number;
  type?: string;
  text?: { body?: string };
  image?: { caption?: string };
  video?: { caption?: string };
  document?: { caption?: string; filename?: string };
  audio?: unknown;
  sticker?: unknown;
  location?: { name?: string; address?: string };
  reaction?: { emoji?: string };
  contacts?: { name?: { formatted_name?: string } }[];
  button?: { text?: string };
  interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } };
  history_context?: { status?: string };
}

interface HistoryItem {
  metadata?: { phase?: number; chunk_order?: number; progress?: number };
  threads?: { id?: string; messages?: HistoryMessage[] }[];
  errors?: { code?: number; message?: string; title?: string }[];
  /** Lote sintético montado pelo webhook a partir do complemento de mídia. */
  mediaFollowUp?: boolean;
}

const asArray = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

/** Trata os eventos da importação; devolve false se o evento não é deste módulo. */
export async function handleCoexistenceEvent(event: EventRow, logger: Logger): Promise<boolean> {
  if (event.eventType === "META_CONTACTS") {
    await unsafeGlobalDb().transaction((tx) => handleContacts(event, tx, logger));
    return true;
  }
  if (event.eventType === "META_HISTORY") {
    await unsafeGlobalDb().transaction((tx) => handleHistory(event, tx, logger));
    return true;
  }
  return false;
}

async function handleContacts(event: EventRow, tx: Conn, logger: Logger): Promise<void> {
  const payload = isObj(event.payload) ? event.payload : {};
  const metadata = isObj(payload.metadata) ? payload.metadata : {};
  const own = waDigitsToE164(String(metadata.display_phone_number ?? ""));
  let touched = 0;
  for (const item of asArray<ContactItem>(payload.state_sync)) {
    if (!item || typeof item !== "object" || item.type !== "contact" || item.action !== "add") continue; // "remove": a ficha fica
    const phone = waDigitsToE164(String(item.contact?.phone_number ?? ""));
    if (!phone || phone === own) continue;
    const name = item.contact?.full_name ?? item.contact?.first_name ?? null;
    const r = await importCustomer(event.clinicId, phone, name, tx);
    if (r.created || r.renamed) touched++;
  }
  await bumpSync(event.instanceId, { contacts: touched }, tx);
  logger.info({ instanceId: event.instanceId, touched }, "coexistência: contatos importados");
}

async function handleHistory(event: EventRow, tx: Conn, logger: Logger): Promise<void> {
  const payload = isObj(event.payload) ? event.payload : {};
  const item: HistoryItem = isObj(payload.item) ? (payload.item as HistoryItem) : {};
  const metadata = isObj(payload.metadata) ? payload.metadata : {};
  const errors = asArray<{ code?: number; message?: string; title?: string }>(item.errors ?? payload.errors);
  if (errors.length > 0) {
    const first = errors[0]!;
    if (first.code === 2593109) {
      await bumpSync(event.instanceId, { set: { historyShared: false, doneAt: new Date().toISOString() } }, tx);
    } else {
      await bumpSync(
        event.instanceId,
        { set: { historyError: `${first.code ?? ""} ${first.message ?? first.title ?? "erro"}`.trim().slice(0, 300) } },
        tx,
      );
    }
    logger.warn({ instanceId: event.instanceId, code: first.code }, "coexistência: histórico com erro");
    return;
  }

  const business = waDigitsToE164(String(metadata.display_phone_number ?? ""));
  const businessForms = business ? brPhoneVariants(business) : [];
  let threadsCreated = 0;
  let messagesInserted = 0;

  for (const thread of asArray<{ id?: string; messages?: HistoryMessage[] }>(item.threads)) {
    if (!thread || typeof thread !== "object") continue;
    const userDigits = String(thread.id ?? "").replace(/\D/g, "");
    const phone = waDigitsToE164(userDigits);
    if (!phone) continue;
    const userForms = brPhoneVariants(phone);
    const remoteJid = `${userDigits}@s.whatsapp.net`;
    const customer = await importCustomer(event.clinicId, phone, null, tx);
    const prior = (
      await tx
        .select({ id: schema.conversations.id })
        .from(schema.conversations)
        .where(and(eq(schema.conversations.instanceId, event.instanceId), eq(schema.conversations.remoteJid, remoteJid)))
        .limit(1)
    )[0];
    const conversationId = await ensureConversation(event.clinicId, event.instanceId, remoteJid, customer.id, tx);
    if (!prior) threadsCreated++;

    let newest = 0;
    let newestInbound = 0;
    let newestIsOutbound = false;
    for (const m of asArray<HistoryMessage>(thread.messages)) {
      if (!m || typeof m !== "object" || typeof m.id !== "string" || !m.id) continue;
      const fromE164 = waDigitsToE164(String(m.from ?? ""));
      // "to" só vem em eco da clínica; "from" igual ao número da clínica idem
      const outbound =
        m.to !== undefined ||
        (fromE164 !== null && businessForms.includes(fromE164)) ||
        (fromE164 !== null && !userForms.includes(fromE164));
      const ts = Number(m.timestamp);
      const whenSec = Number.isFinite(ts) && ts > 0 ? Math.floor(ts) : Math.floor(Date.now() / 1000);
      const { type, body } = describeMessage(m);
      const status = outbound ? mapStatus(m.history_context?.status) : "received";

      const r = await tx.execute(sql`
        INSERT INTO messages (clinic_id, conversation_id, direction, author, wa_message_id,
                              type, body, status, sent_at, created_at)
        VALUES (${event.clinicId}, ${conversationId}, ${outbound ? "outbound" : "inbound"},
                ${outbound ? "human" : "customer"}, ${m.id}, ${type}, ${body}, ${status},
                ${outbound ? sql`to_timestamp(${whenSec})` : null}, to_timestamp(${whenSec}))
        ON CONFLICT (conversation_id, wa_message_id) WHERE wa_message_id IS NOT NULL
        DO UPDATE SET type = EXCLUDED.type, body = COALESCE(EXCLUDED.body, messages.body)
          WHERE messages.type = 'other' AND EXCLUDED.type <> 'other'
        RETURNING (xmax = 0) AS inserted
      `);
      const row = r.rows[0] as { inserted?: boolean } | undefined;
      if (row?.inserted) messagesInserted++;
      if (whenSec >= newest) {
        newest = whenSec;
        newestIsOutbound = outbound;
      }
      if (!outbound) newestInbound = Math.max(newestInbound, whenSec);
    }

    // Datas só andam para frente; não mexe em status nem não lidas. Modo: se a
    // clínica estava atendendo essa pessoa pelo celular AGORA (última fala é
    // dela, nas últimas 24 h, e nada ao vivo veio depois), a Ana não entra no
    // meio — como faria com um eco ao vivo. Conversa antiga segue com a Ana.
    if (newest > 0) {
      await tx.execute(sql`
        UPDATE conversations
        SET last_message_at = GREATEST(COALESCE(last_message_at, 'epoch'::timestamptz), to_timestamp(${newest})),
            last_inbound_at = CASE WHEN ${newestInbound} > 0
              THEN GREATEST(COALESCE(last_inbound_at, 'epoch'::timestamptz), to_timestamp(${newestInbound}))
              ELSE last_inbound_at END,
            mode = CASE WHEN ${newestIsOutbound} AND mode = 'ai'
                         AND to_timestamp(${newest}) > now() - interval '24 hours'
                         AND (last_message_at IS NULL OR last_message_at <= to_timestamp(${newest}))
                    THEN 'human' ELSE mode END,
            updated_at = now()
        WHERE id = ${conversationId}
      `);
    }
  }

  const progress = Number(item.metadata?.progress);
  const phase = Number(item.metadata?.phase);
  await bumpSync(
    event.instanceId,
    {
      threads: threadsCreated,
      messages: messagesInserted,
      progress: Number.isFinite(progress) ? progress : undefined,
      phase: Number.isFinite(phase) ? phase : undefined,
      set: item.mediaFollowUp ? {} : { historyShared: true },
    },
    tx,
  );
  logger.info(
    { instanceId: event.instanceId, threadsCreated, messagesInserted, progress: item.metadata?.progress },
    "coexistência: lote de histórico gravado",
  );
}

/** Tipo e texto exibível de uma mensagem do histórico (mídia vem só como placeholder). */
export function describeMessage(m: HistoryMessage): { type: string; body: string | null } {
  const known = ["text", "image", "audio", "video", "document", "sticker", "location"];
  const type = m.type ?? "other";
  switch (type) {
    case "text":
      return { type, body: m.text?.body ?? null };
    case "image":
      return { type, body: m.image?.caption ?? null };
    case "video":
      return { type, body: m.video?.caption ?? null };
    case "document":
      return { type, body: m.document?.caption ?? m.document?.filename ?? null };
    case "location":
      return { type, body: [m.location?.name, m.location?.address].filter(Boolean).join(" — ") || null };
    case "reaction":
      return { type: "other", body: m.reaction?.emoji ? `Reagiu com ${m.reaction.emoji}` : null };
    case "contacts": {
      const names = asArray<{ name?: { formatted_name?: string } }>(m.contacts)
        .map((c) => c?.name?.formatted_name)
        .filter(Boolean);
      return { type: "other", body: names.length ? `Contato: ${names.join(", ")}` : "Contato compartilhado" };
    }
    case "button":
      return { type: "text", body: m.button?.text ?? null };
    case "interactive":
      return { type: "text", body: m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? null };
    default:
      return { type: known.includes(type) ? type : "other", body: null };
  }
}

export function mapStatus(raw: string | undefined): "sent" | "delivered" | "read" | "failed" {
  switch ((raw ?? "").toUpperCase()) {
    case "READ":
    case "PLAYED":
      return "read";
    case "DELIVERED":
      return "delivered";
    case "ERROR":
      return "failed";
    default:
      return "sent";
  }
}

/**
 * Ficha a partir de um contato/conversa importada: casa pelo telefone (com e sem o
 * nono dígito); existente com nome-placeholder (só o número) ganha o nome da agenda.
 * Nova nasce como lead vinda do WhatsApp, sem card no funil.
 */
export async function importCustomer(
  clinicId: string,
  phone: string,
  name: string | null,
  db: Conn = unsafeGlobalDb(),
): Promise<{ id: string; created: boolean; renamed: boolean }> {
  const forms = brPhoneVariants(phone);
  const clean = cleanPushName(name);
  const existing = (
    await db
      .select({ id: schema.customers.id, fullName: schema.customers.fullName })
      .from(schema.customers)
      .where(
        and(
          eq(schema.customers.clinicId, clinicId),
          isNull(schema.customers.deletedAt),
          or(
            inArray(schema.customers.phoneE164, forms),
            sql`EXISTS (SELECT 1 FROM customer_phones cp
                        WHERE cp.customer_id = ${schema.customers.id}
                          AND cp.phone_e164 IN ${forms})`,
          ),
        ),
      )
      .orderBy(
        sql`(${schema.customers.phoneE164} = ${phone}) DESC`,
        sql`(${schema.customers.status} <> 'lead') DESC`,
        sql`${schema.customers.createdAt} ASC`,
      )
      .limit(1)
  )[0];
  if (existing) {
    const placeholder = /^\+?\d[\d\s()-]*$/.test(existing.fullName.trim());
    if (clean && placeholder && clean !== existing.fullName) {
      await db
        .update(schema.customers)
        .set({ fullName: clean, updatedAt: new Date() })
        .where(eq(schema.customers.id, existing.id));
      return { id: existing.id, created: false, renamed: true };
    }
    return { id: existing.id, created: false, renamed: false };
  }

  const [created] = await db
    .insert(schema.customers)
    .values({ clinicId, fullName: clean ?? phone, phoneE164: phone, status: "lead", source: "whatsapp_import" })
    .onConflictDoNothing()
    .returning({ id: schema.customers.id });
  if (created) return { id: created.id, created: true, renamed: false };

  const retry = (
    await db
      .select({ id: schema.customers.id })
      .from(schema.customers)
      .where(and(eq(schema.customers.clinicId, clinicId), eq(schema.customers.phoneE164, phone), isNull(schema.customers.deletedAt)))
      .limit(1)
  )[0];
  if (!retry) throw new Error(`Falha ao importar contato ${phone}`);
  return { id: retry.id, created: false, renamed: false };
}

/** Atualiza o andamento no número: contadores somam, progresso só sobe, campos avulsos sobrescrevem. */
async function bumpSync(
  instanceId: string,
  p: {
    contacts?: number;
    threads?: number;
    messages?: number;
    progress?: number;
    phase?: number;
    set?: Record<string, string | number | boolean | null>;
  },
  db: Conn = unsafeGlobalDb(),
): Promise<void> {
  const extra = JSON.stringify({ ...(p.set ?? {}), lastEventAt: new Date().toISOString() });
  await db.execute(sql`
    UPDATE whatsapp_instances
    SET meta_sync = COALESCE(meta_sync, '{}'::jsonb)
      || jsonb_build_object(
           'contacts', COALESCE((meta_sync->>'contacts')::int, 0) + ${p.contacts ?? 0},
           'threads',  COALESCE((meta_sync->>'threads')::int, 0) + ${p.threads ?? 0},
           'messages', COALESCE((meta_sync->>'messages')::int, 0) + ${p.messages ?? 0},
           'progress', GREATEST(COALESCE((meta_sync->>'progress')::int, 0), ${p.progress ?? 0}),
           'phase',    GREATEST(COALESCE((meta_sync->>'phase')::int, 0), ${p.phase ?? 0})
         )
      || ${extra}::jsonb
      || CASE WHEN GREATEST(COALESCE((meta_sync->>'progress')::int, 0), ${p.progress ?? 0}) >= 100
                   AND (meta_sync->>'doneAt') IS NULL
              THEN jsonb_build_object('doneAt', now()) ELSE '{}'::jsonb END,
        updated_at = now()
    WHERE id = ${instanceId}
  `);
}
