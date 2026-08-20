/** Colunas fixas do funil v1 — a primeira é o "pouso" dos leads automáticos. */
export const FUNNEL_STAGES = [
  "Novo contato",
  "Conversando",
  "Proposta enviada",
  "Agendou avaliação",
] as const;

export type FunnelStage = (typeof FUNNEL_STAGES)[number];
