/**
 * Catálogo de templates que o sistema registra na Meta para cada número
 * conectado pela API oficial. Uma finalidade (automação) = um template.
 * Fora da janela de 24h a mensagem sai com ESTE texto (aprovado pela Meta)
 * e os valores em template_vars viram os parâmetros; dentro da janela sai
 * o texto que a clínica personalizou.
 *
 * Regras da Meta observadas: nomes minúsculos com "_", corpo começa e termina
 * com texto fixo (não com variável), exemplos para cada parâmetro, UTILITY
 * só para o que é transacional (lembrete, confirmação, termo, orçamento).
 */
import type { MetaTemplateSpec } from "./meta";

export interface TemplateCatalogEntry {
  purpose: string;
  name: string;
  category: "UTILITY" | "MARKETING";
  /** Texto com {{1}}..{{n}} na ordem de paramNames. */
  bodyText: string;
  paramNames: string[];
  examples: string[];
  /** Botão de link: variável que preenche o sufixo (o URL base vem do APP_URL). */
  button?: { text: string; pathPrefix: string; param: string; example: string };
}

export const META_TEMPLATE_LANGUAGE = "pt_BR";

export const META_TEMPLATE_CATALOG: TemplateCatalogEntry[] = [
  {
    purpose: "reminder_24h",
    name: "vx_lembrete_24h_v1",
    category: "UTILITY",
    bodyText:
      "Oi, {{1}}! Passando para lembrar do seu horário de {{2}} amanhã, {{3}} às {{4}}, com {{5}} aqui na {{6}}. Se precisar remarcar, é só responder esta mensagem. Até lá! 💛",
    paramNames: ["nome", "procedimento", "data", "hora", "profissional", "clinica"],
    examples: ["Mariana", "Limpeza de Pele", "16/09/2026", "14:00", "Dra. Paula", "Clínica Bella"],
  },
  {
    purpose: "confirm_2h",
    name: "vx_confirmacao_2h_v1",
    category: "UTILITY",
    bodyText:
      "Oi, {{1}}! Seu horário de {{2}} é hoje às {{3}}, com {{4}}. Pode confirmar sua presença respondendo aqui? Se não puder vir, me avisa que remarcamos. 💛",
    paramNames: ["nome", "procedimento", "hora", "profissional"],
    examples: ["Mariana", "Limpeza de Pele", "14:00", "Dra. Paula"],
  },
  {
    purpose: "reminder_45min",
    name: "vx_lembrete_45min_v1",
    category: "UTILITY",
    bodyText:
      "Oi, {{1}}! Seu horário de {{2}} é daqui a pouco, às {{3}}. Já estamos te esperando aqui na {{4}}. Até já! 💛",
    paramNames: ["nome", "procedimento", "hora", "clinica"],
    examples: ["Mariana", "Limpeza de Pele", "14:00", "Clínica Bella"],
  },
  {
    purpose: "pre_care",
    name: "vx_pre_cuidados_v1",
    category: "UTILITY",
    bodyText:
      "Oi, {{1}}! Para o seu {{2}} de {{3}} às {{4}}, um cuidado importante antes: {{5}}. Qualquer dúvida, é só responder por aqui. 💛",
    paramNames: ["nome", "procedimento", "data", "hora", "cuidados"],
    examples: ["Mariana", "Peeling", "16/09/2026", "14:00", "evite ácidos na pele nas 48h anteriores"],
  },
  {
    purpose: "no_show_message",
    name: "vx_falta_v1",
    category: "UTILITY",
    bodyText:
      "Oi, {{1}}! Sentimos sua falta no horário de {{2}} ({{3}} às {{4}}). Aconteceu alguma coisa? Se quiser remarcar, é só responder aqui que eu vejo um horário para você. 💛",
    paramNames: ["nome", "procedimento", "data", "hora"],
    examples: ["Mariana", "Limpeza de Pele", "15/09/2026", "14:00"],
  },
  {
    purpose: "no_show_followup",
    name: "vx_falta_remarcar_v1",
    category: "MARKETING",
    bodyText:
      "Oi, {{1}}! Ainda dá tempo de remarcar o seu {{2}} aqui na {{3}}. Quer que eu veja um horário para você esta semana? É só responder. 💛",
    paramNames: ["nome", "procedimento", "clinica"],
    examples: ["Mariana", "Limpeza de Pele", "Clínica Bella"],
  },
  {
    purpose: "post_visit",
    name: "vx_pos_atendimento_v1",
    category: "UTILITY",
    bodyText:
      "Oi, {{1}}! Foi um prazer te receber hoje para o {{2}}. Cuidados para as próximas horas: {{3}}. Qualquer coisa, estamos por aqui. 💛",
    paramNames: ["nome", "procedimento", "cuidados"],
    examples: ["Mariana", "Limpeza de Pele", "evite sol e maquiagem nas próximas 24h"],
  },
  {
    purpose: "feedback_request",
    name: "vx_avaliacao_v1",
    category: "UTILITY",
    bodyText:
      "Oi, {{1}}! Como você está depois do {{2}}? De 0 a 10, como foi o seu atendimento na {{3}}? É só responder com a nota — sua opinião ajuda muito. 💛",
    paramNames: ["nome", "procedimento", "clinica"],
    examples: ["Mariana", "Limpeza de Pele", "Clínica Bella"],
  },
  {
    purpose: "touchup_offer",
    name: "vx_retoque_v1",
    category: "MARKETING",
    bodyText:
      "Oi, {{1}}! Já se passaram {{2}} dias do seu {{3}} e esta é a hora ideal do retoque. Quer que eu veja um horário para você aqui na {{4}}? É só responder. 💛",
    paramNames: ["nome", "dias", "procedimento", "clinica"],
    examples: ["Mariana", "15", "Botox", "Clínica Bella"],
  },
  {
    purpose: "post_sale_cadence",
    name: "vx_pos_venda_v1",
    category: "UTILITY",
    bodyText:
      "Oi, {{1}}! Passando para saber como estão os resultados do seu {{2}}. Se tiver qualquer dúvida sobre os cuidados, me conta por aqui que a equipe da {{3}} te orienta. 💛",
    paramNames: ["nome", "procedimento", "clinica"],
    examples: ["Mariana", "Limpeza de Pele", "Clínica Bella"],
  },
  {
    purpose: "birthday",
    name: "vx_aniversario_v1",
    category: "MARKETING",
    bodyText:
      "Parabéns, {{1}}! 🎉 Toda a equipe da {{2}} deseja um dia lindo para você. Temos um mimo de aniversário esperando aqui — é só responder para saber mais. 💛",
    paramNames: ["nome", "clinica"],
    examples: ["Mariana", "Clínica Bella"],
  },
  {
    purpose: "reactivation",
    name: "vx_reativacao_v1",
    category: "MARKETING",
    bodyText:
      "Oi, {{1}}! Sentimos sua falta aqui na {{2}}. Faz um tempinho desde o seu {{3}}. Quer que eu veja um horário para você voltar a se cuidar? É só responder. 💛",
    paramNames: ["nome", "clinica", "procedimento"],
    examples: ["Mariana", "Clínica Bella", "Limpeza de Pele"],
  },
  {
    purpose: "smart_fill",
    name: "vx_horario_livre_v1",
    category: "MARKETING",
    bodyText:
      "Oi, {{1}}! Abriu um horário aqui na {{2}} para {{3}}: {{4}}. Quer aproveitar? É só responder que eu já reservo para você. 💛",
    paramNames: ["nome", "clinica", "procedimento", "horario"],
    examples: ["Mariana", "Clínica Bella", "Limpeza de Pele", "quinta 18/09 às 15:00"],
  },
  {
    purpose: "package_renewal",
    name: "vx_renovacao_pacote_v1",
    category: "MARKETING",
    bodyText:
      "Oi, {{1}}! Seu pacote {{2}} está chegando ao fim (restam {{3}} sessões). Quer garantir a continuidade do seu {{4}} aqui na {{5}}? É só responder. 💛",
    paramNames: ["nome", "pacote", "sessoes", "procedimento", "clinica"],
    examples: ["Mariana", "Drenagem — 12 sessões", "1", "Drenagem Linfática", "Clínica Bella"],
  },
  {
    purpose: "consent_term",
    name: "vx_termo_v1",
    category: "UTILITY",
    bodyText:
      "Oi, {{1}}! Para deixar tudo certinho para o seu {{2}}, preparei o seu termo de consentimento. É rapidinho: toque no botão abaixo para abrir, revisar e assinar. 💛",
    paramNames: ["nome", "procedimento"],
    examples: ["Mariana", "Botox"],
    button: { text: "Abrir termo", pathPrefix: "/assinar/", param: "link_token", example: "abc123" },
  },
  {
    purpose: "consent_term_copy",
    name: "vx_termo_copia_v1",
    category: "UTILITY",
    bodyText:
      "Tudo certo, {{1}}! Sua cópia do termo assinado já está disponível. Toque no botão abaixo para abrir quando quiser. 💛",
    paramNames: ["nome"],
    examples: ["Mariana"],
    button: { text: "Ver termo", pathPrefix: "/assinar/", param: "link_token", example: "abc123" },
  },
  {
    purpose: "quote",
    name: "vx_orcamento_v1",
    category: "UTILITY",
    bodyText:
      "Oi, {{1}}! Seu orçamento aqui na {{2}} está pronto. Toque no botão abaixo para ver os detalhes e aprovar quando quiser. 💛",
    paramNames: ["nome", "clinica"],
    examples: ["Mariana", "Clínica Bella"],
    button: { text: "Ver orçamento", pathPrefix: "/orcamento/", param: "link_token", example: "abc123" },
  },
];

/** automation_id da mensagem → finalidade do template (variações compartilham o template). */
export function templatePurposeFor(automationId: string | null): string | null {
  if (!automationId) return null;
  if (automationId === "reactivation_smart" || automationId === "reactivation_generic") {
    return "reactivation";
  }
  if (automationId === "package_renewal_sessions" || automationId === "package_renewal_expiry") {
    return "package_renewal";
  }
  return META_TEMPLATE_CATALOG.some((t) => t.purpose === automationId) ? automationId : null;
}

/** Status da Meta (APPROVED, PENDING, REJECTED, PAUSED, DISABLED, IN_APPEAL...) → status local. */
export function metaStatusToLocal(
  status: string,
): "pending" | "approved" | "rejected" | "paused" | "disabled" | "error" {
  const s = status.toUpperCase();
  if (s === "APPROVED") return "approved";
  if (s === "REJECTED") return "rejected";
  if (s === "PAUSED") return "paused";
  if (s === "DISABLED") return "disabled";
  return "pending";
}

/** Spec pronta para POST /message_templates (URL do botão com o domínio do app). */
export function toMetaSpec(entry: TemplateCatalogEntry, appUrl: string): MetaTemplateSpec {
  return {
    name: entry.name,
    language: META_TEMPLATE_LANGUAGE,
    category: entry.category,
    bodyText: entry.bodyText,
    bodyExamples: entry.examples,
    buttonUrl: entry.button
      ? {
          text: entry.button.text,
          url: `${appUrl}${entry.button.pathPrefix}{{1}}`,
          example: `${appUrl}${entry.button.pathPrefix}${entry.button.example}`,
        }
      : undefined,
  };
}
