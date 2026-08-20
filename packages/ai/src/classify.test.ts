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
