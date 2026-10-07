/**
 * Tabela comercial da plataforma — planos, implantação, descontos e regras.
 * Fonte única para a landing, o card de gastos e a proposta comercial.
 * Mudou preço? Muda aqui e sobe o deploy do web.
 */

export type PlanId = "essencial" | "profissional" | "clinica";

export interface Plan {
  id: PlanId;
  name: string;
  monthlyBrl: number;
  /** Franquia mensal de gastos com API (IA + modelos da Meta) incluída no plano. */
  apiAllowanceBrl: number;
  whatsappNumbers: number | null; // null = ilimitado
  professionals: number | null; // null = ilimitado
  tagline: string;
  features: string[];
  highlight?: boolean;
}

export const PLANS: Plan[] = [
  {
    id: "essencial",
    name: "Essencial",
    monthlyBrl: 297,
    apiAllowanceBrl: 30,
    whatsappNumbers: 1,
    professionals: 2,
    tagline: "Para quem está começando ou atende sozinha",
    features: [
      "Ana, a assistente que responde no WhatsApp 24h",
      "Confirmações, lembretes e pós-atendimento automáticos",
      "Agenda, cadastro de clientes e histórico",
      "Termos de consentimento com assinatura pelo celular",
      "Base de conhecimento e aprovações",
    ],
  },
  {
    id: "profissional",
    name: "Profissional",
    monthlyBrl: 597,
    apiAllowanceBrl: 80,
    whatsappNumbers: 2,
    professionals: 6,
    tagline: "A clínica inteira numa conta só",
    highlight: true,
    features: [
      "Tudo do Essencial",
      "Funil de vendas, orçamentos e campanhas",
      "Reativação automática de clientes sumidas",
      "Estoque, comissões e financeiro fechando o mês",
      "Agendamento online e análises mensais",
    ],
  },
  {
    id: "clinica",
    name: "Clínica",
    monthlyBrl: 997,
    apiAllowanceBrl: 150,
    whatsappNumbers: null,
    professionals: null,
    tagline: "Várias unidades, equipe grande",
    features: [
      "Tudo do Profissional",
      "Números e profissionais ilimitados, multiunidade",
      "Suporte prioritário e acompanhamento mensal",
      "Personalização de fluxos e de modelos de mensagem",
    ],
  },
];

export const SETUP_FEE = {
  /** Valor cobrado hoje. */
  brl: 990,
  /** Valor de tabela, mostrado riscado. */
  listBrl: 1500,
  installments: 3,
  includes: [
    "Configuração da conta e importação da planilha de clientes",
    "Cadastro de serviços, equipe e horários",
    "Base de conhecimento montada com a dona",
    "Conexão do WhatsApp e treinamento da equipe (2 h)",
    "30 dias de acompanhamento",
  ],
};

export const COMMERCIAL_RULES = {
  /** Semestral pago à vista. */
  semiannualUpfrontDiscount: 0.1,
  /** Anual pago à vista (e implantação grátis). */
  annualUpfrontDiscount: 0.2,
  /** Anual pagando mês a mês (fidelidade de 12 meses). */
  annualMonthlyDiscount: 0.1,
  /** Promoção de entrada: 3 primeiros meses pelo preço do Essencial, só com fidelidade de 12 meses. */
  rampMonths: 3,
  rampPriceBrl: 297,
  rampRequiresMonths: 12,
  /** Garantia para quem fecha sem fidelidade. */
  guaranteeDays: 30,
  /** Excedente de API acima da franquia: cobrado na mensalidade seguinte com este acréscimo. */
  apiOverageMarkup: 0.2,
  /** Reajuste anual. */
  indexation: "IPCA",
  /** Corte de acesso após atraso (dias). */
  suspensionAfterDays: 15,
};

export function planById(id: string | null | undefined): Plan | null {
  return PLANS.find((p) => p.id === id) ?? null;
}

/** Plano salvo em clinics.settings.plan ("essencial" | "profissional" | "clinica"). */
export function parseClinicPlan(settings: unknown): Plan | null {
  const raw = ((settings ?? {}) as Record<string, unknown>).plan;
  return typeof raw === "string" ? planById(raw) : null;
}

export function annualUpfrontTotal(plan: Plan): number {
  return Math.round(plan.monthlyBrl * 12 * (1 - COMMERCIAL_RULES.annualUpfrontDiscount));
}
export function semiannualUpfrontTotal(plan: Plan): number {
  return Math.round(plan.monthlyBrl * 6 * (1 - COMMERCIAL_RULES.semiannualUpfrontDiscount));
}
export function annualMonthlyPrice(plan: Plan): number {
  return Math.round(plan.monthlyBrl * (1 - COMMERCIAL_RULES.annualMonthlyDiscount));
}
