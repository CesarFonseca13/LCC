import { and, asc, eq, isNull, lte, or, sql } from "drizzle-orm";
import type { Logger } from "pino";
import { jidToPhone, normalizeEvent, type EvolutionClient } from "@clinicaos/whatsapp";
import { schema, unsafeGlobalDb } from "@clinicaos/db";
import { clinicHasAiEnabled, scheduleAiTurn } from "./ai-agent";
import { classifyInbound } from "./classify-inbound";
import { pauseReactivationOnReply } from "./reactivation";

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

      // Resposta da cliente pausa qualquer cadência de reativação na hora
      // (nunca "fala por cima" de quem acabou de responder) — qualquer tipo de mensagem
      if ((inserted.rowCount ?? 0) > 0) {
        await pauseReactivationOnReply(event.clinicId, customerId);
        // Funil corre sozinho: o card sai de "Novo contato" para "Conversando"
        // quando o diálogo ENGATOU (ela voltou a escrever depois de ser
        // respondida) — a primeira mensagem fica em Novo contato.
        // Etapas nascem sob demanda (mesma regra das actions do funil)
        await db.execute(sql`
          INSERT INTO pipeline_stages (clinic_id, name, sort)
          SELECT ${event.clinicId}, 'Conversando', 1
          WHERE NOT EXISTS (SELECT 1 FROM pipeline_stages
                            WHERE clinic_id = ${event.clinicId} AND name = 'Conversando')
        `);
        await db.execute(sql`
          UPDATE deals d SET stage_id = s2.id, updated_at = now()
          FROM pipeline_stages s2
          WHERE d.clinic_id = ${event.clinicId} AND d.customer_id = ${customerId}
            AND d.status = 'open'
            AND s2.clinic_id = d.clinic_id AND s2.name = 'Conversando'
            AND (d.stage_id IS NULL OR d.stage_id IN (
              SELECT id FROM pipeline_stages s1
              WHERE s1.clinic_id = d.clinic_id AND s1.name = 'Novo contato'
            ))
            AND EXISTS (
              SELECT 1 FROM messages m
              JOIN conversations c2 ON c2.id = m.conversation_id
              WHERE c2.customer_id = d.customer_id AND m.direction = 'outbound'
            )
        `);
      }

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
    .set({
      // "aguardando humano" também é resolvido por resposta via celular da clínica
      mode: sql`CASE WHEN mode IN ('ai', 'waiting_human') THEN 'human' ELSE mode END`,
      lastMessageAt: new Date(),
    })
    .where(eq(schema.conversations.id, conversationId));
}

/**
 * Multi-número: escolhe POR CLIENTE qual número da clínica fala com ela.
 * Regra de ouro: quem já conversou com um número continua nele (cliente real
 * não recebe a clínica de 3 números diferentes); cliente nova usa o principal;
 * principal fora do ar → qualquer número conectado.
 */
export async function pickInstanceForCustomer(
  clinicId: string,
  customerId: string,
): Promise<{ id: string; name: string } | null> {
  const db = unsafeGlobalDb();
  const rows = await db.execute(sql`
    SELECT w.id, w.evolution_instance_name AS name
    FROM whatsapp_instances w
    WHERE w.clinic_id = ${clinicId} AND w.status = 'connected'
    ORDER BY EXISTS (
        SELECT 1 FROM conversations c
        WHERE c.instance_id = w.id AND c.customer_id = ${customerId}
      ) DESC,
      w.is_primary DESC, w.created_at ASC
    LIMIT 1
  `);
  const row = rows.rows[0] as { id: string; name: string } | undefined;
  return row ?? null;
}

/**
 * Nome do perfil do WhatsApp vem como a pessoa quis: "Lari 💖✨", "★ Ju ★",
 * "Mãe da Duda 🌸"... Antes de virar nome de ficha, tira emoji/símbolo e
 * espaços duplicados. Sobrou nada utilizável → ficha nasce com o telefone
 * (a IA pergunta o nome completo na hora de marcar e completa o campo).
 */
function cleanPushName(pushName: string | null): string | null {
  if (!pushName) return null;
  const cleaned = pushName
    .replace(/[^\p{L}\p{M}\s.'-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length >= 2 ? cleaned.slice(0, 120) : null;
}

async function ensureCustomer(
  clinicId: string,
  phone: string,
  pushName: string | null,
): Promise<string> {
  const db = unsafeGlobalDb();
  const existing = await db
    .select({ id: schema.customers.id, status: schema.customers.status })
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
    // Duas fichas com o mesmo número: prioridade determinística — número
    // principal vence o secundário, ficha real vence lead, depois a mais antiga
    .orderBy(
      sql`(${schema.customers.phoneE164} = ${phone}) DESC`,
      sql`(${schema.customers.status} <> 'lead') DESC`,
      sql`${schema.customers.createdAt} ASC`,
    )
    .limit(1);
  if (existing[0]) {
    // Lead que voltou a chamar sem negociação aberta = nova oportunidade no funil.
    // Cooldown de 7 dias após fechar (perdida hoje não "ressuscita" na mensagem
    // seguinte da MESMA conversa); índice único parcial segura duplicata.
    if (existing[0].status === "lead") {
      await db.execute(sql`
        INSERT INTO deals (clinic_id, customer_id, source, status)
        SELECT ${clinicId}, ${existing[0].id}, 'whatsapp', 'open'
        WHERE NOT EXISTS (
          SELECT 1 FROM deals d
          WHERE d.customer_id = ${existing[0].id}
            AND (d.status = 'open'
                 OR COALESCE(d.won_at, d.lost_at, d.created_at) > now() - interval '7 days')
        )
        ON CONFLICT DO NOTHING
      `);
    }
    return existing[0].id;
  }

  const [created] = await db
    .insert(schema.customers)
    .values({
      clinicId,
      fullName: cleanPushName(pushName) ?? phone,
      phoneE164: phone,
      status: "lead",
      source: "whatsapp_inbound",
    })
    .onConflictDoNothing()
    .returning({ id: schema.customers.id });
  if (created) {
    // Número desconhecido virou lead: nasce um card no funil de vendas
    // (índice único parcial impede duplicar negociação aberta)
    await db
      .insert(schema.deals)
      .values({ clinicId, customerId: created.id, source: "whatsapp", status: "open" })
      .onConflictDoNothing();
    return created.id;
  }

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
        error: schema.messages.error,
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
      // Rejeição com status HTTP (4xx/5xx) ou conexão que nem abriu = a
      // mensagem COM CERTEZA não saiu → UMA nova tentativa é segura.
      // Timeout/abort é ambíguo (pode ter chegado): aí nunca reenvia —
      // mensagem duplicada é a cara de robô mais barata que existe.
      const definitelyNotSent =
        /→ \d{3}\b/.test(message) || /ECONNREFUSED|ENOTFOUND|fetch failed/i.test(message);
      if (definitelyNotSent && !msg.error) {
        logger.warn({ messageId: msg.id, err: message }, "envio rejeitado — nova tentativa em ~30s");
        await db
          .update(schema.messages)
          .set({
            status: "queued",
            error: message,
            scheduledFor: new Date(Date.now() + 20_000 + Math.floor(Math.random() * 20_000)),
          })
          .where(eq(schema.messages.id, msg.id));
      } else {
        logger.error({ messageId: msg.id, err: message }, "falha no envio");
        await db
          .update(schema.messages)
          .set({ status: "failed", error: message })
          .where(eq(schema.messages.id, msg.id));
      }
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
