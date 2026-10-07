/**
 * Gastos com API por clínica: registra o custo de cada uso (IA e modelos da
 * Meta), soma o mês e decide se algo pago ainda pode sair.
 *
 * Regra: passou do limite mensal → bloqueia o que custa dinheiro (turno da IA,
 * classificador por modelo, modelo da Meta fora da janela de 24h), a menos que
 * a clínica tenha ligado "permitir excedente" — aí continua e o excedente é
 * cobrado na próxima mensalidade. Mensagens de texto dentro da janela de 24h
 * e tudo pela Evolution não custam nada e nunca são bloqueados.
 */
import { and, eq, gte, sql } from "drizzle-orm";
import type { Logger } from "pino";
import {
  type LlmUsage,
  llmCostBrl,
  metaTemplateCategory,
  metaTemplateCostBrl,
  parseSpendSettings,
  round2,
  spendStatus,
  type SpendStatus,
} from "@clinicaos/core/spend";
import { todayISO, zonedToUtc } from "@clinicaos/core/timezone";
import { schema, unsafeGlobalDb } from "@clinicaos/db";

export interface MonthSpend {
  aiBrl: number;
  metaBrl: number;
  totalBrl: number;
  month: string;
}

/** Soma do mês corrente (no fuso da clínica). */
export async function getMonthSpend(clinicId: string, timezone: string): Promise<MonthSpend> {
  const db = unsafeGlobalDb();
  const month = todayISO(timezone).slice(0, 7);
  const since = zonedToUtc(`${month}-01`, "00:00", timezone);
  const ai = (
    await db
      .select({ total: sql<string>`COALESCE(sum(cost_brl), 0)::text` })
      .from(schema.aiUsage)
      .where(and(eq(schema.aiUsage.clinicId, clinicId), gte(schema.aiUsage.createdAt, since)))
  )[0];
  const meta = (
    await db
      .select({ total: sql<string>`COALESCE(sum(cost_brl), 0)::text` })
      .from(schema.whatsappUsage)
      .where(and(eq(schema.whatsappUsage.clinicId, clinicId), gte(schema.whatsappUsage.createdAt, since)))
  )[0];
  const aiBrl = Number(ai?.total ?? 0);
  const metaBrl = Number(meta?.total ?? 0);
  return { aiBrl, metaBrl, totalBrl: aiBrl + metaBrl, month };
}

/** Situação do mês frente ao limite da clínica. */
export async function getSpendStatus(clinic: {
  id: string;
  timezone: string;
  settings: unknown;
}): Promise<SpendStatus & { month: string }> {
  const settings = parseSpendSettings(clinic.settings);
  const spend = await getMonthSpend(clinic.id, clinic.timezone);
  return { ...spendStatus(spend.totalBrl, settings), month: spend.month };
}

/**
 * Grava o uso de IA com o custo estimado e devolve o custo.
 * ownKey = a clínica usa a própria chave do provedor: os tokens ficam
 * registrados, mas o custo para a plataforma é zero (ela paga direto).
 */
export async function recordAiUsage(input: {
  clinicId: string;
  purpose: string;
  model: string;
  usage: LlmUsage;
  ownKey: boolean;
}): Promise<number> {
  const cost = input.ownKey ? 0 : llmCostBrl(input.model, input.usage);
  await unsafeGlobalDb()
    .insert(schema.aiUsage)
    .values({
      clinicId: input.clinicId,
      purpose: input.purpose,
      model: input.model,
      // entrada total (inclui cache) — o custo já pondera cada tipo
      inputTokens:
        input.usage.inputTokens + (input.usage.cacheWriteTokens ?? 0) + (input.usage.cacheReadTokens ?? 0),
      outputTokens: input.usage.outputTokens,
      costBrl: cost.toFixed(6),
    });
  return cost;
}

/** Grava um modelo da Meta enviado (é o que a Meta cobra) e devolve o custo. */
export async function recordMetaUsage(input: {
  clinicId: string;
  instanceId: string;
  messageId: string;
  category: string | null | undefined;
  templateName: string;
}): Promise<number> {
  const cost = metaTemplateCostBrl(input.category);
  await unsafeGlobalDb()
    .insert(schema.whatsappUsage)
    .values({
      clinicId: input.clinicId,
      instanceId: input.instanceId,
      messageId: input.messageId,
      category: metaTemplateCategory(input.category),
      templateName: input.templateName,
      costBrl: cost.toFixed(6),
    });
  return cost;
}

/**
 * Avisa a clínica ao cruzar 80% e 100% do limite — uma vez por mês cada.
 * Chamado depois de registrar um uso; barato o bastante para rodar sempre.
 */
export async function notifySpendThresholds(
  clinic: { id: string; timezone: string; settings: unknown },
  logger: Logger,
): Promise<void> {
  const settings = parseSpendSettings(clinic.settings);
  const status = await getSpendStatus(clinic);
  const alerts =
    settings.alerts && settings.alerts.month === status.month
      ? settings.alerts
      : { month: status.month, warned80: false, warned100: false };

  let title: string | null = null;
  let body: string | null = null;
  if (status.ratio >= 1 && !alerts.warned100) {
    alerts.warned100 = true;
    alerts.warned80 = true;
    title = "Limite mensal de gastos com API atingido";
    body = status.allowOverage
      ? `Gasto do mês: R$ ${round2(status.spentBrl).toFixed(2)} de R$ ${status.limitBrl.toFixed(2)}. Como o excedente está liberado, tudo continua funcionando e a diferença entra na próxima mensalidade.`
      : `Gasto do mês: R$ ${round2(status.spentBrl).toFixed(2)} de R$ ${status.limitBrl.toFixed(2)}. A assistente e os modelos pagos da Meta ficam pausados até o próximo mês — ou aumente o limite / libere o excedente em Configurações → Gastos com API.`;
  } else if (status.ratio >= 0.8 && !alerts.warned80) {
    alerts.warned80 = true;
    title = "Gastos com API chegaram a 80% do limite";
    body = `Gasto do mês: R$ ${round2(status.spentBrl).toFixed(2)} de R$ ${status.limitBrl.toFixed(2)}. Acompanhe em Configurações → Gastos com API.`;
  }
  if (!title) return;

  const db = unsafeGlobalDb();
  await db.execute(sql`
    UPDATE clinics SET settings = settings || jsonb_build_object('spend',
      COALESCE(settings->'spend', '{}'::jsonb) || jsonb_build_object('alerts', ${JSON.stringify(alerts)}::jsonb))
    WHERE id = ${clinic.id}
  `);
  await db.insert(schema.notifications).values({
    clinicId: clinic.id,
    type: "spend_limit",
    title,
    body,
  });
  logger.warn({ clinicId: clinic.id, ratio: status.ratio }, title);
}
