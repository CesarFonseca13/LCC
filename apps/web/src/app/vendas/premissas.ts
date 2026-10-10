/**
 * Constantes da página de vendas. Ficam no código (e não no .env) porque a
 * página é pré-renderizada no build do Docker, que roda sem .env.
 * Sem "use client": são usadas tanto no server component quanto na calculadora.
 */

export const SALES = {
  /** Número que recebe os botões (só dígitos, com DDI). */
  whatsapp: "5561996862249",
  whatsappDisplay: "+55 61 99686-2249",
  /** Mensagem já preenchida ao tocar no botão. */
  whatsappText: "Oi! Vi a página da VesaliusX e quero a Ana atendendo o WhatsApp da minha clínica.",
  /** Vídeo de vendas (URL de embed do YouTube/Vimeo). Vazio = sem vídeo. */
  vslUrl: "",
};

export const CTA_URL = `https://wa.me/${SALES.whatsapp}?text=${encodeURIComponent(SALES.whatsappText)}`;

// ── Premissas das estimativas (aparecem em nota na página) ───────────
/** Faltas em agenda sem confirmação. */
export const FALTA_SEM = 0.12;
/** Faltas com lembrete de véspera e remarcação pelo WhatsApp (conservador: corta pela metade). */
export const FALTA_COM = 0.06;
/** IA por atendimento: a conversa de marcar + a resposta ao lembrete. */
export const IA_POR_ATENDIMENTO = 0.15;
/** Meta: lembrete de véspera (modelo de utilidade). */
export const META_LEMBRETE = 0.04;
/** Meta: mensagem de reativação (modelo de marketing). */
export const META_REATIVACAO = 0.35;
/** Parte dos atendimentos que gera uma reativação no mês. */
export const PARTE_REATIVADA = 0.1;
/** Custo estimado de IA + Meta por atendimento. */
export const CUSTO_POR_ATENDIMENTO = IA_POR_ATENDIMENTO + META_LEMBRETE + PARTE_REATIVADA * META_REATIVACAO;
/** Valor médio de atendimento usado nas contas fixas da página. */
export const TICKET_REF = 250;

export const fmt2 = (n: number) => n.toFixed(2).replace(".", ",");
