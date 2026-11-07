/**
 * Alerta do navegador fora da página ("Conversa esperando você").
 * Só no computador: no Chrome do Android o objeto Notification existe, mas
 * `new Notification()` lança erro (lá só via service worker) — e no celular a
 * aba em segundo plano congela. No celular, o aviso é o próprio WhatsApp.
 */

const BROKEN_KEY = "vx-alerts-broken";
export const ALERTS_BROKEN_EVENT = "vx-alerts-broken";

export function desktopAlertsSupported(): boolean {
  if (typeof window === "undefined" || typeof Notification === "undefined") return false;
  const ua = navigator.userAgent;
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(ua)) return false;
  // Tablet que pede "site para computador": Android vira "X11; Linux", iPad vira
  // "Macintosh" — com toque como entrada PRINCIPAL (PC com tela touch e mouse continua)
  const touch = typeof navigator.maxTouchPoints === "number" ? navigator.maxTouchPoints : 0;
  const touchFirst = window.matchMedia?.("(hover: none) and (pointer: coarse)").matches ?? false;
  if (/Linux/.test(ua) && !/CrOS/.test(ua) && touch > 0 && touchFirst) return false;
  if (/Macintosh/.test(ua) && touch > 1) return false;
  try {
    if (window.localStorage.getItem(BROKEN_KEY) === "1") return false;
  } catch {
    // armazenamento bloqueado: segue pelo teste do aparelho
  }
  return true;
}

/** O construtor falhou neste aparelho: lembra disso e avisa o botão de alertas. */
export function markDesktopAlertsBroken(): void {
  try {
    window.localStorage.setItem(BROKEN_KEY, "1");
  } catch {
    // sem armazenamento: o evento abaixo ainda corrige a tela aberta
  }
  window.dispatchEvent(new Event(ALERTS_BROKEN_EVENT));
}
