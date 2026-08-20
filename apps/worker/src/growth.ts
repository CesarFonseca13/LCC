import { sql } from "drizzle-orm";
import type { Logger } from "pino";
import { findSlots, unsafeGlobalDb } from "@clinicaos/db";
import { zonedToUtc } from "@clinicaos/core/timezone";
import {
  GLOBAL_DAILY_PROACTIVE_CAP,
  nextSendWindow,
  proactiveStartsToday,
} from "./reactivation";

/**
 * Crescimento e receita:
 * - smart_fill: buraco na agenda das próximas 72h → oferta para a cliente com
 *   retorno atrasado de maior nota (Inteligência). UMA oferta por vez por
 *   clínica; a próxima só sai se a anterior ficar N horas sem resposta.
 * - package_renewal_*: sessões acabando OU validade chegando → convite de
 *   renovação (um por cliente a cada N dias).
 * O slot oferecido é escolhido NA HORA DO ENVIO (executor) — nunca oferece
 * horário que acabou de ser preenchido.
 */

interface EnabledRow {
  clinic_id: string;
  automation_id: string;
  setting_config: unknown;
  default_config: unknown;
  timezone: string | null;
}

function cfg<T>(row: EnabledRow, key: string, fallback: T): T {
  const override = (row.setting_config ?? {}) as Record<string, unknown>;
  const base = (row.default_config ?? {}) as Record<string, unknown>;
  return (override[key] ?? base[key] ?? fallback) as T;
}

export async function processGrowthSweep(logger: Logger): Promise<void> {
  const db = unsafeGlobalDb();
  const enabled = await db.execute(sql`
    SELECT s.clinic_id, s.automation_id, s.config AS setting_config,
           d.default_config, c.timezone
    FROM automation_settings s
    JOIN automation_definitions d ON d.id = s.automation_id
    JOIN clinics c ON c.id = s.clinic_id
    JOIN whatsapp_instances w ON w.clinic_id = s.clinic_id AND w.status = 'connected'
    WHERE s.automation_id IN ('smart_fill', 'package_renewal_sessions', 'package_renewal_expiry')
      AND s.enabled
  `);

  for (const row of enabled.rows as unknown as EnabledRow[]) {
    const tz = row.timezone ?? "America/Sao_Paulo";
    try {
      if (row.automation_id === "smart_fill") {
        await materializeSmartFill(row, tz, logger);
      } else {
        await materializeRenewal(row, tz, logger);
      }
    } catch (err) {
      logger.error(
        { clinicId: row.clinic_id, automationId: row.automation_id, err: String(err) },
        "falha na varredura de crescimento",
      );
    }
  }
}

async function materializeSmartFill(row: EnabledRow, tz: string, logger: Logger): Promise<void> {
  const db = unsafeGlobalDb();
  const staggerHours = cfg(row, "stagger_hours", 4);
  const cooldownDays = cfg(row, "cooldown_days", 14);
  const maxPerDay = cfg(row, "max_per_day", 4);

  // Teto diário da automação + teto global de proativas da clínica
  const today = await db.execute(sql`
    SELECT count(*)::int AS n FROM automation_runs
    WHERE clinic_id = ${row.clinic_id} AND automation_id = 'smart_fill'
      AND started_at >= (now() AT TIME ZONE ${tz})::date::timestamp AT TIME ZONE ${tz}
  `);
  if (Number((today.rows[0] as { n: number }).n) >= maxPerDay) return;
  if ((await proactiveStartsToday(row.clinic_id, tz)) >= GLOBAL_DAILY_PROACTIVE_CAP) return;

  // UMA oferta em voo por vez: enquanto houver run ativa (mensagem ainda não
  // saiu), nada de criar a próxima — senão a madrugada acumula ofertas que
  // disparam juntas às 9h, todas com o mesmo buraco
  const inFlight = await db.execute(sql`
    SELECT 1 FROM automation_runs
    WHERE clinic_id = ${row.clinic_id} AND automation_id = 'smart_fill'
      AND status IN ('active', 'processing')
    LIMIT 1
  `);
  if ((inFlight.rowCount ?? 0) > 0) return;

  // Escalonamento: a próxima oferta só sai N horas depois do ENVIO da anterior
  // sem resposta (runs que não enviaram nada — goal/skip — não seguram a fila)
  const last = await db.execute(sql`
    SELECT r.finished_at,
           EXISTS (
             SELECT 1 FROM conversations cv
             WHERE cv.clinic_id = r.clinic_id AND cv.customer_id = r.customer_id
               AND cv.last_inbound_at > r.finished_at
           ) AS answered
    FROM automation_runs r
    WHERE r.clinic_id = ${row.clinic_id} AND r.automation_id = 'smart_fill'
      AND r.status = 'completed'
    ORDER BY r.finished_at DESC LIMIT 1
  `);
  const lastRow = last.rows[0] as { finished_at: Date | string; answered: boolean } | undefined;
  if (
    lastRow &&
    !lastRow.answered &&
    Date.now() - new Date(lastRow.finished_at).getTime() < staggerHours * 3_600_000
  ) {
    return;
  }

  // "Abriu um horário" tem que ser verdade: agenda em uso nos próximos 3 dias
  // (clínica sem nenhum agendamento não tem "buraco" — tem agenda vazia)
  const busy = await db.execute(sql`
    SELECT 1 FROM appointments
    WHERE clinic_id = ${row.clinic_id}
      AND status IN ('scheduled', 'confirmed', 'showed')
      AND starts_at BETWEEN now() - interval '1 day' AND now() + interval '3 days'
    LIMIT 1
  `);
  if ((busy.rowCount ?? 0) === 0) return;

  // Melhor candidata: retorno vencido (≤180d), sem horário futuro, ranqueada
  // pela nota da Inteligência; nunca em cima de outra conversa automática
  const candidate = await db.execute(sql`
    WITH ctx AS (SELECT (now() AT TIME ZONE ${tz})::date AS today),
    visits AS (
      SELECT customer_id, procedure_id, max(on_date) AS last_on FROM (
        SELECT a.customer_id, a.procedure_id, (a.starts_at AT TIME ZONE ${tz})::date AS on_date
        FROM appointments a
        WHERE a.clinic_id = ${row.clinic_id} AND a.status = 'showed'
        UNION ALL
        SELECT h.customer_id, h.procedure_id, h.occurred_on
        FROM customer_history_entries h
        WHERE h.clinic_id = ${row.clinic_id}
      ) v WHERE procedure_id IS NOT NULL GROUP BY customer_id, procedure_id
    ),
    overdue AS (
      SELECT DISTINCT ON (v.customer_id) v.customer_id, v.procedure_id,
             (ctx.today - (v.last_on + p.return_days))::int AS overdue_days
      FROM visits v
      JOIN procedures p ON p.id = v.procedure_id AND p.return_days IS NOT NULL AND p.active
      CROSS JOIN ctx
      WHERE v.last_on + p.return_days < ctx.today
        AND (ctx.today - (v.last_on + p.return_days)) <= 180
      ORDER BY v.customer_id, (ctx.today - (v.last_on + p.return_days)) DESC
    )
    SELECT o.customer_id, o.procedure_id
    FROM overdue o
    JOIN customers c ON c.id = o.customer_id
    LEFT JOIN customer_scores cs ON cs.customer_id = o.customer_id
    WHERE c.deleted_at IS NULL AND c.merged_into_id IS NULL
      AND NOT c.automations_blocked AND c.opted_out_at IS NULL
      AND c.whatsapp_valid IS DISTINCT FROM false
      AND NOT EXISTS (
        SELECT 1 FROM appointments f
        WHERE f.customer_id = o.customer_id
          AND f.status IN ('scheduled', 'confirmed') AND f.starts_at > now()
      )
      AND NOT EXISTS (
        SELECT 1 FROM automation_runs r
        WHERE r.customer_id = o.customer_id
          AND ((r.automation_id IN ('reactivation_smart', 'reactivation_generic')
                AND r.status IN ('active', 'processing', 'paused'))
               -- Cooldown cheio só para oferta ENVIADA; sem envio, folga de 1 dia
               OR (r.automation_id = 'smart_fill' AND r.status = 'completed'
                   AND r.started_at > now() - make_interval(days => ${cooldownDays}))
               OR (r.automation_id IN ('smart_fill', 'package_renewal_sessions', 'package_renewal_expiry')
                   AND r.started_at > now() - interval '1 day'))
      )
    ORDER BY cs.score DESC NULLS LAST, o.overdue_days DESC
    LIMIT 1
  `);
  const cand = candidate.rows[0] as { customer_id: string; procedure_id: string } | undefined;
  if (!cand) return;

  // Só cria a oferta se EXISTE buraco real dentro da janela agora (o executor
  // reconfere e escolhe o slot fresquinho na hora do envio)
  const duration = await db.execute(sql`
    SELECT duration_minutes FROM procedures WHERE id = ${cand.procedure_id}
  `);
  const durationMinutes = Number(
    (duration.rows[0] as { duration_minutes: number } | undefined)?.duration_minutes ?? 60,
  );
  const windowHours = cfg(row, "window_hours", 72);
  const slots = await findSlots(db, row.clinic_id, tz, durationMinutes, 3);
  const cutoff = Date.now() + windowHours * 3_600_000;
  const hasSlot = slots.some(
    (s) => zonedToUtc(s.dateISO, s.timeHHMM, tz).getTime() <= cutoff,
  );
  if (!hasSlot) return;

  await db.execute(sql`
    INSERT INTO automation_runs (clinic_id, automation_id, customer_id, procedure_id, status, next_run_at)
    VALUES (${row.clinic_id}, 'smart_fill', ${cand.customer_id}, ${cand.procedure_id}, 'active', ${nextSendWindow(tz)})
    ON CONFLICT DO NOTHING
  `);
  logger.info(
    { clinicId: row.clinic_id, customerId: cand.customer_id },
    "oferta de preenchimento de agenda criada",
  );
}

async function materializeRenewal(row: EnabledRow, tz: string, logger: Logger): Promise<void> {
  const db = unsafeGlobalDb();
  const isSessions = row.automation_id === "package_renewal_sessions";
  const threshold = cfg(row, "sessions_left_threshold", 1);
  const expiryDays = cfg(row, "expiry_days", 7);
  const cooldownDays = cfg(row, "cooldown_days", 30);
  const maxPerDay = cfg(row, "max_new_per_day", 10);

  // Teto diário compartilhado entre os dois gatilhos de renovação
  const today = await db.execute(sql`
    SELECT count(*)::int AS n FROM automation_runs
    WHERE clinic_id = ${row.clinic_id}
      AND automation_id IN ('package_renewal_sessions', 'package_renewal_expiry')
      AND started_at >= (now() AT TIME ZONE ${tz})::date::timestamp AT TIME ZONE ${tz}
  `);
  const globalUsed = await proactiveStartsToday(row.clinic_id, tz);
  const remaining = Math.min(
    maxPerDay - Number((today.rows[0] as { n: number }).n),
    GLOBAL_DAILY_PROACTIVE_CAP - globalUsed,
  );
  if (remaining <= 0) return;

  const eligible = await db.execute(sql`
    WITH ctx AS (SELECT (now() AT TIME ZONE ${tz})::date AS today)
    SELECT DISTINCT ON (cp.customer_id) cp.customer_id, cp.procedure_id
    FROM customer_packages cp
    JOIN customers c ON c.id = cp.customer_id
    CROSS JOIN ctx
    WHERE cp.clinic_id = ${row.clinic_id} AND cp.status = 'active'
      AND (cp.expires_at IS NULL OR cp.expires_at >= ctx.today)
      AND cp.purchased_at <= ctx.today - 3
      AND ${
        isSessions
          ? sql`(cp.sessions_used > 0 OR cp.sessions_total = 1)
                AND (cp.sessions_total - cp.sessions_used) <= ${threshold}`
          : sql`cp.expires_at IS NOT NULL
                AND cp.expires_at <= ctx.today + make_interval(days => ${expiryDays})
                AND cp.sessions_used < cp.sessions_total`
      }
      AND c.deleted_at IS NULL AND c.merged_into_id IS NULL
      AND NOT c.automations_blocked AND c.opted_out_at IS NULL
      AND c.whatsapp_valid IS DISTINCT FROM false
      AND NOT EXISTS (
        SELECT 1 FROM automation_runs r
        WHERE r.customer_id = cp.customer_id
          AND ((r.automation_id IN ('package_renewal_sessions', 'package_renewal_expiry')
                AND (r.status IN ('active', 'processing')
                     OR (r.status IN ('completed', 'goal_reached')
                         AND r.finished_at > now() - make_interval(days => ${cooldownDays}))
                     OR (r.status IN ('cancelled', 'skipped', 'error')
                         AND r.finished_at > now() - interval '1 day')))
               -- Nunca no meio de uma cadência de reativação (uma conversa por vez)
               OR (r.automation_id IN ('reactivation_smart', 'reactivation_generic')
                   AND r.status IN ('active', 'processing', 'paused'))
               OR (r.automation_id IN ('smart_fill', 'package_renewal_sessions', 'package_renewal_expiry')
                   AND r.started_at > now() - interval '1 day'))
      )
    ORDER BY cp.customer_id, cp.expires_at ASC NULLS LAST
    LIMIT ${remaining}
  `);

  for (const cand of eligible.rows as { customer_id: string; procedure_id: string | null }[]) {
    await db.execute(sql`
      INSERT INTO automation_runs (clinic_id, automation_id, customer_id, procedure_id, status, next_run_at)
      VALUES (${row.clinic_id}, ${row.automation_id}, ${cand.customer_id}, ${cand.procedure_id}, 'active', ${nextSendWindow(tz)})
      ON CONFLICT DO NOTHING
    `);
    logger.info(
      { clinicId: row.clinic_id, automationId: row.automation_id, customerId: cand.customer_id },
      "convite de renovação de pacote criado",
    );
  }
}
