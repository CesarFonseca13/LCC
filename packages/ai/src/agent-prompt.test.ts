import { describe, expect, it } from "vitest";
import { buildSystemPrompt, catalogLine, type AgentClinicInfo } from "./agent";

const clinic = (catalog: AgentClinicInfo["catalog"]): AgentClinicInfo => ({
  name: "Clínica Teste",
  city: "Cabreúva",
  address: null,
  phone: null,
  businessHoursLabel: "segunda a sexta das 08:00 às 18:00",
  catalog,
  facts: null,
  offersEnabled: false,
});

describe("preço no prompt da atendente", () => {
  it("linha do catálogo por modo de preço", () => {
    expect(catalogLine({ name: "Limpeza", price: "180,00", priceMode: "fixed", durationMinutes: 60 })).toBe(
      "- Limpeza: a partir de R$ 180,00 (60 min)",
    );
    const sob = catalogLine({ name: "Botox", price: "0,00", priceMode: "on_request", durationMinutes: 30 });
    expect(sob).toContain("valor sob avaliação");
    expect(sob).not.toContain("R$");
    expect(catalogLine({ name: "Avaliação", price: "0,00", priceMode: "free", durationMinutes: 20 })).toBe(
      "- Avaliação: gratuito (20 min)",
    );
    // A própria avaliação/consulta sob avaliação não pode ter valor "definido na avaliação" (circular)
    const consulta = catalogLine({ name: "Consulta médica", price: "0,00", priceMode: "on_request", durationMinutes: 30 });
    expect(consulta).not.toContain("definido pelo profissional na avaliação");
    expect(consulta).toContain("a equipe confirma o valor");
  });

  it("consulta sob avaliação: regra própria, sem resposta circular", () => {
    const persona = { assistantName: "Ana", tone: "elegante" as const };
    const p = buildSystemPrompt(persona, clinic([{ name: "Consulta", price: "0,00", priceMode: "on_request", durationMinutes: 30 }]));
    expect(p).toContain("a equipe confirma esse valor");
    expect(p).toContain("nunca diga que é gratuito");
    expect(p).not.toContain("Para marcar, agende o próprio serviço");
  });

  it("anexos e mensagem indisponível: nunca fingir, resolver o texto, passar para a equipe", () => {
    const persona = { assistantName: "Ana", tone: "elegante" as const };
    const p = buildSystemPrompt(persona, { ...clinic([{ name: "Limpeza", price: "180,00", priceMode: "fixed", durationMinutes: 60 }]), offersEnabled: true });
    expect(p).toContain("14. Mensagens entre colchetes");
    expect(p).toContain("[mensagem indisponível]");
    expect(p).toContain("Nunca finja que viu, ouviu ou entendeu");
    expect(p).toContain("primeiro resolva o que ela escreveu em texto junto");
    expect(p).toContain("urgência alta se envolver saúde");
    expect(p).toContain("15. VENDA COMPLEMENTAR");
    // Reconsulta para pegar o slot_id usa o MESMO dia e turno
    expect(p).toContain("com a MESMA data e o MESMO turno do horário escolhido");
  });

  it("regra de valor sob avaliação só entra quando há serviço assim", () => {
    const persona = { assistantName: "Ana", tone: "elegante" as const };
    const com = buildSystemPrompt(persona, clinic([{ name: "Harmonização facial", price: "0,00", priceMode: "on_request", durationMinutes: 60 }]));
    expect(com).toContain("varia de acordo com o caso de cada pessoa");
    expect(com).toContain("ofereça marcar a avaliação");
    expect(com).toContain("use o nome exato dele");
    expect(com).not.toContain("R$ 0,00");
    const sem = buildSystemPrompt(persona, clinic([{ name: "Limpeza", price: "180,00", priceMode: "fixed", durationMinutes: 60 }]));
    expect(sem).not.toContain("valor sob avaliação");
    expect(sem).toContain("a partir de R$ 180,00");
  });
});
