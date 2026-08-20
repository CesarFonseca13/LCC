import { sql } from "drizzle-orm";
import type { Db, Tx } from "./client";
import * as schema from "./schema";

/**
 * Inteligência v1 — score 0-100 por cliente, transparente e explicável:
 * 4 dimensões de 0 a 25 (recência, frequência, valor, engajamento), cada uma
 * sustentada por números crus guardados em `metrics` (viram as frases do painel).
 * Visitas contam agendamentos "compareceu" E o histórico pré-sistema; entradas de
 * histórico no mesmo dia de um atendimento da agenda são ignoradas (sem contar dobrado).
 * Todas as datas são no fuso da clínica — nunca UTC cru.
 */

export interface ScoreMetrics {
  lastVisitOn: string | null;
  daysSinceVisit: number | null;
  visits12m: number;
  value12m: number | null;
  valuePercentile: number | null; // 0-100, só entre quem gastou algo
  showed: number;
  noShow: number;
  showRate: number | null; // 0-1; null = sem histórico de presença
  lastInboundDaysAgo: number | null;
  nextAppointmentOn: string | null;
  favoriteProcedure: string | null;
  overdueProcedure: string | null;
  overdueDays: number | null;
  packageName: string | null;
  sessionsLeft: number | null;
  blocked: boolean;
}

export type SuggestedKind =
  | "none"
  | "return_due"
  | "reactivation"
  | "next_session"
  | "package_renewal"
  | "first_visit";

interface RawRow {
  customer_id: string;
  full_name: string;
  status: string;
  blocked: boolean;
  last_visit_on: string | null;
  days_since_visit: string | number | null;
  visits_12m: string | number;
  value_12m: string | number | null;
  showed: string | number | null;
  no_show: string | number | null;
  last_inbound_at: Date | string | null;
  next_on: string | null;
  favorite: string | null;
  overdue_procedure: string | null;
  overdue_days: string | number | null;
  package_name: string | null;
  sessions_left: string | number | null;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

function fmtDateBR(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
}

function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? fullName;
}

/** Recalcula e materializa os scores de todos os clientes da clínica. */
export async function recomputeScores(
  db: Db | Tx,
  clinicId: string,
  tz = "America/Sao_Paulo",
): Promise<number> {
  // "Hoje" e datas de visita sempre no fuso da clínica (22h de terça é terça, não quarta)
  const result = await db.execute(sql`
    WITH ctx AS (
      SELECT (now() AT TIME ZONE ${tz})::date AS today
    ),
    base AS (
      SELECT c.id AS customer_id, c.full_name, c.status,
             (c.automations_blocked OR c.opted_out_at IS NOT NULL) AS blocked
      FROM customers c
      WHERE c.clinic_id = ${clinicId}
        AND c.deleted_at IS NULL AND c.merged_into_id IS NULL
    ),
    agenda_visits AS (
      SELECT a.customer_id, (a.starts_at AT TIME ZONE ${tz})::date AS on_date,
             a.procedure_id, p.name AS procedure_name
      FROM appointments a
      LEFT JOIN procedures p ON p.id = a.procedure_id
      WHERE a.clinic_id = ${clinicId} AND a.status = 'showed'
    ),
    visits AS (
      SELECT customer_id, on_date, procedure_id, procedure_name FROM agenda_visits
      UNION ALL
      -- Histórico manual: ignora entradas no mesmo dia de um atendimento da agenda
      -- (registro duplo do mesmo atendimento não conta duas visitas)
      SELECT h.customer_id, h.occurred_on,
             h.procedure_id, COALESCE(p2.name, h.procedure_name)
      FROM customer_history_entries h
      LEFT JOIN procedures p2 ON p2.id = h.procedure_id
      WHERE h.clinic_id = ${clinicId}
        AND NOT EXISTS (
          SELECT 1 FROM agenda_visits av
          WHERE av.customer_id = h.customer_id AND av.on_date = h.occurred_on
        )
    ),
    visit_agg AS (
      SELECT v.customer_id,
             max(v.on_date) AS last_visit_on,
             count(*) FILTER (WHERE v.on_date >= ctx.today - 365) AS visits_12m
      FROM visits v, ctx GROUP BY v.customer_id
    ),
    fav AS (
      SELECT DISTINCT ON (customer_id) customer_id, procedure_name AS favorite
      FROM (
        SELECT customer_id, procedure_name, count(*) AS n, max(on_date) AS last_on
        FROM visits WHERE procedure_name IS NOT NULL
        GROUP BY customer_id, procedure_name
      ) t
      ORDER BY customer_id, n DESC, last_on DESC
    ),
    money AS (
      -- Dinheiro que já é realidade: recebido ou com vencimento até hoje
      -- (parcelas futuras não inflam o valor); histórico manual segue a
      -- mesma regra anti-dobra das visitas
      SELECT m.customer_id, sum(m.amount) AS value_12m FROM (
        SELECT r.customer_id, r.gross_amount AS amount
        FROM receivables r, ctx
        WHERE r.clinic_id = ${clinicId} AND r.status <> 'cancelled'
          AND r.customer_id IS NOT NULL
          AND COALESCE(r.received_at, r.due_date) BETWEEN ctx.today - 365 AND ctx.today
        UNION ALL
        SELECT h.customer_id, h.amount
        FROM customer_history_entries h, ctx
        WHERE h.clinic_id = ${clinicId} AND h.amount IS NOT NULL
          AND h.occurred_on >= ctx.today - 365
          AND NOT EXISTS (
            SELECT 1 FROM agenda_visits av
            WHERE av.customer_id = h.customer_id AND av.on_date = h.occurred_on
          )
      ) m GROUP BY m.customer_id
    ),
    presence AS (
      SELECT customer_id,
             count(*) FILTER (WHERE status = 'showed') AS showed,
             count(*) FILTER (WHERE status = 'no_show') AS no_show
      FROM appointments
      WHERE clinic_id = ${clinicId} AND starts_at >= now() - interval '365 days'
      GROUP BY customer_id
    ),
    inbound AS (
      SELECT customer_id, max(last_inbound_at) AS last_inbound_at
      FROM conversations
      WHERE clinic_id = ${clinicId} AND customer_id IS NOT NULL
      GROUP BY customer_id
    ),
    future AS (
      SELECT customer_id, (min(starts_at) AT TIME ZONE ${tz})::date AS next_on
      FROM appointments
      WHERE clinic_id = ${clinicId} AND status IN ('scheduled', 'confirmed')
        AND starts_at > now()
      GROUP BY customer_id
    ),
    overdue AS (
      SELECT DISTINCT ON (v.customer_id) v.customer_id,
             p.name AS overdue_procedure,
             (ctx.today - (v.max_on + p.return_days))::int AS overdue_days
      FROM (
        SELECT customer_id, procedure_id, max(on_date) AS max_on
        FROM visits WHERE procedure_id IS NOT NULL
        GROUP BY customer_id, procedure_id
      ) v
      JOIN procedures p
        ON p.id = v.procedure_id AND p.return_days IS NOT NULL AND p.active
      CROSS JOIN ctx
      WHERE v.max_on + p.return_days < ctx.today
      ORDER BY v.customer_id, (ctx.today - (v.max_on + p.return_days)) DESC
    ),
    pkg AS (
      -- Só pacotes vivos: vencido é assunto de reativação, não de renovação
      SELECT DISTINCT ON (cp.customer_id) cp.customer_id,
             pk.name AS package_name,
             (cp.sessions_total - cp.sessions_used) AS sessions_left
      FROM customer_packages cp
      JOIN packages pk ON pk.id = cp.package_id
      CROSS JOIN ctx
      WHERE cp.clinic_id = ${clinicId} AND cp.status = 'active'
        AND (cp.expires_at IS NULL OR cp.expires_at >= ctx.today)
        AND (cp.sessions_used >= cp.sessions_total - 1
             OR (cp.expires_at IS NOT NULL AND cp.expires_at <= ctx.today + 21))
      ORDER BY cp.customer_id, (cp.sessions_total - cp.sessions_used) ASC
    )
    SELECT b.customer_id, b.full_name, b.status, b.blocked,
           va.last_visit_on,
           (ctx.today - va.last_visit_on)::int AS days_since_visit,
           COALESCE(va.visits_12m, 0) AS visits_12m,
           mo.value_12m, pr.showed, pr.no_show, ib.last_inbound_at,
           fu.next_on, fv.favorite,
           od.overdue_procedure, od.overdue_days,
           pkg.package_name, pkg.sessions_left
    FROM base b
    CROSS JOIN ctx
    LEFT JOIN visit_agg va ON va.customer_id = b.customer_id
    LEFT JOIN fav fv ON fv.customer_id = b.customer_id
    LEFT JOIN money mo ON mo.customer_id = b.customer_id
    LEFT JOIN presence pr ON pr.customer_id = b.customer_id
    LEFT JOIN inbound ib ON ib.customer_id = b.customer_id
    LEFT JOIN future fu ON fu.customer_id = b.customer_id
    LEFT JOIN overdue od ON od.customer_id = b.customer_id
    LEFT JOIN pkg ON pkg.customer_id = b.customer_id
  `);
  const rows = result.rows as unknown as RawRow[];
  if (rows.length === 0) return 0;

  // Percentil de valor: posição acumulada só entre quem gastou algo (cume_dist)
  const values = rows
    .map((r) => Number(r.value_12m ?? 0))
    .filter((v) => v > 0)
    .sort((a, b) => a - b);
  const percentile = (v: number): number | null => {
    if (v <= 0 || values.length === 0) return null;
    let below = 0;
    for (const x of values) if (x <= v) below++;
    return Math.round((below / values.length) * 100);
  };

  const nowMs = Date.now();
  const upserts = rows.map((r) => {
    const visits12m = Number(r.visits_12m ?? 0);
    const value12m = Number(r.value_12m ?? 0);
    const showed = Number(r.showed ?? 0);
    const noShow = Number(r.no_show ?? 0);

    const daysSinceVisit = r.days_since_visit === null ? null : Number(r.days_since_visit);
    const lastInboundDaysAgo = r.last_inbound_at
      ? Math.max(0, Math.floor((nowMs - new Date(r.last_inbound_at).getTime()) / 86_400_000))
      : null;

    // Recência: 25 até 30 dias, cai linearmente até 0 aos 180 dias
    const recency =
      daysSinceVisit === null
        ? 0
        : daysSinceVisit <= 30
          ? 25
          : clamp(Math.round((25 * (180 - daysSinceVisit)) / 150), 0, 25);
    // Frequência: 1 visita/mês = nota cheia
    const frequency = clamp(Math.round((visits12m * 25) / 12), 0, 25);
    // Valor: posição relativa na própria clínica (justo para qualquer porte)
    const pctl = percentile(value12m);
    const value = pctl === null ? 0 : clamp(Math.round((pctl / 100) * 25), 0, 25);
    // Engajamento: presença (0-15) + resposta recente no WhatsApp (0-10)
    const showRate = showed + noShow > 0 ? showed / (showed + noShow) : null;
    const presencePart = showRate === null ? 7 : Math.round(showRate * 15);
    const inboundPart =
      lastInboundDaysAgo === null ? 0 : lastInboundDaysAgo <= 30 ? 10 : lastInboundDaysAgo <= 90 ? 5 : 0;
    const engagement = clamp(presencePart + inboundPart, 0, 25);

    const score = recency + frequency + value + engagement;
    const classification = score >= 70 ? "quente" : score >= 40 ? "morno" : "frio";

    const metrics: ScoreMetrics = {
      lastVisitOn: r.last_visit_on,
      daysSinceVisit,
      visits12m,
      value12m,
      valuePercentile: pctl,
      showed,
      noShow,
      showRate,
      lastInboundDaysAgo,
      nextAppointmentOn: r.next_on,
      favoriteProcedure: r.favorite,
      overdueProcedure: r.overdue_procedure,
      overdueDays: r.overdue_days === null ? null : Number(r.overdue_days),
      packageName: r.package_name,
      sessionsLeft: r.sessions_left === null ? null : Number(r.sessions_left),
      blocked: r.blocked,
    };
    const { kind, action } = suggestAction(r.status, metrics);

    return {
      clinicId,
      customerId: r.customer_id,
      score,
      recencyScore: recency,
      frequencyScore: frequency,
      valueScore: value,
      engagementScore: engagement,
      classification: classification as "quente" | "morno" | "frio",
      suggestedKind: kind,
      suggestedAction: action,
      metrics,
      computedAt: new Date(),
    };
  });

  for (let i = 0; i < upserts.length; i += 200) {
    const chunk = upserts.slice(i, i + 200);
    await db
      .insert(schema.customerScores)
      .values(chunk)
      .onConflictDoUpdate({
        target: schema.customerScores.customerId,
        set: {
          score: sql`excluded.score`,
          recencyScore: sql`excluded.recency_score`,
          frequencyScore: sql`excluded.frequency_score`,
          valueScore: sql`excluded.value_score`,
          engagementScore: sql`excluded.engagement_score`,
          classification: sql`excluded.classification`,
          suggestedKind: sql`excluded.suggested_kind`,
          suggestedAction: sql`excluded.suggested_action`,
          metrics: sql`excluded.metrics`,
          computedAt: sql`excluded.computed_at`,
        },
      });
  }

  // Remove scores de clientes que saíram da base (mescladas/excluídas)
  await db.execute(sql`
    DELETE FROM customer_scores cs
    WHERE cs.clinic_id = ${clinicId}
      AND NOT EXISTS (
        SELECT 1 FROM customers c
        WHERE c.id = cs.customer_id
          AND c.deleted_at IS NULL AND c.merged_into_id IS NULL
      )
  `);

  return upserts.length;
}

/** Decide a ação sugerida — regras determinísticas, sempre explicáveis. */
function suggestAction(
  status: string,
  m: ScoreMetrics,
): { kind: SuggestedKind; action: string } {
  if (m.blocked) {
    return { kind: "none", action: "Automações desligadas para esta cliente — nenhum envio." };
  }
  if (m.nextAppointmentOn) {
    return {
      kind: "none",
      action: `Nenhuma ação — já tem horário marcado para ${fmtDateBR(m.nextAppointmentOn)}.`,
    };
  }
  if (m.packageName) {
    const left = m.sessionsLeft ?? 0;
    return {
      kind: "package_renewal",
      action:
        left <= 1
          ? `Oferecer renovação do pacote ${m.packageName} — ${left === 0 ? "sessões esgotadas" : "última sessão restante"}.`
          : `Oferecer renovação do pacote ${m.packageName} — vencendo em breve.`,
    };
  }
  // Retorno muito atrasado deixou de ser "retorno": é reativação
  if (m.overdueProcedure && m.overdueDays !== null && m.overdueDays <= 60) {
    return {
      kind: "return_due",
      action: `Convidar para o retorno de ${m.overdueProcedure} — venceu há ${m.overdueDays} dia${m.overdueDays === 1 ? "" : "s"}.`,
    };
  }
  if (status === "lead" && m.visits12m === 0 && m.lastVisitOn === null) {
    return {
      kind: "first_visit",
      action: "Fazer um convite para a primeira visita — ainda não conheceu a clínica.",
    };
  }
  if (
    (m.daysSinceVisit !== null && m.daysSinceVisit > 90) ||
    (m.overdueProcedure && m.overdueDays !== null && m.overdueDays > 60)
  ) {
    const days = m.daysSinceVisit;
    return {
      kind: "reactivation",
      action:
        days !== null
          ? `Mandar uma mensagem carinhosa — sem visitas há ${days} dias.`
          : "Mandar uma mensagem carinhosa — faz tempo que não aparece.",
    };
  }
  if (m.daysSinceVisit !== null && m.daysSinceVisit <= 45) {
    return {
      kind: "next_session",
      action: m.favoriteProcedure
        ? `Convidar para agendar a próxima sessão de ${m.favoriteProcedure}.`
        : "Convidar para agendar a próxima visita.",
    };
  }
  return { kind: "none", action: "Nenhuma ação necessária agora." };
}

/**
 * Mensagem humanizada por tipo de sugestão — 1 balão, tom acolhedor,
 * sem cara de sistema (nada de listas, links ou assinatura).
 */
export function outreachMessage(
  kind: SuggestedKind,
  opts: { fullName: string; favoriteProcedure?: string | null; packageName?: string | null },
): string {
  const nome = firstName(opts.fullName);
  const proc = opts.favoriteProcedure;
  switch (kind) {
    case "return_due":
    case "next_session":
      return proc
        ? `Oi ${nome}, tudo bem? 💛 Lembrei de você por aqui — já está chegando a hora do seu retorno de ${proc}. Quer que eu veja uns horários dessa semana pra você?`
        : `Oi ${nome}, tudo bem? 💛 Lembrei de você por aqui — que tal marcarmos seu próximo horário? Me fala o melhor dia que eu vejo as opções pra você.`;
    case "reactivation":
      return `Oi ${nome}, tudo bem com você? Faz um tempinho que a gente não se vê por aqui e lembrei de você 💛 Se quiser dar uma passadinha, me avisa que eu encontro um horário gostoso pra você.`;
    case "package_renewal":
      return opts.packageName
        ? `Oi ${nome}! Suas sessões do ${opts.packageName} estão chegando ao fim — que tal já garantirmos a continuidade do seu cuidado? Se quiser, te passo as condições de renovação 😊`
        : `Oi ${nome}! Suas sessões estão chegando ao fim — quer que eu veja as condições pra você continuar o tratamento?`;
    case "first_visit":
      return `Oi ${nome}, tudo bem? Que bom ter você por aqui! Se quiser conhecer a clínica e conversar sobre o que você procura, me fala um dia bom pra você que eu organizo tudo 😊`;
    default:
      return `Oi ${nome}, tudo bem? Passando pra dar um oi e saber como você está 💛`;
  }
}
