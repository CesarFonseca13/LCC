import "server-only";
import { headers } from "next/headers";

/**
 * Robô de prévia de link (WhatsApp, Telegram, etc.)? O próprio envio do link
 * dispara um GET desses — marcar "Visualizado" nele mentiria para a equipe.
 * Só a abertura num navegador de verdade conta.
 */
export async function isLinkPreviewBot(): Promise<boolean> {
  const ua = ((await headers()).get("user-agent") ?? "").toLowerCase();
  if (!ua) return true;
  return /whatsapp|facebookexternalhit|telegrambot|twitterbot|linkedinbot|slackbot|discordbot|skypeuripreview|crawler|spider|preview|\bbot\b/.test(
    ua,
  );
}
