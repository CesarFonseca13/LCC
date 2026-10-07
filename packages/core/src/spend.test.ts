import { describe, expect, it } from "vitest";
import {
  DEFAULT_MONTHLY_LIMIT_BRL,
  llmCostBrl,
  llmPriceFor,
  metaTemplateCostBrl,
  parseSpendSettings,
  spendStatus,
} from "./spend";

describe("preços de IA", () => {
  it("casa o prefixo mais específico", () => {
    expect(llmPriceFor("gpt-4o-mini-2024-07-18").inputPerM).toBe(0.15);
    expect(llmPriceFor("gpt-4o").inputPerM).toBe(2.5);
    expect(llmPriceFor("claude-haiku-4-5-20251001").outputPerM).toBe(5);
    expect(llmPriceFor("modelo-desconhecido").inputPerM).toBe(2.5);
  });
  it("converte para reais com o câmbio informado", () => {
    // 1M in + 1M out no gpt-4o-mini = US$ 0,75 → R$ 3,75 a 5,00
    expect(llmCostBrl("gpt-4o-mini", 1_000_000, 1_000_000, { USD_BRL_RATE: "5" })).toBe(3.75);
    expect(llmCostBrl("gpt-4o-mini", 0, 0)).toBe(0);
  });
});

describe("preços da Meta", () => {
  it("usa a categoria e aceita sobrescrita por ambiente", () => {
    expect(metaTemplateCostBrl("UTILITY", {})).toBe(0.04);
    expect(metaTemplateCostBrl("MARKETING", {})).toBe(0.35);
    expect(metaTemplateCostBrl(null, {})).toBe(0.04);
    expect(metaTemplateCostBrl("marketing", { META_PRICE_MARKETING_BRL: "0.5" })).toBe(0.5);
  });
});

describe("configuração e status", () => {
  it("padrão quando a clínica nunca salvou", () => {
    const s = parseSpendSettings({});
    expect(s.monthlyLimitBrl).toBe(DEFAULT_MONTHLY_LIMIT_BRL);
    expect(s.allowOverage).toBe(false);
    expect(s.alerts).toBeNull();
  });
  it("bloqueia só quando passou e não liberou excedente", () => {
    const base = parseSpendSettings({ spend: { monthlyLimitBrl: 100, allowOverage: false } });
    expect(spendStatus(99.99, base).blocked).toBe(false);
    expect(spendStatus(100, base).blocked).toBe(true);
    expect(spendStatus(130, base).overageBrl).toBe(30);
    const livre = parseSpendSettings({ spend: { monthlyLimitBrl: 100, allowOverage: true } });
    expect(spendStatus(130, livre).blocked).toBe(false);
    expect(spendStatus(130, livre).overLimit).toBe(true);
  });
});
