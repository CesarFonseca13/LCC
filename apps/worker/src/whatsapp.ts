import { and, asc, eq, isNull, lte, or, sql } from "drizzle-orm";
import type { Logger } from "pino";
import { jidToPhone, normalizeEvent, type EvolutionClient } from "@clinicaos/whatsapp";
import { schema, unsafeGlobalDb } from "@clinicaos/db";
import { clinicHasAiEnabled, scheduleAiTurn } from "./ai-agent";
import { classifyInbound } from "./classify-inbound";

/**
 * Processadores WhatsApp do worker.
 * O worker conecta com role BYPASSRLS (varre cross-tenant) e escopa cada
 * escrita explicitamente pelo clinic_id do evento — a verdade é o Postgres.
 */

const STATUS_RANK: Record<string, number> = {
  sending: 0,
  sent: 1,
  delivered: 2,
  read: 3,
};

/** Varre eventos não processados e materializa conversas/mensagens/clientes. */
export async function processEvents(logger: Logger): Promise<number> {
  const db = unsafeGlobalDb();
  const events = await db
    .select()
    .from(schema.whatsappEvents)
    .where(eq(schema.whatsappEvents.processed, false))
    .orderBy(asc(schema.whatsappEvents.id))
    .limit(50);

  for (const event of events) {
    try {
      await handleEvent(event, logger);
      await db
        .update(schema.whatsappEvents)
        .set({ processed: true, processedAt: new Date(), error: null })
        .where(eq(schema.whatsappEvents.id, event.id));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ eventId: event.id, err: message }, "falha ao processar evento");
      await db
        .update(schema.whatsappEvents)
        .set({ processed: true, processedAt: new Date(), error: message })
        .where(eq(schema.whatsappEvents.id, event.id));
    }
  }
  return events.length;
}

type WhatsappEventRow = typeof schema.whatsappEvents.$inferSelect;

async function handleEvent(event: WhatsappEventRow, logger: Logger): Promise<void> {
  const db = unsafeGlobalDb();
  const normalized = normalizeEvent(event.eventType, event.payload);

  switch (normalized.kind) {
    case "message": {
      if (normalized.fromMe) {
        await handleFromMe(event, normalized.waMessageId, normalized, logger);
        return;
      }
      // Mensagem do cliente: garante cliente + conversa + mensagem
      const phone = jidToPhone(normalized.remoteJid);
      if (!phone) return;

      const customerId = await ensureCustomer(
        event.clinicId,
        phone,
        normalized.pushName,
      );
      const conversationId = await ensureConversation(
        event.clinicId,
        event.instanceId,
        normalized.remoteJid,
        customerId,
      );

      const inserted = await db.execute(sql`
        INSERT INTO messages (clinic_id, conversation_id, direction, author, wa_message_id,
                              type, body, status)
        VALUES (${event.clinicId}, ${conversationId}, 'inbound', 'customer',
                ${normalized.waMessageId}, ${normalized.messageType},
                ${normalized.body}, 'received')
        ON CONFLICT DO NOTHING
        RETURNING id
      `);
      await db
        .update(schema.conversations)
        .set({
          lastMessageAt: new Date(),
          lastInboundAt: new Date(),
          unreadCount: sql`${schema.conversations.unreadCount} + 1`,
          status: "open",
        })
        .where(eq(schema.conversations.id, conversationId));

      // Roteamento (só mensagens de texto novas; dedupe não reprocessa):
      // IA conversacional ligada → agenda o turno com debounce;
      // senão → classificador de palavras-chave (Fase 1).
      if (
        (inserted.rowCount ?? 0) > 0 &&
        normalized.messageType === "text" &&
        normalized.body
      ) {
        if (await clinicHasAiEnabled(event.clinicId)) {
          await scheduleAiTurn(conversationId);
        } else {
          await classifyInbound(
            event.clinicId,
            conversationId,
            customerId,
            normalized.body,
            logger,
          );
        }
      }
      return;
    }

    case "status": {
      if (!normalized.status) return;
      const rows = await db
        .select({ id: schema.messages.id, status: schema.messages.status })
        .from(schema.messages)
        .where(
          and(
            eq(schema.messages.clinicId, event.clinicId),
            eq(schema.messages.waMessageId, normalized.waMessageId),
          ),
        )
        .limit(1);
      const msg = rows[0];
      if (!msg) return;
      // Só avança (sent → delivered → read); nunca regride
      if ((STATUS_RANK[normalized.status] ?? -1) > (STATUS_RANK[msg.status] ?? 99)) {
        await db
          .update(schema.messages)
          .set({ status: normalized.status })
          .where(eq(schema.messages.id, msg.id));
      }
      return;
    }

    case "connection": {
      // Já tratado sincronamente no webhook; aqui é idempotente (sweep de segurança)
      const statusMap = {
        open: "connected",
        connecting: "connecting",
        close: "disconnected",
        logout: "disconnected",
        unknown: null,
      } as const;
      const status = statusMap[normalized.state];
      if (status) {
        await db
          .update(schema.whatsappInstances)
          .set({ status, phoneE164: normalized.phoneNumber ?? undefined })
          .where(eq(schema.whatsappInstances.id, event.instanceId));
      }
      return;
    }

    default:
      return;
  }
}

/** fromMe=true: eco do nosso envio (ignora) ou takeover implícito (pausa a IA). */
async function handleFromMe(
  event: WhatsappEventRow,
  waMessageId: string,
  normalized: { remoteJid: string; body: string | null; messageType: string },
  logger: Logger,
): Promise<void> {
  const db = unsafeGlobalDb();

  const ours = await db
    .select({ id: schema.messages.id })
    .from(schema.messages)
    .where(
      and(
        eq(schema.messages.clinicId, event.clinicId),
        eq(schema.messages.waMessageId, waMessageId),
      ),
    )
    .limit(1);
  if (ours[0]) return; // eco de mensagem enviada pelo sistema

  // Reconciliação exactly-once: envio ficou em 'sending' (crash antes de gravar o id)?
  const pending = await db
    .select({ id: schema.messages.id, conversationId: schema.messages.conversationId })
    .from(schema.messages)
    .where(
      and(
        eq(schema.messages.clinicId, event.clinicId),
        eq(schema.messages.status, "sending"),
        isNull(schema.messages.waMessageId),
        eq(schema.messages.body, normalized.body ?? ""),
      ),
    )
    .limit(1);
  if (pending[0]) {
    await db
      .update(schema.messages)
      .set({ status: "sent", waMessageId, sentAt: new Date() })
      .where(eq(schema.messages.id, pending[0].id));
    logger.info({ messageId: pending[0].id }, "envio reconciliado via SEND_MESSAGE");
    return;
  }

  // Takeover implícito: alguém respondeu pelo celular da clínica → IA pausa
  const conversationId = await ensureConversation(
    event.clinicId,
    event.instanceId,
    normalized.remoteJid,
    null,
  );
  await db.execute(sql`
    INSERT INTO messages (clinic_id, conversation_id, direction, author, wa_message_id,
                          type, body, status)
    VALUES (${event.clinicId}, ${conversationId}, 'outbound', 'human', ${waMessageId},
            ${normalized.messageType}, ${normalized.body}, 'sent')
    ON CONFLICT DO NOTHING
  `);
  await db
    .update(schema.conversations)
    .set({ mode: "human", lastMessageAt: new Date() })
    .where(
      and(
        eq(schema.conversations.id, conversationId),
        eq(schema.conversations.mode, "ai"),
      ),
    );
}

async function ensureCustomer(
  clinicId: string,
  phone: string,
  pushName: string | null,
): Promise<string> {
  const db = unsafeGlobalDb();
  const existing = await db
    .select({ id: schema.customers.id })
    .from(schema.customers)
    .where(
      and(
        eq(schema.customers.clinicId, clinicId),
        isNull(schema.customers.deletedAt),
        or(
          eq(schema.customers.phoneE164, phone),
          sql`EXISTS (SELECT 1 FROM customer_phones cp
                      WHERE cp.customer_id = ${schema.customers.id}
                        AND cp.phone_e164 = ${phone})`,
        ),
      ),
    )
    .limit(1);
  if (existing[0]) return existing[0].id;

  const [created] = await db
    .insert(schema.customers)
    .values({
      clinicId,
      fullName: pushName ?? phone,
      phoneE164: phone,
      status: "lead",
      source: "whatsapp_inbound",
    })
    .onConflictDoNothing()
    .returning({ id: schema.customers.id });
  if (created) return created.id;

  // Corrida: outro processo criou entre o select e o insert
  const retry = await db
    .select({ id: schema.customers.id })
    .from(schema.customers)
    .where(
      and(eq(schema.customers.clinicId, clinicId), eq(schema.customers.phoneE164, phone)),
    )
    .limit(1);
  if (!retry[0]) throw new Error(`Falha ao garantir cliente para ${phone}`);
  return retry[0].id;
}

async function ensureConversation(
  clinicId: string,
  instanceId: string,
  remoteJid: string,
  customerId: string | null,
): Promise<string> {
  const db = unsafeGlobalDb();
  const existing = await db
    .select({ id: schema.conversations.id, customerId: schema.conversations.customerId })
    .from(schema.conversations)
    .where(
      and(
        eq(schema.conversations.instanceId, instanceId),
        eq(schema.conversations.remoteJid, remoteJid),
      ),
    )
    .limit(1);
  if (existing[0]) {
    if (!existing[0].customerId && customerId) {
      await db
        .update(schema.conversations)
        .set({ customerId })
        .where(eq(schema.conversations.id, existing[0].id));
    }
    return existing[0].id;
  }

  const [created] = await db
    .insert(schema.conversations)
    .values({ clinicId, instanceId, remoteJid, customerId })
    .onConflictDoNothing()
    .returning({ id: schema.conversations.id });
  if (created) return created.id;

  const retry = await db
    .select({ id: schema.conversations.id })
    .from(schema.conversations)
    .where(
      and(
        eq(schema.conversations.instanceId, instanceId),
        eq(schema.conversations.remoteJid, remoteJid),
      ),
    )
    .limit(1);
  if (!retry[0]) throw new Error(`Falha ao garantir conversa ${remoteJid}`);
  return retry[0].id;
}

/**
 * Fila de envio (a verdade é o Postgres): pega mensagens 'queued' vencidas,
 * reivindica com update otimista e envia. Exactly-once:
 * 'sending' é gravado ANTES do POST; crash no meio → reconciliação, nunca reenvio cego.
 */
export async function processOutbound(
  evolution: EvolutionClient,
  logger: Logger,
): Promise<number> {
  const db = unsafeGlobalDb();
  const due = await db
    .select({ id: schema.messages.id })
    .from(schema.messages)
    .where(
      and(
        eq(schema.messages.status, "queued"),
        or(
          isNull(schema.messages.scheduledFor),
          lte(schema.messages.scheduledFor, new Date()),
        ),
      ),
    )
    .orderBy(asc(schema.messages.createdAt))
    .limit(10);

  let sent = 0;
  for (const { id } of due) {
    // Claim otimista: só um worker leva a mensagem
    const claimed = await db
      .update(schema.messages)
      .set({ status: "sending" })
      .where(and(eq(schema.messages.id, id), eq(schema.messages.status, "queued")))
      .returning({
        id: schema.messages.id,
        clinicId: schema.messages.clinicId,
        conversationId: schema.messages.conversationId,
        body: schema.messages.body,
      });
    const msg = claimed[0];
    if (!msg?.body) continue;

    const convRows = await db
      .select({
        remoteJid: schema.conversations.remoteJid,
        instanceId: schema.conversations.instanceId,
      })
      .from(schema.conversations)
      .where(eq(schema.conversations.id, msg.conversationId))
      .limit(1);
    const conv = convRows[0];
    if (!conv) continue;

    const instRows = await db
      .select({
        name: schema.whatsappInstances.evolutionInstanceName,
        status: schema.whatsappInstances.status,
      })
      .from(schema.whatsappInstances)
      .where(eq(schema.whatsappInstances.id, conv.instanceId))
      .limit(1);
    const inst = instRows[0];
    if (!inst || inst.status !== "connected") {
      await db
        .update(schema.messages)
        .set({ status: "queued" }) // instância fora: volta para a fila
        .where(eq(schema.messages.id, msg.id));
      continue;
    }

    try {
      // Delay nativo = "digitando..." proporcional ao texto (2s–8s)
      const delayMs = Math.min(Math.max(msg.body.length * 60, 2000), 8000);
      const result = await evolution.sendText(inst.name, conv.remoteJid, msg.body, delayMs);
      await db
        .update(schema.messages)
        .set({
          status: "sent",
          waMessageId: result.waMessageId ?? null,
          sentAt: new Date(),
        })
        .where(eq(schema.messages.id, msg.id));
      await db
        .update(schema.conversations)
        .set({ lastMessageAt: new Date() })
        .where(eq(schema.conversations.id, msg.conversationId));
      sent++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ messageId: msg.id, err: message }, "falha no envio");
      await db
        .update(schema.messages)
        .set({ status: "failed", error: message })
        .where(eq(schema.messages.id, msg.id));
    }
  }
  return sent;
}

/** 'sending' antigo sem confirmação → failed (nunca reenvia proativa em dúvida). */
export async function reconcileStuckSending(logger: Logger): Promise<void> {
  const db = unsafeGlobalDb();
  const cutoff = new Date(Date.now() - 120_000);
  const stuck = await db
    .update(schema.messages)
    .set({
      status: "failed",
      error: "Envio interrompido sem confirmação — verifique antes de reenviar.",
    })
    .where(
      and(
        eq(schema.messages.status, "sending"),
        isNull(schema.messages.waMessageId),
        lte(schema.messages.createdAt, cutoff),
      ),
    )
    .returning({ id: schema.messages.id });
  if (stuck.length > 0) {
    logger.warn({ count: stuck.length }, "mensagens 'sending' expiradas marcadas como failed");
  }
}
