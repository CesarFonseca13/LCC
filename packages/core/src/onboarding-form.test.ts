import { describe, expect, it } from "vitest";
import {
  ONBOARDING_SECTIONS,
  missingRequired,
  onboardingEntries,
  onboardingHtml,
  onboardingSummary,
  sanitizeOnboardingAnswers,
} from "./onboarding-form";

const filled = () => ({
  clinica: { nome: "Clínica Bella", especialidade: "Estética facial", tel: "(61) 99999-0000", cep: "70000-000", rua: "Rua A", numero: "10", bairro: "Centro", cidade: "Brasília", uf: "DF" },
  horario: { hours: { seg: { on: true, a: "08:00", f: "19:00" }, dom: { on: false, a: "", f: "" } } },
  casa: { chegar: "Ao lado do metrô", estac: "Rua", pagto: "Pix e cartão em 3x", cancel: "24h de antecedência" },
  equipe: { dona_nome: "Maria", dona_email: "maria@x.com", dona_atende: "Sim", responsavel_wa: "Maria" },
  profissionais: { lista: [{ nome: "Dra. Maria", servicos: "todos" }] },
  servicos: { lista: [{ nome: "Limpeza de pele", duracao: "60", preco: "180" }, {}] },
  pacotes: { vende: "Não" },
  whatsapp: { numero: "(61) 98440-9779", onde: "No app WhatsApp Business do celular", coex: "Sim, nos dois (recomendado)", exibicao: "Clínica Bella", facebook: "Maria" },
  ana: { ligar: "Sim, desde o início", nome: "Ana", tom: "Acolhedora (calorosa e próxima, usa um coração)", ofertas: "Sim", estouro: "Pausar a atendente e as mensagens automáticas pagas até o mês seguinte (a equipe responde pelo painel)" },
  auto: { modo: "Tudo automático (recomendado)", ligar: ["Parabéns no aniversário", "inventada"] },
  online: { quer: "Não" },
  clientes: { base: "Não, começamos do zero", termos: "Usar o modelo padrão do VesaliusX", anamnese: "Usar a ficha padrão" },
});

describe("formulário de implantação", () => {
  it("todas as seções têm id único e chaves únicas", () => {
    const ids = ONBOARDING_SECTIONS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of ONBOARDING_SECTIONS) {
      const ks = s.fields.map((f) => f.k);
      expect(new Set(ks).size).toBe(ks.length);
    }
  });
  it("limpa o que não é conhecido e mantém só opções válidas", () => {
    const a = sanitizeOnboardingAnswers({ ...filled(), lixo: { x: 1 }, auto: { modo: "qualquer", ligar: ["Parabéns no aniversário", "inventada"] } });
    expect(a.lixo).toBeUndefined();
    expect(a.auto?.modo).toBe("");
    expect(a.auto?.ligar).toEqual(["Parabéns no aniversário"]);
    // item vazio da lista some; horário inválido é zerado
    expect((a.servicos?.lista as unknown[]).length).toBe(1);
    const h = a.horario?.hours as Record<string, { on: boolean; a: string }>;
    expect(h.seg?.a).toBe("08:00");
    expect(h.ter?.on).toBe(false);
  });
  it("aponta as obrigatórias que faltam", () => {
    const src = filled();
    src.clinica.nome = "";
    src.auto.modo = "opção inexistente";
    const miss = missingRequired(sanitizeOnboardingAnswers(src));
    expect(miss).toContain("Sobre a clínica: Nome da clínica");
    expect(miss).toContain("Mensagens automáticas: Como começar?");
    expect(miss.length).toBe(2);
  });
  it("dia aberto sem horário válido, número não inteiro, e-mail inválido e item sem nome são pendências", () => {
    const src = filled();
    src.horario.hours = { seg: { on: true, a: "xx", f: "" }, ter: { on: true, a: "19:00", f: "08:00" }, qua: { on: true, a: "08:00", f: "18:00" } } as never;
    src.servicos.lista = [{ nome: "Botox", duracao: "1e3" }, { duracao: "30" }] as never;
    src.equipe.dona_email = "maria@";
    const miss = missingRequired(sanitizeOnboardingAnswers(src));
    expect(miss.some((m) => m.includes("Segunda: horário inválido"))).toBe(true);
    expect(miss.some((m) => m.includes("Terça: horário inválido"))).toBe(true);
    expect(miss.some((m) => m.includes("Quarta"))).toBe(false);
    expect(miss.some((m) => m.includes("Serviço 1, duração (minutos) (só números inteiros)"))).toBe(true);
    expect(miss.some((m) => m.includes("Serviço 2 sem nome do serviço"))).toBe(true);
    expect(miss.some((m) => m.includes("E-mail de login da responsável (e-mail inválido)"))).toBe(true);
  });
  it("obrigatórias condicionais: pacotes só quando vende, link só quando quer", () => {
    const src = filled();
    src.pacotes = { vende: "Sim" } as never;
    (src as Record<string, unknown>).online = { quer: "Sim", slug: "" };
    const miss = missingRequired(sanitizeOnboardingAnswers(src));
    expect(miss).toContain("Pacotes de sessões: Pacotes");
    expect(miss).toContain("Agendamento online: Nome curto para o link");
  });
  it("blocos em branco não gastam o limite da lista", () => {
    const src = filled();
    src.servicos.lista = Array.from({ length: 85 }, (_, i) => (i % 10 === 0 ? {} : { nome: `S${i}` })) as never;
    const a = sanitizeOnboardingAnswers(src);
    expect((a.servicos?.lista as unknown[]).length).toBe(76);
  });
  it("formulário completo não tem pendências", () => {
    const a = sanitizeOnboardingAnswers(filled());
    const miss = missingRequired(a);
    expect(miss).toEqual([]);
  });
  it("resumo, entradas e HTML", () => {
    const a = sanitizeOnboardingAnswers(filled());
    expect(onboardingSummary(a)).toEqual({ clinicName: "Clínica Bella", contactName: "Maria", contactPhone: "(61) 98440-9779", contactEmail: "maria@x.com" });
    const e = onboardingEntries(a);
    const serv = e.find((s) => s.id === "servicos")!.entries[0]!;
    expect(serv.items?.[0]?.title).toBe("Serviço 1: Limpeza de pele");
    const html = onboardingHtml(a, { id: "abcdef12-0000", receivedAt: "22/10/2026" });
    expect(html).toContain("Clínica Bella");
    expect(html).toContain("Segunda: 08:00 às 19:00");
    expect(html).not.toContain("<script");
  });
  it("escapa HTML nas respostas", () => {
    const a = sanitizeOnboardingAnswers({ ...filled(), clinica: { ...filled().clinica, nome: "<b>x</b>" } });
    expect(onboardingHtml(a, { id: "1", receivedAt: "" })).toContain("&lt;b&gt;x&lt;/b&gt;");
  });
});
