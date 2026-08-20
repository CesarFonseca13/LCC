import { and, eq, inArray, sql } from "drizzle-orm";
import type { Logger } from "pino";
import { addDaysISO, todayISO, utcToZoned, zonedToUtc } from "@clinicaos/core/timezone";
import { schema, unsafeGlobalDb } from "@clinicaos/db";

/**
 * Reativação inteligente — o carro-chefe do relacionamento:
 * - por procedimento: prazo de retorno venceu + cliente sumiu → sequência de até 7 msgs
 * - genérica: sem procedimento com prazo → sequência curta após N dias sem visita
 * Regras duras: resposta da cliente PAUSA a cadência (o sweep retoma depois);
 * qualquer agendamento futuro = objetivo alcançado; cooldown pós-sequência;
 * teto de novas cadências por dia (anti-ban); envio só em janela comercial.
 */

export const REACTIVATION_IDS = ["reactivation_smart", "reactivation_generic"] as const;

/** Todas as automações que INICIAM conversa (proativas de relacionamento). */
export const PROACTIVE_IDS = [
  "reactivation_smart",
  "reactivation_generic",
  "smart_fill",
  "package_renewal_sessions",
  "package_renewal_expiry",
] as const;

/** Teto GLOBAL de conversas proativas novas por dia por clínica (anti-ban). */
export const GLOBAL_DAILY_PROACTIVE_CAP = 15;

/** Quantas conversas proativas a clínica já iniciou hoje (dia local). */
export async function proactiveStartsToday(clinicId: string, tz: string): Promise<number> {
  const db = unsafeGlobalDb();
  const result = await db.execute(sql`
    SELECT count(*)::int AS n FROM automation_runs
    WHERE clinic_id = ${clinicId}
      AND automation_id IN ('reactivation_smart', 'reactivation_generic',
                            'smart_fill', 'package_renewal_sessions', 'package_renewal_expiry')
      AND started_at >= (now() AT TIME ZONE ${tz})::date::timestamp AT TIME ZONE ${tz}
  `);
  return Number((result.rows[0] as { n: number } | undefined)?.n ?? 0);
}

export interface ReactivationStep {
  days: number;
  template: string;
}

interface ReactivationConfig {
  steps: ReactivationStep[];
  cooldown_days: number;
  resume_hours: number;
  max_new_per_day: number;
  gap_days?: number;
}

export function mergedConfig(
  defaultConfig: unknown,
  settingConfig: unknown,
): ReactivationConfig {
  const base = (defaultConfig ?? {}) as Partial<ReactivationConfig>;
  const override = (settingConfig ?? {}) as Partial<ReactivationConfig>;
  const steps =
    Array.isArray(override.steps) && override.steps.length > 0 ? override.steps : base.steps;
  return {
    steps: (steps ?? []).filter(
      (s): s is ReactivationStep =>
        typeof s?.days === "number" && typeof s?.template === "string" && s.template.length > 0,
    ),
    cooldown_days: override.cooldown_days ?? base.cooldown_days ?? 60,
    resume_hours: override.resume_hours ?? base.resume_hours ?? 48,
    max_new_per_day: override.max_new_per_day ?? base.max_new_per_day ?? 10,
    gap_days: override.gap_days ?? base.gap_days ?? 90,
  };
}

/**
 * Garante que um horário de envio caia na janela comercial (9h-18h locais).
 * Fora da janela → próximo dia útil de envio às 09:15 + jitter. Vale para
 * criação, avanço de passo E retomada — nada de mensagem de madrugada.
 */
export function clampToSendWindow(candidate: Date, tz: string): Date {
  const { dateISO, timeHHMM } = utcToZoned(candidate, tz);
  const hour = Number(timeHHMM.slice(0, 2));
  if (hour >= 9 && hour < 18) return candidate;
  const targetDate = hour < 9 ? dateISO : addDaysISO(dateISO, 1);
  const base = zonedToUtc(targetDate, "09:15", tz);
  return new Date(base.getTime() + Math.floor(Math.random() * 90 * 60_000));
}

/** Próximo horário de envio: agora + jitter de 2-45min, preso à janela comercial. */
export function nextSendWindow(tz: string): Date {
  const jittered = new Date(Date.now() + 120_000 + Math.floor(Math.random() * 43 * 60_000));
  return clampToSendWindow(jittered, tz);
}

/**
 * Resposta da cliente: pausa qualquer cadência de reativação na hora — inclusive
 * uma run em execução ('processing'; o avanço do passo preserva a pausa) e
 * renova o relógio de retomada se já estava pausada (conversa ainda ativa).
 * Balões já emitidos mas ainda não enviados são descartados (nunca fala por cima).
 */
export async function pauseReactivationOnReply(
  clinicId: string,
  customerId: string,
): Promise<void> {
  const db = unsafeGlobalDb();
  const paused = await db
    .update(schema.automationRuns)
    .set({ status: "paused", pausedAt: new Date(), nextRunAt: null })
    .where(
      and(
        eq(schema.automationRuns.clinicId, clinicId),
        eq(schema.automationRuns.customerId, customerId),
        inArray(schema.automationRuns.automationId, [...REACTIVATION_IDS]),
        inArray(schema.automationRuns.status, ["active", "processing", "paused"]),
      ),
    )
    .returning({ id: schema.automationRuns.id });
  if (paused.length === 0) return;

  const runIds = paused.map((r) => r.id);
  // Mensagem na fila (jitter) ou aguardando aprovação: morre junto com a pausa.
  // 'sending' fica intocada — exactly-once manda (já pode ter saído).
  await db
    .update(schema.messages)
    .set({ status: "expired" })
    .where(
      and(
        inArray(schema.messages.automationRunId, runIds),
        inArray(schema.messages.status, ["queued", "pending_approval"]),
      ),
    );
  await db.execute(sql`
    UPDATE approvals SET status = 'expired'
    WHERE run_id IN (${sql.join(runIds.map((id) => sql`${id}`), sql`, `)})
      AND status = 'pending'
  `);
}

/** Varredura: cria novas cadências para elegíveis + retoma as pausadas sem conversão. */
export async function processReactivationSweep(logger: Logger): Promise<void> {
  const db = unsafeGlobalDb();

  const enabled = await db.execute(sql`
    SELECT s.clinic_id, s.automation_id, s.config AS setting_config,
           d.default_config, c.timezone
    FROM automation_settings s
    JOIN automation_definitions d ON d.id = s.automation_id
    JOIN clinics c ON c.id = s.clinic_id
    JOIN whatsapp_instances w ON w.clinic_id = s.clinic_id AND w.status = 'connected'
    WHERE s.automation_id IN ('reactivation_smart', 'reactivation_generic') AND s.enabled
  `);
  const rows = enabled.rows as {
    clinic_id: string;
    automation_id: string;
    setting_config: unknown;
    default_config: unknown;
    timezone: string | null;
  }[];

  const smartEnabledClinics = new Set(
    rows.filter((r) => r.automation_id === "reactivation_smart").map((r) => r.clinic_id),
  );

  for (const row of rows) {
    const tz = row.timezone ?? "America/Sao_Paulo";
    const config = mergedConfig(row.default_config, row.setting_config);
    if (config.steps.length === 0) continue;

    try {
      await materializeRuns(
        row.clinic_id,
        row.automation_id,
        tz,
        config,
        smartEnabledClinics.has(row.clinic_id),
        logger,
      );
    } catch (err) {
      logger.error(
        { clinicId: row.clinic_id, automationId: row.automation_id, err: String(err) },
        "falha na varredura de reativação",
      );
    }
  }

  await resumePaused(logger);
  await reconcileStuckRuns(logger);
}

/**
 * Worker morreu entre o claim e o avanço? Runs de reativação presas em
 * 'processing' voltam à fila (o executor não reenvia passo já emitido —
 * confere no automation_log antes de emitir).
 */
async function reconcileStuckRuns(logger: Logger): Promise<void> {
  const db = unsafeGlobalDb();
  const stuck = await db.execute(sql`
    UPDATE automation_runs
    SET status = 'active', next_run_at = now() + interval '2 minutes'
    WHERE status = 'processing'
      AND automation_id IN ('reactivation_smart', 'reactivation_generic',
                            'smart_fill', 'package_renewal_sessions', 'package_renewal_expiry')
      AND next_run_at < now() - interval '15 minutes'
    RETURNING id
  `);
  if ((stuck.rowCount ?? 0) > 0) {
    logger.warn({ count: stuck.rowCount }, "runs proativas presas em processing — reenfileiradas");
  }
}

async function materializeRuns(
  clinicId: string,
  automationId: string,
  tz: string,
  config: ReactivationConfig,
  smartEnabled: boolean,
  logger: Logger,
): Promise<void> {
  const db = unsafeGlobalDb();

  // Teto diário de NOVAS cadências (aquecimento/anti-ban) — POR CLÍNICA, não por
  // automação: smart + genérica dividem o mesmo orçamento do número
  const localMidnight = zonedToUtc(todayISO(tz), "00:00", tz);
  const startedToday = await db.execute(sql`
    SELECT count(*)::int AS n FROM automation_runs
    WHERE clinic_id = ${clinicId}
      AND automation_id IN ('reactivation_smart', 'reactivation_generic')
      AND started_at >= ${localMidnight}
  `);
  const already = Number((startedToday.rows[0] as { n: number } | undefined)?.n ?? 0);
  // Orçamento do dia: teto da automação E teto global de proativas da clínica
  const globalUsed = await proactiveStartsToday(clinicId, tz);
  const remaining = Math.min(
    config.max_new_per_day - already,
    GLOBAL_DAILY_PROACTIVE_CAP - globalUsed,
  );
  if (remaining <= 0) return;

  const isSmart = automationId === "reactivation_smart";

  // Elegibilidade em SQL set-based; guardas de cliente + cooldown + dedupe de run.
  // Visitas = agenda (compareceu) ∪ histórico pré-sistema, datas no fuso da clínica.
  const eligible = await db.execute(sql`
    WITH ctx AS (SELECT (now() AT TIME ZONE ${tz})::date AS today),
    visits AS (
      SELECT customer_id, procedure_id, max(on_date) AS last_on FROM (
        SELECT a.customer_id, a.procedure_id, (a.starts_at AT TIME ZONE ${tz})::date AS on_date
        FROM appointments a
        WHERE a.clinic_id = ${clinicId} AND a.status = 'showed'
        UNION ALL
        SELECT h.customer_id, h.procedure_id, h.occurred_on
        FROM customer_history_entries h
        WHERE h.clinic_id = ${clinicId}
      ) v GROUP BY customer_id, procedure_id
    ),
    overdue AS (
      -- Retorno vencido há no máximo 180 dias: mais que isso o convite "está na
      -- época do retorno" soa falso — vira caso da reativação genérica
      SELECT DISTINCT ON (v.customer_id) v.customer_id, v.procedure_id,
             (ctx.today - (v.last_on + p.return_days))::int AS overdue_days
      FROM visits v
      JOIN procedures p
        ON p.id = v.procedure_id AND p.return_days IS NOT NULL AND p.active
      CROSS JOIN ctx
      WHERE v.last_on + p.return_days < ctx.today
        AND (ctx.today - (v.last_on + p.return_days)) <= 180
      ORDER BY v.customer_id, (ctx.today - (v.last_on + p.return_days)) DESC
    ),
    last_any AS (
      SELECT customer_id, max(last_on) AS last_visit FROM visits GROUP BY customer_id
    ),
    candidates AS (
      ${
        isSmart
          ? sql`
            -- "Venceu o retorno" só reativa quem de fato SUMIU: qualquer visita
            -- nos últimos 30 dias (mesmo de outro procedimento) cancela o convite
            SELECT o.customer_id, o.procedure_id
            FROM overdue o
            JOIN last_any la ON la.customer_id = o.customer_id
            CROSS JOIN ctx
            WHERE la.last_visit < ctx.today - 30`
          : sql`
            SELECT la.customer_id, NULL::uuid AS procedure_id
            FROM last_any la CROSS JOIN ctx
            WHERE la.last_visit < ctx.today - make_interval(days => ${config.gap_days ?? 90})
              ${
                smartEnabled
                  ? sql`AND NOT EXISTS (SELECT 1 FROM overdue o WHERE o.customer_id = la.customer_id)`
                  : sql``
              }`
      }
    )
    SELECT cand.customer_id, cand.procedure_id
    FROM candidates cand
    JOIN customers c ON c.id = cand.customer_id
    WHERE c.deleted_at IS NULL AND c.merged_into_id IS NULL
      AND NOT c.automations_blocked AND c.opted_out_at IS NULL
      AND c.whatsapp_valid IS DISTINCT FROM false
      AND NOT EXISTS (
        SELECT 1 FROM appointments f
        WHERE f.customer_id = cand.customer_id
          AND f.status IN ('scheduled', 'confirmed') AND f.starts_at > now()
      )
      AND NOT EXISTS (
        SELECT 1 FROM automation_runs r
        WHERE r.customer_id = cand.customer_id
          AND r.automation_id IN ('reactivation_smart', 'reactivation_generic')
          AND (r.status IN ('active', 'processing', 'paused')
               -- Cooldown pós-sequência só para quem RECEBEU a sequência;
               -- runs canceladas/erro têm folga curta (evita loop de recriação)
               OR (r.status IN ('completed', 'goal_reached')
                   AND r.finished_at > now() - make_interval(days => ${config.cooldown_days}))
               OR (r.status IN ('cancelled', 'skipped', 'error')
                   AND r.finished_at > now() - interval '1 day'))
      )
      -- Governador: nada de reativar quem recebeu oferta/convite de crescimento hoje
      AND NOT EXISTS (
        SELECT 1 FROM automation_runs g
        WHERE g.customer_id = cand.customer_id
          AND g.automation_id IN ('smart_fill', 'package_renewal_sessions', 'package_renewal_expiry')
          AND g.started_at > now() - interval '1 day'
      )
    LIMIT ${remaining}
  `);

  for (const cand of eligible.rows as { customer_id: string; procedure_id: string | null }[]) {
    // Índice único parcial garante 1 cadência viva por cliente (sweeps concorrentes)
    const [created] = await db
      .insert(schema.automationRuns)
      .values({
        clinicId,
        automationId,
        customerId: cand.customer_id,
        procedureId: cand.procedure_id,
        status: "active",
        currentStep: 0,
        nextRunAt: nextSendWindow(tz),
      })
      .onConflictDoNothing()
      .returning({ id: schema.automationRuns.id });
    if (created) {
      logger.info(
        { clinicId, automationId, customerId: cand.customer_id },
        "cadência de reativação criada",
      );
    }
  }
}

/** Pausada sem conversão há mais de N horas → retoma do passo seguinte. */
async function resumePaused(logger: Logger): Promise<void> {
  const db = unsafeGlobalDb();
  const paused = await db.execute(sql`
    SELECT r.id, r.clinic_id, r.customer_id, r.automation_id, r.current_step, r.paused_at,
           s.config AS setting_config, d.default_config, c.timezone
    FROM automation_runs r
    JOIN automation_settings s
      ON s.clinic_id = r.clinic_id AND s.automation_id = r.automation_id
    JOIN clinics c ON c.id = r.clinic_id
    LEFT JOIN automation_definitions d ON d.id = r.automation_id
    WHERE r.status = 'paused'
      AND r.automation_id IN ('reactivation_smart', 'reactivation_generic')
      -- Automação desligada: fica pausada com o estado preservado
      AND s.enabled
      AND r.paused_at <= now() - interval '1 hour'
    ORDER BY r.paused_at ASC
    LIMIT 50
  `);

  for (const row of paused.rows as {
    id: string;
    clinic_id: string;
    customer_id: string;
    automation_id: string;
    current_step: number;
    paused_at: Date | string | null;
    setting_config: unknown;
    default_config: unknown;
    timezone: string | null;
  }[]) {
    const config = mergedConfig(row.default_config, row.setting_config);
    const pausedAtMs = row.paused_at ? new Date(row.paused_at).getTime() : 0;
    if (Date.now() - pausedAtMs < config.resume_hours * 3_600_000) continue;

    // Converteu durante a conversa? Objetivo alcançado.
    const future = await db.execute(sql`
      SELECT 1 FROM appointments
      WHERE customer_id = ${row.customer_id}
        AND status IN ('scheduled', 'confirmed') AND starts_at > now()
      LIMIT 1
    `);
    if ((future.rowCount ?? 0) > 0) {
      await db
        .update(schema.automationRuns)
        .set({
          status: "goal_reached",
          stopReason: "cliente agendou durante a conversa",
          finishedAt: new Date(),
        })
        .where(and(eq(schema.automationRuns.id, row.id), eq(schema.automationRuns.status, "paused")));
      continue;
    }

    // Recomeça a contagem da última interação: próximo passo respeita o
    // espaçamento da sequência a partir da pausa (nunca menos de 1h a partir de agora)
    const step = row.current_step;
    const gapDays =
      step > 0 && config.steps[step] && config.steps[step - 1]
        ? config.steps[step]!.days - config.steps[step - 1]!.days
        : (config.steps[step]?.days ?? 0);
    const fromPause = pausedAtMs + gapDays * 86_400_000;
    const earliest = Date.now() + 3_600_000 + Math.floor(Math.random() * 3_600_000);
    // Retomada também respeita a janela comercial (nada de madrugada)
    const resumeAt = clampToSendWindow(
      new Date(Math.max(fromPause, earliest)),
      row.timezone ?? "America/Sao_Paulo",
    );
    await db
      .update(schema.automationRuns)
      .set({ status: "active", pausedAt: null, nextRunAt: resumeAt })
      .where(and(eq(schema.automationRuns.id, row.id), eq(schema.automationRuns.status, "paused")));
    logger.info({ runId: row.id }, "cadência de reativação retomada");
  }
}
