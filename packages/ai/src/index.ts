/**
 * @clinicaos/ai — cliente Anthropic, prompts, tools do agente e guardrails.
 *
 * Fase 1 (milestone 8): classificador de respostas a lembretes
 *   (confirmar/cancelar/remarcar/pergunta/outro) — Haiku 4.5.
 * Fase 2: agente conversacional completo (Sonnet 5) com tools de agenda.
 *
 * Regras duras (docs/design/00-plano-consolidado.md §7):
 *  - Nenhum valor/preço/desconto sai do modelo sem vir de tool determinística.
 *  - Assunto clínico/médico → escalar para humano, sempre.
 *  - Pergunta direta "é robô?" → escala sem afirmar nem negar.
 *  - Anamnese NUNCA entra em prompt.
 */
export const REPLY_INTENTS = [
  "confirm",
  "cancel",
  "reschedule",
  "question",
  "other",
] as const;

export type ReplyIntent = (typeof REPLY_INTENTS)[number];
