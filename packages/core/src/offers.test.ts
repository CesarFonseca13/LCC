import { describe, expect, it } from "vitest";
import { findMentionedProcedures, suggestOffers, type OfferProcedure } from "./offers";

const proc = (over: Partial<OfferProcedure> & { id: string; name: string }): OfferProcedure => ({
  price: 100,
  active: true,
  returnDays: null,
  offerNote: null,
  promoText: null,
  promoUntil: null,
  ...over,
});

const limpeza = proc({ id: "limpeza", name: "Limpeza de Pele", returnDays: 30 });
const peeling = proc({ id: "peeling", name: "Peeling Leve", offerNote: "Potencializa o resultado da limpeza." });
const botox = proc({ id: "botox", name: "Botox", returnDays: 120 });
const lipo = proc({ id: "lipo", name: "Lipo de Papada" });
const catalog = [limpeza, peeling, botox, lipo];

describe("suggestOffers — só o que a clínica autorizou", () => {
  it("sugere apenas o que está marcado como 'combina com' o pedido", () => {
    const s = suggestOffers({
      askedIds: ["limpeza"],
      upcomingIds: [],
      history: [],
      catalog,
      pairings: [{ procedureId: "limpeza", relatedId: "peeling" }],
      today: "2026-10-09",
      customerFirstName: "Maria",
    });
    expect(s.map((x) => x.procedure.id)).toEqual(["peeling"]);
    expect(s[0]!.message).toContain("Maria, ");
    expect(s[0]!.message).toContain("Potencializa");
  });

  it("nunca sugere serviço sem vínculo, mesmo com catálogo cheio", () => {
    const s = suggestOffers({
      askedIds: ["limpeza"],
      upcomingIds: [],
      history: [],
      catalog,
      pairings: [],
      today: "2026-10-09",
      customerFirstName: null,
    });
    expect(s).toEqual([]);
  });

  it("o vínculo é direcional: botox → lipo não vale para lipo → botox", () => {
    const pairings = [{ procedureId: "botox", relatedId: "lipo" }];
    expect(suggestOffers({ askedIds: ["lipo"], upcomingIds: [], history: [], catalog, pairings, today: "2026-10-09", customerFirstName: null })).toEqual([]);
    expect(suggestOffers({ askedIds: ["botox"], upcomingIds: [], history: [], catalog, pairings, today: "2026-10-09", customerFirstName: null }).map((x) => x.procedure.id)).toEqual(["lipo"]);
  });

  it("não repete o que ela pediu, o que já está marcado, nem inativo", () => {
    const s = suggestOffers({
      askedIds: ["limpeza"],
      upcomingIds: ["peeling"],
      history: [],
      catalog: [limpeza, peeling, { ...botox, active: false }],
      pairings: [
        { procedureId: "limpeza", relatedId: "peeling" },
        { procedureId: "limpeza", relatedId: "botox" },
        { procedureId: "limpeza", relatedId: "limpeza" },
      ],
      today: "2026-10-09",
      customerFirstName: null,
    });
    expect(s).toEqual([]);
  });

  it("retorno vencido vem do histórico dela, e não oferece o que fez há pouco", () => {
    const vencido = suggestOffers({
      askedIds: [],
      upcomingIds: [],
      history: [{ procedureId: "botox", lastOn: "2026-05-01" }],
      catalog,
      pairings: [],
      today: "2026-10-09",
      customerFirstName: "Ana",
    });
    expect(vencido.map((x) => x.reason)).toEqual(["retorno"]);
    expect(vencido[0]!.why).toContain("01/05/2026");

    const recente = suggestOffers({
      askedIds: ["limpeza"],
      upcomingIds: [],
      history: [{ procedureId: "botox", lastOn: "2026-09-20" }],
      catalog,
      pairings: [{ procedureId: "limpeza", relatedId: "botox" }],
      today: "2026-10-09",
      customerFirstName: null,
    });
    expect(recente).toEqual([]);
  });

  it("promoção só vale até a data, e aparece no texto", () => {
    const promoPeeling = { ...peeling, promoText: "2ª sessão com 20% off", promoUntil: "2026-10-31" };
    const s = suggestOffers({
      askedIds: ["limpeza"],
      upcomingIds: [],
      history: [],
      catalog: [limpeza, promoPeeling],
      pairings: [{ procedureId: "limpeza", relatedId: "peeling" }],
      today: "2026-10-09",
      customerFirstName: null,
    });
    expect(s[0]!.reason).toBe("promocao");
    expect(s[0]!.message).toContain("31/10/2026");
    const vencida = suggestOffers({
      askedIds: ["limpeza"],
      upcomingIds: [],
      history: [],
      catalog: [limpeza, promoPeeling],
      pairings: [{ procedureId: "limpeza", relatedId: "peeling" }],
      today: "2026-11-02",
      customerFirstName: null,
    });
    expect(vencida[0]!.reason).toBe("combina");
    expect(vencida[0]!.message).not.toContain("20% off");
  });

  it("limita a 3 e prioriza combinações", () => {
    const many = Array.from({ length: 5 }, (_, i) => proc({ id: `p${i}`, name: `Serviço ${i}` }));
    const s = suggestOffers({
      askedIds: ["limpeza"],
      upcomingIds: [],
      history: [{ procedureId: "botox", lastOn: "2026-01-01" }],
      catalog: [limpeza, botox, ...many],
      pairings: many.map((m) => ({ procedureId: "limpeza", relatedId: m.id })),
      today: "2026-10-09",
      customerFirstName: null,
    });
    expect(s).toHaveLength(3);
    expect(s.every((x) => x.reason === "combina")).toBe(true);
  });
});

describe("findMentionedProcedures", () => {
  it("casa o nome inteiro, ignorando acento e caixa, e não casa palavra solta", () => {
    expect(findMentionedProcedures("Oi! Queria marcar uma LIMPEZA DE PELE pra sexta", catalog)).toEqual(["limpeza"]);
    expect(findMentionedProcedures("quero fazer limpeza", catalog)).toEqual([]);
    expect(findMentionedProcedures("botox e peeling leve", catalog)).toEqual(["peeling", "botox"]);
  });
});
