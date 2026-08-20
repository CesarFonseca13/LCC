/**
 * @clinicaos/whatsapp — cliente da Evolution API + normalização de webhooks.
 * Implementação entra no milestone WhatsApp (Fase 1, item 5).
 * Contrato desenhado em docs/design/02-automacoes-whatsapp-ia.md §1.
 */
export const EVOLUTION_WEBHOOK_EVENTS = [
  "QRCODE_UPDATED",
  "CONNECTION_UPDATE",
  "MESSAGES_UPSERT",
  "MESSAGES_UPDATE",
  "SEND_MESSAGE",
] as const;

export type EvolutionWebhookEvent = (typeof EVOLUTION_WEBHOOK_EVENTS)[number];
