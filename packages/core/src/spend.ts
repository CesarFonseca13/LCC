/**
 * Gastos com API por clínica — preços de referência, conversão para reais e
 * configuração do limite mensal.
 *
 * O custo é ESTIMADO no momento do uso (tokens × preço do modelo; modelo da Meta
 * × preço da categoria) e gravado em reais, para a clínica acompanhar e para a
 * plataforma cobrar o excedente na mensalidade. Preços mudam: os valores aqui
 * são os de referência de 2026 e podem ser sobrescritos por variáveis de
 * ambiente sem redeploy de código.
 */

import { parseClinicPlan } from "./plans";

// ── Câmbio ───────────────────────────────────────────────────────────

const DEFAULT_USD_BRL = 5.4;

/** Dólar usado para converter os preços dos modelos de IA (USD_BRL_RATE). */
export function usdBrlRate(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.USD_BRL_RATE);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_USD_BRL;
}

// ── Modelos de IA (USD por 1 milhão de tokens) ───────────────────────

interface LlmPrice {
  /** Prefixo do nome do modelo (casa o mais longo primeiro). */
  prefix: string;
  inputPerM: number;
  outputPerM: number;
}

/** Tabela de referência. Prefixos mais específicos antes dos genéricos. */
const LLM_PRICES: LlmPrice[] = [
  // OpenAI
  { prefix: "gpt-5-nano", inputPerM: 0.05, outputPerM: 0.4 },
  { prefix: "gpt-5-mini", inputPerM: 0.25, outputPerM: 2 },
  { prefix: "gpt-5", inputPerM: 1.25, outputPerM: 10 },
  { prefix: "gpt-4.1-nano", inputPerM: 0.1, outputPerM: 0.4 },
  { prefix: "gpt-4.1-mini", inputPerM: 0.4, outputPerM: 1.6 },
  { prefix: "gpt-4.1", inputPerM: 2, outputPerM: 8 },
  { prefix: "gpt-4o-mini", inputPerM: 0.15, outputPerM: 0.6 },
  { prefix: "gpt-4o", inputPerM: 2.5, outputPerM: 10 },
  { prefix: "o4-mini", inputPerM: 1.1, outputPerM: 4.4 },
  { prefix: "o3-mini", inputPerM: 1.1, outputPerM: 4.4 },
  { prefix: "o3", inputPerM: 2, outputPerM: 8 },
  // Anthropic
  { prefix: "claude-haiku-4", inputPerM: 1, outputPerM: 5 },
  { prefix: "claude-3-5-haiku", inputPerM: 0.8, outputPerM: 4 },
  { prefix: "claude-sonnet-4", inputPerM: 3, outputPerM: 15 },
  { prefix: "claude-3-7-sonnet", inputPerM: 3, outputPerM: 15 },
  { prefix: "claude-3-5-sonnet", inputPerM: 3, outputPerM: 15 },
  { prefix: "claude-opus-4", inputPerM: 15, outputPerM: 75 },
  { prefix: "claude-fable", inputPerM: 15, outputPerM: 75 },
  { prefix: "claude-mythos", inputPerM: 15, outputPerM: 75 },
  { prefix: "claude-opus", inputPerM: 15, outputPerM: 75 },
  { prefix: "claude-sonnet", inputPerM: 3, outputPerM: 15 },
  { prefix: "claude-haiku", inputPerM: 1, outputPerM: 5 },
];

/** Modelo desconhecido: assume um preço médio para não subestimar. */
const DEFAULT_LLM_PRICE: LlmPrice = { prefix: "", inputPerM: 2.5, outputPerM: 10 };

export function llmPriceFor(model: string): LlmPrice {
  const m = model.trim().toLowerCase();
  let best: LlmPrice | null = null;
  for (const p of LLM_PRICES) {
    if (m.startsWith(p.prefix) && (!best || p.prefix.length > best.prefix.length)) best = p;
  }
  return best ?? DEFAULT_LLM_PRICE;
}

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
  /** Gravação de cache de prompt (Anthropic cobra 1,25× a entrada). */
  cacheWriteTokens?: number;
  /** Leitura de cache de prompt (Anthropic 0,1× e OpenAI 0,5× a entrada). */
  cacheReadTokens?: number;
}

/** Custo em reais de uma chamada de modelo, incluindo tokens de cache. */
export function llmCostBrl(model: string, usage: LlmUsage, env: NodeJS.ProcessEnv = process.env): number {
  const p = llmPriceFor(model);
  const anthropic = model.trim().toLowerCase().startsWith("claude");
  const cacheWriteFactor = anthropic ? 1.25 : 1;
  const cacheReadFactor = anthropic ? 0.1 : 0.5;
  const inputUsd =
    ((usage.inputTokens +
      (usage.cacheWriteTokens ?? 0) * cacheWriteFactor +
      (usage.cacheReadTokens ?? 0) * cacheReadFactor) /
      1_000_000) *
    p.inputPerM;
  const outputUsd = (usage.outputTokens / 1_000_000) * p.outputPerM;
  return round6((inputUsd + outputUsd) * usdBrlRate(env));
}

// ── Meta (WhatsApp Business Platform) — reais por modelo entregue ────

export type MetaTemplateCategory = "utility" | "marketing" | "authentication";

/** Referência Brasil 2026. Mensagens dentro da janela de 24h não custam nada. */
const META_PRICES_BRL: Record<MetaTemplateCategory, number> = {
  utility: 0.04,
  marketing: 0.35,
  authentication: 0.19,
};

export function metaTemplateCategory(raw: string | null | undefined): MetaTemplateCategory {
  const c = (raw ?? "").toLowerCase();
  if (c === "marketing") return "marketing";
  if (c === "authentication") return "authentication";
  return "utility";
}

/** Custo em reais de um modelo da Meta (META_PRICE_UTILITY_BRL etc. sobrescrevem). */
export function metaTemplateCostBrl(
  category: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): number {
  const cat = metaTemplateCategory(category);
  const override = Number(env[`META_PRICE_${cat.toUpperCase()}_BRL`]);
  return round6(Number.isFinite(override) && override >= 0 ? override : META_PRICES_BRL[cat]);
}

// ── Configuração da clínica (clinics.settings.spend) ─────────────────

/** Limite padrão quando a clínica nunca mexeu — baixo de propósito: quem precisa de mais, sobe. */
export const DEFAULT_MONTHLY_LIMIT_BRL = 50;
export const MAX_MONTHLY_LIMIT_BRL = 100_000;

export interface SpendSettings {
  /** Limite mensal em reais (sempre definido — o padrão vale quando nunca foi salvo). */
  monthlyLimitBrl: number;
  /** true = passou do limite continua funcionando e o excedente vai na próxima mensalidade. */
  allowOverage: boolean;
  /** Avisos já enviados neste mês (evita repetir a notificação). */
  alerts: { month: string; warned80: boolean; warned100: boolean } | null;
}

export function parseSpendSettings(settings: unknown): SpendSettings {
  const spend = ((settings ?? {}) as Record<string, unknown>).spend as
    | Record<string, unknown>
    | undefined;
  const limit = Number(spend?.monthlyLimitBrl);
  // Sem limite salvo: vale a franquia do plano da clínica; sem plano, o padrão da plataforma
  const planAllowance = parseClinicPlan(settings)?.apiAllowanceBrl;
  const fallback = planAllowance ?? DEFAULT_MONTHLY_LIMIT_BRL;
  const alerts = spend?.alerts as Record<string, unknown> | undefined;
  return {
    monthlyLimitBrl:
      Number.isFinite(limit) && limit > 0 ? Math.min(limit, MAX_MONTHLY_LIMIT_BRL) : fallback,
    allowOverage: spend?.allowOverage === true,
    alerts:
      alerts && typeof alerts.month === "string"
        ? {
            month: alerts.month,
            warned80: alerts.warned80 === true,
            warned100: alerts.warned100 === true,
          }
        : null,
  };
}

export interface SpendStatus {
  spentBrl: number;
  limitBrl: number;
  allowOverage: boolean;
  /** Fração do limite já usada (pode passar de 1). */
  ratio: number;
  overLimit: boolean;
  /** true = nada que custa dinheiro pode sair até o próximo mês ou mudança da configuração. */
  blocked: boolean;
  /** Quanto passou do limite (0 se não passou). */
  overageBrl: number;
}

export function spendStatus(spentBrl: number, settings: SpendSettings): SpendStatus {
  const overLimit = spentBrl >= settings.monthlyLimitBrl;
  return {
    spentBrl: round2(spentBrl),
    limitBrl: settings.monthlyLimitBrl,
    allowOverage: settings.allowOverage,
    ratio: settings.monthlyLimitBrl > 0 ? spentBrl / settings.monthlyLimitBrl : 0,
    overLimit,
    blocked: overLimit && !settings.allowOverage,
    overageBrl: overLimit ? round2(spentBrl - settings.monthlyLimitBrl) : 0,
  };
}

/** Texto que o sistema mostra quando algo deixou de sair por causa do limite. */
export const SPEND_BLOCKED_MESSAGE =
  "Limite mensal de gastos com API atingido — aumente o limite ou libere o excedente em Configurações → Gastos com API.";

// ── Utilidades ───────────────────────────────────────────────────────

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}

export function formatBrl(n: number): string {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
