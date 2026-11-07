import { describe, expect, it } from "vitest";
import { matchProcedures, upcomingCalendar } from "./ai-agent";

describe("upcomingCalendar", () => {
  it("lista hoje, amanhã e os próximos dias com a data pronta para copiar", () => {
    const cal = upcomingCalendar("2026-11-07").split("; ");
    expect(cal).toHaveLength(14);
    expect(cal[0]).toBe("hoje sáb 07/11 = 2026-11-07");
    expect(cal[1]).toBe("amanhã dom 08/11 = 2026-11-08");
    expect(cal[5]).toBe("qui 12/11 = 2026-11-12");
    expect(cal[13]).toBe("sex 20/11 = 2026-11-20");
  });

  it("vira o mês e o ano sem erro", () => {
    const cal = upcomingCalendar("2026-12-30", 4).split("; ");
    expect(cal).toEqual([
      "hoje qua 30/12 = 2026-12-30",
      "amanhã qui 31/12 = 2026-12-31",
      "sex 01/01 = 2027-01-01",
      "sáb 02/01 = 2027-01-02",
    ]);
  });
});

describe("matchProcedures (nome do serviço que a atendente pediu)", () => {
  const catalogo = [
    { id: "r", name: "Consulta de retorno", price: "0", durationMinutes: 30 },
    { id: "c", name: "Consulta", price: "0", durationMinutes: 60 },
    { id: "l", name: "Limpeza de Pele", price: "180", durationMinutes: 60 },
    { id: "p", name: "Peeling Químico", price: "250", durationMinutes: 30 },
  ];
  const ids = (r: ReturnType<typeof matchProcedures>) => (typeof r === "string" ? r : r.map((p) => p.id));

  it("nome exato vence, mesmo com o parecido antes no catálogo", () => {
    expect(ids(matchProcedures(catalogo, ["Consulta"]))).toEqual(["c"]);
    expect(ids(matchProcedures(catalogo, ["consulta de retorno"]))).toEqual(["r"]);
  });

  it("sem acento, maiúsculas e pedaço do nome", () => {
    expect(ids(matchProcedures(catalogo, ["peeling quimico"]))).toEqual(["p"]);
    expect(ids(matchProcedures(catalogo, ["limpeza"]))).toEqual(["l"]);
  });

  it("'A + B' numa string só vira os dois serviços (uma visita)", () => {
    expect(ids(matchProcedures(catalogo, ["Limpeza de Pele + Peeling Químico"]))).toEqual(["l", "p"]);
  });

  it("nome desconhecido devolve a mensagem com as opções", () => {
    expect(matchProcedures(catalogo, ["Botox"])).toMatch(/não encontrado/);
  });
});
