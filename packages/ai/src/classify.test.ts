import { describe, expect, it } from "vitest";
import { classifyByKeywords } from "./classify";

describe("classifyByKeywords (pt-BR coloquial)", () => {
  it("confirmações", () => {
    for (const text of [
      "Sim",
      "sim!",
      "SIM",
      "Pode confirmar",
      "pode confirmar sim!",
      "Confirmo",
      "confirmado",
      "ok",
      "Blz",
      "beleza",
      "claro!",
      "com certeza",
      "vou sim",
      "combinado",
      "👍",
    ]) {
      expect(classifyByKeywords(text), text).toBe("confirm");
    }
  });

  it("cancelamentos", () => {
    for (const text of [
      "não vou conseguir ir",
      "nao vou poder",
      "preciso cancelar",
      "cancela por favor",
      "quero desmarcar",
      "tive um imprevisto",
      "n vou",
    ]) {
      expect(classifyByKeywords(text), text).toBe("cancel");
    }
  });

  it("remarcações (vencem confirmação e cancelamento)", () => {
    for (const text of [
      "posso remarcar?",
      "da pra reagendar",
      "quero mudar o horário",
      "tem outro horário?",
      "não vou poder, pode remarcar pra semana que vem?",
      "podemos adiar?",
    ]) {
      expect(classifyByKeywords(text), text).toBe("reschedule");
    }
  });

  it("negação, adiamento e frase com 'pode ser' no meio nunca viram confirmação", () => {
    for (const text of ["Não estarei aí amanhã", "não vai dar pra mim", "não dá pra mim amanhã", "vou faltar", "não vai rolar"]) {
      expect(classifyByKeywords(text), text).toBe("cancel");
    }
    for (const text of [
      "Depois te confirmo",
      "Vou ver com meu marido e te confirmo",
      "Ainda não sei se confirmo",
      "Não confirmo ainda",
      "Pode ser na quinta",
      "pode ser de tarde",
      "Com certeza está pior que ontem",
      "está saindo um líquido claro",
    ]) {
      expect(classifyByKeywords(text), text).not.toBe("confirm");
    }
  });

  it("confirmações com 'sim'/'obrigada'/emoji em volta continuam sendo confirmação", () => {
    for (const text of [
      "Sim, pode ser",
      "Pode ser sim",
      "Claro que sim",
      "Combinado, obrigada",
      "Combinado 👍",
      "Com certeza 👍",
      "Claro 💛",
      "Combinado, até amanhã",
      "Confirmo, depois mando o comprovante",
      "Estarei aí, depois do trabalho",
      "Te confirmo sim, estarei lá",
      "Confirmo, mas ainda não paguei",
    ]) {
      expect(classifyByKeywords(text), text).toBe("confirm");
    }
  });

  it("'não vou faltar' e 'vou faltar não' nunca viram cancelamento", () => {
    for (const text of ["Vou faltar não", "Não vou faltar", "Estarei lá sim, não dá pra perder", "Confirmo! Não vai dar pra chegar antes das 10", "Sim, não vai dar problema"]) {
      expect(classifyByKeywords(text), text).not.toBe("cancel");
    }
  });

  it("perguntas viram question", () => {
    expect(classifyByKeywords("quanto custa a limpeza?")).toBe("question");
    expect(classifyByKeywords("onde fica a clínica?")).toBe("question");
  });

  it("ambíguo vira null (nunca age no escuro)", () => {
    expect(classifyByKeywords("hmm vou ver aqui")).toBeNull();
    expect(classifyByKeywords("te falo depois")).toBeNull();
    expect(classifyByKeywords("")).toBeNull();
  });
});
