/**
 * Conversões entre horário de parede da clínica (ex.: America/Sao_Paulo)
 * e instantes UTC — sem dependências externas.
 */

/** Offset (ms) do fuso em relação ao UTC num dado instante (SP ≈ -3h → -10800000). */
export function tzOffsetMs(instant: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(
    dtf.formatToParts(instant).map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  const wallAsUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour === "24" ? "0" : parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return wallAsUtc - instant.getTime();
}

/** "2026-08-20" + "14:30" no fuso da clínica → instante UTC. */
export function zonedToUtc(dateISO: string, timeHHMM: string, timeZone: string): Date {
  const [y, m, d] = dateISO.split("-").map(Number);
  const [hh, mm] = timeHHMM.split(":").map(Number);
  if (!y || !m || !d || hh === undefined || mm === undefined) {
    throw new Error(`Data/hora inválida: ${dateISO} ${timeHHMM}`);
  }
  // Duas passadas cobrem transições de DST
  let utc = Date.UTC(y, m - 1, d, hh, mm);
  for (let i = 0; i < 2; i++) {
    utc = Date.UTC(y, m - 1, d, hh, mm) - tzOffsetMs(new Date(utc), timeZone);
  }
  return new Date(utc);
}

/** Instante UTC → componentes de parede no fuso da clínica. */
export function utcToZoned(
  instant: Date,
  timeZone: string,
): { dateISO: string; timeHHMM: string; minutesOfDay: number; weekday: number } {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hour12: false,
  });
  const parts = Object.fromEntries(
    dtf.formatToParts(instant).map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  const hour = parts.hour === "24" ? "00" : parts.hour!;
  const weekdayMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  return {
    dateISO: `${parts.year}-${parts.month}-${parts.day}`,
    timeHHMM: `${hour}:${parts.minute}`,
    minutesOfDay: Number(hour) * 60 + Number(parts.minute),
    weekday: weekdayMap[parts.weekday!] ?? 0,
  };
}

/** Data ISO de "hoje" no fuso da clínica. */
export function todayISO(timeZone: string, now: Date = new Date()): string {
  return utcToZoned(now, timeZone).dateISO;
}

/** Soma dias a uma data ISO (aritmética de calendário, sem fuso). */
export function addDaysISO(dateISO: string, days: number): string {
  const [y, m, d] = dateISO.split("-").map(Number);
  const date = new Date(Date.UTC(y!, m! - 1, d! + days, 12));
  return date.toISOString().slice(0, 10);
}
