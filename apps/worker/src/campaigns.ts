import { sql } from "drizzle-orm";
import type { Logger } from "pino";
import { renderTemplate } from "@clinicaos/core/template-render";
import { utcToZoned } from "@clinicaos/core/timezone";
import { unsafeGlobalDb } from "@clinicaos/db";

/**
 * Campanhas: envio GRADUAL para a base cadastrada — nunca rajada.
 * O ritmo (45-180s) e o teto diário valem POR NÚMERO (clínica), não por
 * campanha: duas campanhas ligadas dividem a mesma cadência. Janela 9-18h
 * local, revalidação da cliente na hora, claim transacional (crash não
 * perde destinatária) e template inválido PAUSA a campanha em vez de
 * queimar a lista em silêncio.
 */
export async function processCampaignsSweep(logger: Logger): Promise<void> {
  const db = unsafeGlobalDb();
  const running = await db.execute(sql`
    SELECT ca.id, ca.clinic_id, ca.message_template, ca.daily_cap, ca.started_at,
           c.timezone, c.name AS clinic_name, w.id AS instance_id
    FROM campaigns ca
    JOIN clinics c ON c.id = ca.clinic_id
    JOIN whatsapp_instances w ON w.clinic_id = ca.clinic_id AND w.status = 'connected'
    WHERE ca.status = 'running'
    -- Rodízio justo: quem enviou há mais tempo (ou nunca) vai primeiro — duas
    -- campanhas ligadas se alternam em vez de a mais antiga monopolizar o ritmo
    ORDER BY ca.next_send_at ASC NULLS FIRST, ca.started_at ASC
  `);

  for (const row of running.rows as unknown as CampaignRow[]) {
    try {
      await sendNext(row, logger);
    } catch (err) {
      logger.error({ campaignId: row.id, err: String(err) }, "falha no envio da campanha");
    }
  }
}

interface CampaignRow {
  id: string;
  clinic_id: string;
  message_template: string;
  daily_cap: number;
  started_at: Date | string | null;
  timezone: string | null;
  clinic_name: string;
  instance_id: string;
}

async function sendNext(campaign: CampaignRow, logger: Logger): Promise<void> {
  const db = unsafeGlobalDb();
  const tz = campaign.timezone ?? "America/Sao_Paulo";

  // Template inválido NUNCA queima a lista: valida com dados de amostra e,
  // se quebrar, pausa a campanha para a dona corrigir
  try {
    renderTemplate(
      campaign.message_template,
      { nome: "Maria", clinica: campaign.clinic_name },
      { html: false },
    );
  } catch {
    await db.execute(sql`
      UPDATE campaigns SET status = 'paused', updated_at = now()
      WHERE id = ${campaign.id} AND status = 'running'
    `);
    logger.error({ campaignId: campaign.id }, "template inválido — campanha pausada");
    return;
  }

  // Acabou? Campanha concluída.
  const pendingLeft = await db.execute(sql`
    SELECT count(*)::int AS n FROM campaign_recipients
    WHERE campaign_id = ${campaign.id} AND status = 'pending'
  `);
  if (Number((pendingLeft.rows[0] as { n: number }).n) === 0) {
    await db.execute(sql`
      UPDATE campaigns SET status = 'done', finished_at = now(), updated_at = now()
      WHERE id = ${campaign.id} AND status = 'running'
    `);
    logger.info({ campaignId: campaign.id }, "campanha concluída");
    return;
  }

  // Janela comercial 9-18h locais
  const hour = Number(utcToZoned(new Date(), tz).timeHHMM.slice(0, 2));
  if (hour < 9 || hour >= 18) return;

  // Ritmo POR NÚMERO: se qualquer campanha da clínica agendou o próximo envio
  // para o futuro, todas esperam (45-180s entre mensagens do mesmo WhatsApp)
  const clinicPacing = await db.execute(sql`
    SELECT 1 FROM campaigns
    WHERE clinic_id = ${campaign.clinic_id} AND status = 'running'
      AND next_send_at > now()
    LIMIT 1
  `);
  if ((clinicPacing.rowCount ?? 0) > 0) return;

  // Teto diário POR NÚMERO (soma todas as campanhas da clínica no dia local).
  // Com caps diferentes entre campanhas ligadas, vale o MENOR — o número segue
  // o ritmo mais conservador que a dona configurou (anti-ban em primeiro lugar)
  const sentToday = await db.execute(sql`
    SELECT (SELECT count(*)::int
            FROM campaign_recipients r
            JOIN campaigns ca ON ca.id = r.campaign_id
            WHERE ca.clinic_id = ${campaign.clinic_id} AND r.status = 'sent'
              AND r.sent_at >= (now() AT TIME ZONE ${tz})::date::timestamp AT TIME ZONE ${tz}
           ) AS n,
           (SELECT min(daily_cap) FROM campaigns
            WHERE clinic_id = ${campaign.clinic_id} AND status = 'running') AS cap
  `);
  const today = sentToday.rows[0] as { n: number; cap: number | null };
  if (Number(today.n) >= Number(today.cap ?? campaign.daily_cap)) return;

  // Tudo dentro de UMA transação: claim + mensagem ou nada (crash não perde
  // destinatária); advisory lock por clínica segura varreduras concorrentes
  const sent = await db.transaction(async (tx) => {
    const lock = await tx.execute(sql`
      SELECT pg_try_advisory_xact_lock(hashtext(${`campaign-send-${campaign.clinic_id}`})) AS ok
    `);
    if (!(lock.rows[0] as { ok: boolean }).ok) return false;

    // Próxima destinatária, revalidada AGORA. Fora: bloqueadas/opt-out/
    // mescladas, quem está em outra conversa automática (runs zumbis >90d
    // não seguram) e quem VISITOU depois do início da campanha — "faz tempo
    // que não aparece" para quem esteve ontem entregaria o sistema.
    const next = await tx.execute(sql`
      SELECT r.id AS recipient_id, cu.id AS customer_id, cu.full_name, cu.phone_e164
      FROM campaign_recipients r
      JOIN customers cu ON cu.id = r.customer_id
      WHERE r.campaign_id = ${campaign.id} AND r.status = 'pending'
        AND cu.deleted_at IS NULL AND cu.merged_into_id IS NULL
        AND NOT cu.automations_blocked AND cu.opted_out_at IS NULL
        AND cu.whatsapp_valid IS DISTINCT FROM false
        AND NOT EXISTS (
          SELECT 1 FROM automation_runs ar
          WHERE ar.customer_id = cu.id
            AND ((ar.status IN ('active', 'processing', 'paused')
                  AND ar.started_at > now() - interval '90 days')
                 OR ar.started_at > now() - interval '1 day')
        )
        AND NOT EXISTS (
          SELECT 1 FROM campaign_recipients r2
          WHERE r2.customer_id = cu.id AND r2.status = 'sent'
            AND r2.sent_at > now() - interval '1 day'
        )
        AND NOT EXISTS (
          SELECT 1 FROM appointments ap
          WHERE ap.customer_id = cu.id AND ap.status = 'showed'
            AND ap.starts_at > ${campaign.started_at ?? new Date(0)}
        )
      ORDER BY r.id
      FOR UPDATE OF r SKIP LOCKED
      LIMIT 1
    `);
    const target = next.rows[0] as
      | { recipient_id: string; customer_id: string; full_name: string; phone_e164: string }
      | undefined;
    if (!target) {
      // Marca como puladas as permanentemente inelegíveis (a campanha termina)
      await tx.execute(sql`
        UPDATE campaign_recipients r SET status = 'skipped', skip_reason = 'cliente bloqueada/opt-out'
        FROM customers cu
        WHERE r.campaign_id = ${campaign.id} AND r.status = 'pending' AND cu.id = r.customer_id
          AND (cu.deleted_at IS NOT NULL OR cu.merged_into_id IS NOT NULL
               OR cu.automations_blocked OR cu.opted_out_at IS NOT NULL
               OR cu.whatsapp_valid IS NOT DISTINCT FROM false)
      `);
      await tx.execute(sql`
        UPDATE campaign_recipients r SET status = 'skipped', skip_reason = 'visitou depois do início'
        FROM customers cu
        WHERE r.campaign_id = ${campaign.id} AND r.status = 'pending' AND cu.id = r.customer_id
          AND EXISTS (
            SELECT 1 FROM appointments ap
            WHERE ap.customer_id = cu.id AND ap.status = 'showed'
              AND ap.starts_at > ${campaign.started_at ?? new Date(0)}
          )
      `);
      return false;
    }

    // "Oi +5511..." nunca: sem nome utilizável, pula com aviso na campanha
    const firstName = target.full_name.trim().split(/\s+/)[0] ?? "";
    if (!firstName || /^\+?\d+$/.test(firstName)) {
      await tx.execute(sql`
        UPDATE campaign_recipients SET status = 'skipped',
               skip_reason = 'sem nome na ficha (complete o cadastro)'
        WHERE id = ${target.recipient_id} AND status = 'pending'
      `);
      return false;
    }

    const body = renderTemplate(
      campaign.message_template,
      { nome: firstName, clinica: campaign.clinic_name },
      { html: false },
    );

    const remoteJid = `${target.phone_e164.replace("+", "")}@s.whatsapp.net`;
    const conversation = await tx.execute(sql`
      INSERT INTO conversations (clinic_id, instance_id, remote_jid, customer_id)
      VALUES (${campaign.clinic_id}, ${campaign.instance_id}, ${remoteJid}, ${target.customer_id})
      ON CONFLICT (instance_id, remote_jid) DO UPDATE SET customer_id = EXCLUDED.customer_id
      RETURNING id
    `);
    const conversationId = (conversation.rows[0] as { id: string }).id;

    const message = await tx.execute(sql`
      INSERT INTO messages (clinic_id, conversation_id, direction, author, body, status,
                            automation_id, scheduled_for)
      VALUES (${campaign.clinic_id}, ${conversationId}, 'outbound', 'automation', ${body},
              'queued', 'campaign', now() + make_interval(secs => ${5 + Math.floor(Math.random() * 25)}))
      RETURNING id
    `);
    await tx.execute(sql`
      UPDATE campaign_recipients
      SET status = 'sent', sent_at = now(), message_id = ${(message.rows[0] as { id: string }).id}
      WHERE id = ${target.recipient_id} AND status = 'pending'
    `);
    // Ritmo do próximo envio do NÚMERO: 45-180s
    await tx.execute(sql`
      UPDATE campaigns SET next_send_at = now() + make_interval(secs => ${45 + Math.floor(Math.random() * 135)}),
                           updated_at = now()
      WHERE id = ${campaign.id}
    `);
    return { customerId: target.customer_id };
  });

  if (sent && typeof sent === "object") {
    logger.info(
      { campaignId: campaign.id, customerId: sent.customerId },
      "mensagem de campanha enfileirada",
    );
  }
}
