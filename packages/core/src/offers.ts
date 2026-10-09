/**
 * Sugestões de oferta para a atendente — venda complementar SEGURA.
 *
 * Regra número um: o sistema só sugere o que a clínica autorizou explicitamente
 * ("combina com" no cadastro do serviço) ou o que a própria cliente já fez
 * (retorno vencido). Nunca infere necessidade estética por categoria, nome,
 * idade ou qualquer característica da pessoa — oferecer o serviço errado
 * ofende. Nada de modelo de IA aqui: é determinístico e auditável.
 */

export interface OfferProcedure {
  id: string;
  name: string;
  price: number;
  active: boolean;
  /** Dias até o retorno recomendado (motor da reativação). */
  returnDays: number | null;
  /** Como a clínica quer que seja oferecido. */
  offerNote: string | null;
  promoText: string | null;
  /** "YYYY-MM-DD" ou null. */
  promoUntil: string | null;
}

export interface OfferPairing {
  procedureId: string;
  relatedId: string;
}

export interface OfferHistoryItem {
  procedureId: string;
  /** "YYYY-MM-DD" do último atendimento desse serviço. */
  lastOn: string;
}

export interface OfferContext {
  /** Serviços que a cliente pediu/tem marcado nesta conversa. */
  askedIds: string[];
  /** Serviços já marcados para o futuro (não oferecer de novo). */
  upcomingIds: string[];
  history: OfferHistoryItem[];
  catalog: OfferProcedure[];
  pairings: OfferPairing[];
  /** "YYYY-MM-DD" de hoje no fuso da clínica. */
  today: string;
  customerFirstName: string | null;
  max?: number;
}

export type OfferReason = "combina" | "retorno" | "promocao";

export interface OfferSuggestion {
  procedure: OfferProcedure;
  reason: OfferReason;
  /** Por que apareceu — para a atendente entender antes de mandar. */
  why: string;
  /** Frase pronta para colar na conversa (a atendente pode editar). */
  message: string;
}

const REASON_PRIORITY: Record<OfferReason, number> = { combina: 0, promocao: 1, retorno: 2 };

export function suggestOffers(ctx: OfferContext): OfferSuggestion[] {
  const max = ctx.max ?? 3;
  const byId = new Map(ctx.catalog.map((p) => [p.id, p]));
  const asked = new Set(ctx.askedIds);
  const upcoming = new Set(ctx.upcomingIds);
  const lastOnById = new Map<string, string>();
  for (const h of ctx.history) {
    const prev = lastOnById.get(h.procedureId);
    if (!prev || h.lastOn > prev) lastOnById.set(h.procedureId, h.lastOn);
  }

  const out: OfferSuggestion[] = [];
  const seen = new Set<string>();
  const push = (s: OfferSuggestion) => {
    if (seen.has(s.procedure.id)) return;
    seen.add(s.procedure.id);
    out.push(s);
  };
  const eligible = (p: OfferProcedure | undefined): p is OfferProcedure =>
    Boolean(p && p.active && !asked.has(p.id) && !upcoming.has(p.id) && !doneRecently(p, lastOnById.get(p.id), ctx.today));

  // 1) O que a clínica marcou como "combina com" o que foi pedido
  for (const askedId of ctx.askedIds) {
    const askedProc = byId.get(askedId);
    for (const pair of ctx.pairings) {
      if (pair.procedureId !== askedId) continue;
      const rel = byId.get(pair.relatedId);
      if (!eligible(rel)) continue;
      const promo = activePromo(rel, ctx.today);
      push({
        procedure: rel,
        reason: promo ? "promocao" : "combina",
        why: promo
          ? `Combina com ${askedProc?.name ?? "o que ela pediu"} e está em promoção até ${brDate(rel.promoUntil)}`
          : `A clínica marcou que combina com ${askedProc?.name ?? "o que ela pediu"}`,
        message: composeMessage(rel, ctx.customerFirstName, promo, askedProc?.name ?? null, "combina"),
      });
    }
  }

  // 2) Promoção vigente no próprio serviço pedido (ela já quer; só avisa)
  for (const askedId of ctx.askedIds) {
    const p = byId.get(askedId);
    if (!p || !p.active) continue;
    const promo = activePromo(p, ctx.today);
    if (!promo || seen.has(p.id)) continue;
    push({
      procedure: p,
      reason: "promocao",
      why: `Ela pediu este serviço e ele está em promoção até ${brDate(p.promoUntil)}`,
      message: `${greet(ctx.customerFirstName)}boa notícia: ${p.name} está com condição especial até ${brDate(p.promoUntil)}: ${promo} 😊`,
    });
  }

  // 3) Retorno vencido de algo que ELA já fez (histórico próprio, nunca suposição)
  for (const [procId, lastOn] of lastOnById) {
    const p = byId.get(procId);
    if (!eligible(p) || !p.returnDays) continue;
    const due = addDays(lastOn, p.returnDays);
    if (due > ctx.today) continue;
    const promo = activePromo(p, ctx.today);
    push({
      procedure: p,
      reason: "retorno",
      why: `Ela fez ${p.name} em ${brDate(lastOn)} e o retorno recomendado (${p.returnDays} dias) já passou`,
      message: composeMessage(p, ctx.customerFirstName, promo, null, "retorno"),
    });
  }

  return out
    .sort((a, b) => REASON_PRIORITY[a.reason] - REASON_PRIORITY[b.reason])
    .slice(0, max);
}

/** Não oferecer o que ela fez há pouco (metade do prazo de retorno, ou 30 dias se não houver). */
function doneRecently(p: OfferProcedure, lastOn: string | undefined, today: string): boolean {
  if (!lastOn) return false;
  const windowDays = p.returnDays ? Math.max(7, Math.floor(p.returnDays / 2)) : 30;
  return addDays(lastOn, windowDays) > today;
}

export function activePromo(p: OfferProcedure, today: string): string | null {
  if (!p.promoText?.trim()) return null;
  if (p.promoUntil && p.promoUntil < today) return null;
  return p.promoText.trim();
}

function composeMessage(
  p: OfferProcedure,
  firstName: string | null,
  promo: string | null,
  askedName: string | null,
  reason: "combina" | "retorno",
): string {
  const g = greet(firstName);
  const note = p.offerNote?.trim();
  if (reason === "retorno") {
    const base = note
      ? `${g}já faz um tempinho desde a sua ${p.name}. ${note}`
      : `${g}já faz um tempinho desde a sua ${p.name}. Se quiser, posso ver um horário para a manutenção.`;
    return promo ? `${base} E até ${brDate(p.promoUntil)} está assim: ${promo} 😊` : base;
  }
  const lead = askedName
    ? `${g}se quiser aproveitar o mesmo dia da ${askedName}, dá para combinar com ${p.name}.`
    : `${g}se quiser, dá para combinar com ${p.name}.`;
  const body = note ? `${lead} ${note}` : `${lead} Quer que eu te explique como funciona?`;
  return promo ? `${body} Até ${brDate(p.promoUntil)} está assim: ${promo} 😊` : body;
}

function greet(firstName: string | null): string {
  return firstName ? `${firstName}, ` : "";
}

export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y!, m! - 1, d! + days));
  return t.toISOString().slice(0, 10);
}

export function brDate(iso: string | null): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

/** Normaliza para casar nomes de serviço em texto livre (sem acento, minúsculo). */
export function normalizeForMatch(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Quais serviços do catálogo aparecem no texto (nome completo, não palavra
 * solta — "limpeza" sozinho não vira "Limpeza de Pele"; precisa do nome).
 */
export function findMentionedProcedures(text: string, catalog: { id: string; name: string }[]): string[] {
  const t = ` ${normalizeForMatch(text)} `;
  const found: string[] = [];
  for (const p of catalog) {
    const n = normalizeForMatch(p.name);
    if (n.length < 4) continue;
    if (t.includes(` ${n} `) || t.includes(` ${n}`)) found.push(p.id);
  }
  return found;
}
