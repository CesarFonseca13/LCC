import { describe, expect, it } from "vitest";
import { addDaysISO, todayISO, utcToZoned, zonedToUtc } from "./timezone";

const SP = "America/Sao_Paulo";

describe("timezone (America/Sao_Paulo = UTC-3)", () => {
  it("converte parede → UTC", () => {
    expect(zonedToUtc("2026-08-20", "14:30", SP).toISOString()).toBe(
      "2026-08-20T17:30:00.000Z",
    );
    expect(zonedToUtc("2026-08-20", "00:00", SP).toISOString()).toBe(
      "2026-08-20T03:00:00.000Z",
    );
  });

  it("converte UTC → parede (roundtrip)", () => {
    const utc = zonedToUtc("2026-08-20", "08:15", SP);
    const zoned = utcToZoned(utc, SP);
    expect(zoned.dateISO).toBe("2026-08-20");
    expect(zoned.timeHHMM).toBe("08:15");
    expect(zoned.minutesOfDay).toBe(8 * 60 + 15);
    expect(zoned.weekday).toBe(4); // quinta-feira
  });

  it("virada de dia entre fusos", () => {
    // 23h30 em SP = 02h30 UTC do dia seguinte
    const utc = zonedToUtc("2026-08-20", "23:30", SP);
    expect(utc.toISOString()).toBe("2026-08-21T02:30:00.000Z");
    expect(utcToZoned(utc, SP).dateISO).toBe("2026-08-20");
  });

  it("todayISO e addDaysISO", () => {
    const now = new Date("2026-08-21T01:00:00Z"); // ainda dia 20 em SP
    expect(todayISO(SP, now)).toBe("2026-08-20");
    expect(addDaysISO("2026-08-31", 1)).toBe("2026-09-01");
    expect(addDaysISO("2026-01-01", -1)).toBe("2025-12-31");
  });
});
