import { describe, expect, it } from "vitest";
import {
  clinicServesPeriod,
  computeFreeSlots,
  isRealDateISO,
  openRangesOn,
  rangeHasStart,
  rangeTouchesPeriod,
} from "./slots";

// 09/11/2026 é segunda-feira. São Paulo = UTC-3 (sem horário de verão).
const TZ = "America/Sao_Paulo";
const HOURS: Record<string, [string, string][]> = {
  mon: [["08:00", "12:00"], ["13:00", "18:00"]],
  tue: [["08:00", "12:00"], ["13:00", "18:00"]],
  wed: [["08:00", "12:00"], ["13:00", "18:00"]],
  thu: [["08:00", "12:00"], ["13:00", "18:00"]],
  fri: [["08:00", "12:00"], ["13:00", "18:00"]],
  sat: [["08:00", "12:00"]],
};
const DR = { id: "p1", name: "Dr. Rehnan" };
const SEG_7H = Date.parse("2026-11-09T10:00:00Z"); // segunda 07:00 em SP

function run(over: Partial<Parameters<typeof computeFreeSlots>[0]> = {}) {
  return computeFreeSlots({
    hours: HOURS,
    professionals: [DR],
    appointments: [],
    blocks: [],
    tz: TZ,
    durationMinutes: 30,
    limit: 100,
    startDate: "2026-11-09",
    days: 1,
    now: SEG_7H,
    ...over,
  });
}

describe("computeFreeSlots", () => {
  it("dia inteiro: respeita antecedência de 1h30, almoço e fechamento", () => {
    const slots = run();
    expect(slots[0]?.timeHHMM).toBe("08:30"); // 07:00 + 1h30
    expect(slots.map((s) => s.timeHHMM)).not.toContain("12:00");
    expect(slots.map((s) => s.timeHHMM)).not.toContain("12:30");
    expect(slots.at(-1)?.timeHHMM).toBe("17:30");
    expect(slots).toHaveLength(7 + 10);
    expect(slots[0]?.label).toBe("seg 09/11 às 08:30 com Dr. Rehnan");
    expect(slots[0]?.dateISO).toBe("2026-11-09");
    expect(slots[0]?.slotId).toBe("p1|2026-11-09T11:30:00.000Z");
  });

  it("turno: manhã antes das 12h, tarde das 12h às 18h, noite a partir das 18h", () => {
    const manha = run({ period: "manha" }).map((s) => s.timeHHMM);
    expect(manha).toEqual(["08:30", "09:00", "09:30", "10:00", "10:30", "11:00", "11:30"]);
    const tarde = run({ period: "tarde" }).map((s) => s.timeHHMM);
    expect(tarde[0]).toBe("13:00");
    expect(tarde.at(-1)).toBe("17:30");
    expect(tarde).toHaveLength(10);
    expect(run({ period: "noite" })).toEqual([]);
  });

  it("duração de 60 min: último horário cabe antes do almoço e do fechamento", () => {
    const horas = run({ durationMinutes: 60 }).map((s) => s.timeHHMM);
    expect(horas).toContain("11:00");
    expect(horas).not.toContain("11:30");
    expect(horas.at(-1)).toBe("17:00");
  });

  it("um por dia ao longo da semana (domingo fechado)", () => {
    const slots = run({ days: 7, perDay: 1 });
    expect(slots.map((s) => s.dateISO)).toEqual([
      "2026-11-09",
      "2026-11-10",
      "2026-11-11",
      "2026-11-12",
      "2026-11-13",
      "2026-11-14",
    ]);
    expect(slots.map((s) => s.timeHHMM)).toEqual(["08:30", "08:00", "08:00", "08:00", "08:00", "08:00"]);
  });

  it("dia pedido no futuro: começa nele, sem olhar os dias anteriores", () => {
    const slots = run({ startDate: "2026-11-12", period: "tarde" });
    expect(slots.every((s) => s.dateISO === "2026-11-12")).toBe(true);
    expect(slots[0]?.timeHHMM).toBe("13:00");
  });

  it("bloqueio da clínica toda (feriado) tira o dia inteiro", () => {
    const feriado = {
      professionalId: null,
      startsAt: new Date("2026-11-10T03:00:00Z"), // 10/11 00:00 SP
      endsAt: new Date("2026-11-11T03:00:00Z"),
    };
    const slots = run({ days: 7, perDay: 1, blocks: [feriado] });
    expect(slots.map((s) => s.dateISO)).not.toContain("2026-11-10");
    expect(slots).toHaveLength(5);
  });

  it("agendamento ocupa a profissional; outra profissional livre assume o horário", () => {
    const ocupado = {
      professionalId: "p1",
      startsAt: new Date("2026-11-09T11:30:00Z"), // 08:30 SP
      endsAt: new Date("2026-11-09T12:30:00Z"), // 09:30 SP
    };
    const so1 = run({ appointments: [ocupado] });
    expect(so1[0]?.timeHHMM).toBe("09:30");

    const dupla = run({ appointments: [ocupado], professionals: [DR, { id: "p2", name: "Dra. Ana" }] });
    expect(dupla[0]?.timeHHMM).toBe("08:30");
    expect(dupla[0]?.professionalName).toBe("Dra. Ana");
    // Um horário = uma oferta (primeira profissional livre), nunca duplicado
    expect(new Set(dupla.map((s) => s.timeHHMM)).size).toBe(dupla.length);
  });

  it("limite total corta a busca", () => {
    expect(run({ days: 7, limit: 3 })).toHaveLength(3);
  });
});

describe("horário de atendimento por dia e turno", () => {
  it("faixas do dia pela data (domingo fechado, sábado só de manhã)", () => {
    expect(openRangesOn(HOURS, "2026-11-09")).toHaveLength(2); // segunda
    expect(openRangesOn(HOURS, "2026-11-14")).toEqual([["08:00", "12:00"]]); // sábado
    expect(openRangesOn(HOURS, "2026-11-15")).toEqual([]); // domingo
  });

  it("faixa x turno: 08–12 é só manhã; 13–18 é só tarde; 18–20 é noite", () => {
    expect(rangeTouchesPeriod(["08:00", "12:00"], "manha")).toBe(true);
    expect(rangeTouchesPeriod(["08:00", "12:00"], "tarde")).toBe(false);
    expect(rangeTouchesPeriod(["13:00", "18:00"], "tarde")).toBe(true);
    expect(rangeTouchesPeriod(["13:00", "18:00"], "noite")).toBe(false);
    expect(rangeTouchesPeriod(["13:00", "20:00"], "noite")).toBe(true);
    expect(rangeTouchesPeriod(["11:00", "14:00"], "manha")).toBe(true);
    expect(rangeTouchesPeriod(["11:00", "14:00"], "tarde")).toBe(true);
  });

  it("clínica que fecha às 18h não atende à noite", () => {
    expect(clinicServesPeriod(HOURS, "manha")).toBe(true);
    expect(clinicServesPeriod(HOURS, "tarde")).toBe(true);
    expect(clinicServesPeriod(HOURS, "noite")).toBe(false);
    expect(clinicServesPeriod({ ...HOURS, thu: [["13:00", "21:00"]] }, "noite")).toBe(true);
  });

  it("início possível considera a duração: 08:00–12:30 não tem tarde para 60 min", () => {
    expect(rangeHasStart(["08:00", "12:30"], "tarde", 30)).toBe(true); // 12:00
    expect(rangeHasStart(["08:00", "12:30"], "tarde", 60)).toBe(false); // 12:00 + 60 > 12:30
    expect(rangeHasStart(["08:00", "18:30"], "noite", 30)).toBe(true); // 18:00
    expect(rangeHasStart(["08:00", "18:30"], "noite", 60)).toBe(false);
    expect(rangeHasStart(["08:00", "09:00"], null, 90)).toBe(false); // faixa curta demais
    expect(clinicServesPeriod({ mon: [["08:00", "18:30"]] }, "noite", 60)).toBe(false);
  });

  it("a partir de um minuto do dia (hoje, com antecedência de 1h30)", () => {
    expect(rangeHasStart(["08:00", "12:30"], null, 30, 13 * 60)).toBe(false); // já passou
    expect(rangeHasStart(["08:00", "12:30"], null, 30, 11 * 60 + 40)).toBe(true); // 12:00 ainda dá
    expect(rangeHasStart(["13:00", "18:00"], "tarde", 30, Number.POSITIVE_INFINITY)).toBe(false);
  });
});

describe("isRealDateISO", () => {
  it("aceita só datas que existem", () => {
    expect(isRealDateISO("2026-11-09")).toBe(true);
    expect(isRealDateISO("2028-02-29")).toBe(true);
    expect(isRealDateISO("2026-02-29")).toBe(false);
    expect(isRealDateISO("2026-02-30")).toBe(false);
    expect(isRealDateISO("2026-13-01")).toBe(false);
    expect(isRealDateISO("2026-1-01")).toBe(false);
    expect(isRealDateISO("amanhã")).toBe(false);
  });
});
