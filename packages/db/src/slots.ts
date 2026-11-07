import { and, eq, gt, inArray, lte, ne } from "drizzle-orm";
import { addDaysISO, todayISO, utcToZoned, zonedToUtc } from "@clinicaos/core/timezone";
import type { Db, Tx } from "./client";
import * as schema from "./schema";

/**
 * Busca de horários REALMENTE livres: horário da clínica + agenda + bloqueios.
 * Usada pela IA conversacional e pela página pública de agendamento —
 * uma única fonte de verdade de disponibilidade.
 */

export interface FreeSlot {
  slotId: string; // `${professionalId}|${startISO}`
  label: string; // "sex 22/08 às 14:00 com Dra. Paula"
  dateISO: string;
  timeHHMM: string;
  professionalName: string;
}

export function parseSlotId(
  slotId: string,
): { professionalId: string; startISO: string } | null {
  const [professionalId, startISO] = slotId.split("|");
  if (!professionalId || !startISO || Number.isNaN(Date.parse(startISO))) return null;
  return { professionalId, startISO };
}

const WEEKDAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
const WEEKDAYS_BR = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

/** Até quantos dias à frente uma busca com data pode olhar. */
export const MAX_SLOT_SEARCH_DAYS = 60;

export type SlotPeriod = "manha" | "tarde" | "noite";

export interface SlotSearchOptions {
  /** Começa a procurar neste dia (AAAA-MM-DD, no fuso da clínica). Padrão: hoje. */
  fromDate?: string;
  /** Só esse dia (true) ou a partir dele (padrão). */
  onlyThatDay?: boolean;
  /** Turno: manhã (antes das 12h), tarde (12h às 18h), noite (a partir das 18h). */
  period?: SlotPeriod | null;
  /** Quantos dias olhar a partir do início (padrão 8; máximo MAX_SLOT_SEARCH_DAYS). */
  days?: number;
  /** No máximo N horários por dia: espalha a oferta por vários dias. */
  perDay?: number;
}

/** AAAA-MM-DD que existe no calendário (rejeita 2026-02-30, que o Date "corrige" para março). */
export function isRealDateISO(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function inPeriod(minuteOfDay: number, period: SlotPeriod | null | undefined): boolean {
  if (!period) return true;
  if (period === "manha") return minuteOfDay < 12 * 60;
  if (period === "tarde") return minuteOfDay >= 12 * 60 && minuteOfDay < 18 * 60;
  return minuteOfDay >= 18 * 60;
}

const PERIOD_BOUNDS: Record<SlotPeriod, [number, number]> = {
  manha: [0, 12 * 60],
  tarde: [12 * 60, 18 * 60],
  noite: [18 * 60, 24 * 60],
};

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** Faixas de atendimento da clínica no dia (ex.: [["08:00","12:00"],["13:00","18:00"]]). */
export function openRangesOn(hours: Record<string, [string, string][]>, dateISO: string): [string, string][] {
  const weekday = new Date(`${dateISO}T12:00:00Z`).getUTCDay();
  return hours[WEEKDAY_KEYS[weekday] ?? ""] ?? [];
}

/** A faixa de atendimento tem algum horário dentro do turno? */
export function rangeTouchesPeriod([open, close]: [string, string], period: SlotPeriod): boolean {
  const [start, end] = PERIOD_BOUNDS[period];
  return toMinutes(open) < end && toMinutes(close) > start;
}

/**
 * A faixa tem algum INÍCIO possível para uma visita de N minutos (mesmo passo
 * de 30 min da busca), dentro do turno e a partir de um minuto do dia? Ex.: faixa
 * 08:00–12:30 e 60 min não tem início à tarde (12:00 + 60 passa de 12:30).
 */
export function rangeHasStart(
  [open, close]: [string, string],
  period: SlotPeriod | null,
  durationMinutes: number,
  fromMinute = 0,
): boolean {
  for (let m = toMinutes(open); m + durationMinutes <= toMinutes(close); m += 30) {
    if (m >= fromMinute && inPeriod(m, period)) return true;
  }
  return false;
}

/** A clínica tem, em algum dia da semana, início possível nesse turno para N minutos? */
export function clinicServesPeriod(
  hours: Record<string, [string, string][]>,
  period: SlotPeriod,
  durationMinutes = 30,
): boolean {
  return Object.values(hours).some((ranges) => (ranges ?? []).some((r) => rangeHasStart(r, period, durationMinutes)));
}

export async function findSlots(
  db: Db | Tx,
  clinicId: string,
  tz: string,
  durationMinutes: number,
  limit = 6,
  /** Restringe a busca a estas profissionais (ex.: só quem faz o procedimento).
   *  undefined/null = todas as ativas; lista vazia = ninguém apto → sem slots. */
  professionalIds?: string[] | null,
  opts: SlotSearchOptions = {},
): Promise<FreeSlot[]> {
  if (professionalIds && professionalIds.length === 0) return [];
  const clinic = (
    await db
      .select({ businessHours: schema.clinics.businessHours })
      .from(schema.clinics)
      .where(eq(schema.clinics.id, clinicId))
      .limit(1)
  )[0];
  const hours = (clinic?.businessHours ?? {}) as Record<string, [string, string][]>;

  const professionals = await db
    .select({ id: schema.professionals.id, name: schema.professionals.name })
    .from(schema.professionals)
    .where(
      and(
        eq(schema.professionals.clinicId, clinicId),
        eq(schema.professionals.active, true),
        professionalIds ? inArray(schema.professionals.id, professionalIds) : undefined,
      ),
    );
  if (professionals.length === 0) return [];

  // Janela da busca: hoje (ou o dia pedido, nunca antes de hoje) + N dias
  const today = todayISO(tz);
  const validFrom = opts.fromDate && isRealDateISO(opts.fromDate) ? opts.fromDate : null;
  const startDate = validFrom && validFrom > today ? validFrom : today;
  const days = opts.onlyThatDay ? 1 : Math.min(Math.max(opts.days ?? 8, 1), MAX_SLOT_SEARCH_DAYS);
  if (addDaysISO(today, MAX_SLOT_SEARCH_DAYS) < startDate) return [];
  const windowStart = new Date(Math.max(Date.now(), zonedToUtc(startDate, "00:00", tz).getTime()));
  const windowEnd = zonedToUtc(addDaysISO(startDate, days), "00:00", tz);
  const appointments = await db
    .select({
      professionalId: schema.appointments.professionalId,
      startsAt: schema.appointments.startsAt,
      endsAt: schema.appointments.endsAt,
    })
    .from(schema.appointments)
    .where(
      and(
        eq(schema.appointments.clinicId, clinicId),
        inArray(schema.appointments.status, ["scheduled", "confirmed", "showed"]),
        gt(schema.appointments.endsAt, windowStart),
        lte(schema.appointments.startsAt, windowEnd),
        ne(schema.appointments.allowOverlap, true),
      ),
    );
  const blocks = await db
    .select()
    .from(schema.scheduleBlocks)
    .where(
      and(
        eq(schema.scheduleBlocks.clinicId, clinicId),
        gt(schema.scheduleBlocks.endsAt, windowStart),
        lte(schema.scheduleBlocks.startsAt, windowEnd),
      ),
    );

  return computeFreeSlots({
    hours,
    professionals,
    appointments,
    blocks,
    tz,
    durationMinutes,
    limit,
    startDate,
    days,
    period: opts.period ?? null,
    perDay: opts.perDay,
    now: Date.now(),
  });
}

interface Busy {
  professionalId: string | null;
  startsAt: Date | string;
  endsAt: Date | string;
}

/**
 * Parte pura da busca (sem banco): percorre os dias a partir de startDate em
 * passos de 30 min dentro do horário da clínica, respeitando antecedência de
 * 1h30, turno, limite por dia, bloqueios (da clínica toda ou da profissional)
 * e agendamentos. Em cada horário fica a primeira profissional livre.
 */
export function computeFreeSlots(input: {
  hours: Record<string, [string, string][]>;
  professionals: { id: string; name: string }[];
  appointments: Busy[];
  blocks: Busy[];
  tz: string;
  durationMinutes: number;
  limit: number;
  startDate: string;
  days: number;
  period?: SlotPeriod | null;
  perDay?: number;
  now: number;
}): FreeSlot[] {
  const { hours, professionals, appointments, blocks, tz, durationMinutes, limit, startDate, days } = input;
  const slots: FreeSlot[] = [];
  const minStart = input.now + 90 * 60_000; // antecedência mínima de 1h30
  const perDay = input.perDay && input.perDay > 0 ? input.perDay : Infinity;

  for (let day = 0; day < days && slots.length < limit; day++) {
    const dateISO = addDaysISO(startDate, day);
    const weekday = utcToZoned(zonedToUtc(dateISO, "12:00", tz), tz).weekday;
    const ranges = hours[WEEKDAY_KEYS[weekday] ?? ""] ?? [];
    let takenToday = 0;
    for (const [open, close] of ranges) {
      const [oh, om] = open.split(":").map(Number);
      const [ch, cm] = close.split(":").map(Number);
      for (
        let min = (oh ?? 8) * 60 + (om ?? 0);
        min + durationMinutes <= (ch ?? 19) * 60 + (cm ?? 0) && slots.length < limit && takenToday < perDay;
        min += 30
      ) {
        if (!inPeriod(min, input.period)) continue;
        const hh = String(Math.floor(min / 60)).padStart(2, "0");
        const mm = String(min % 60).padStart(2, "0");
        const start = zonedToUtc(dateISO, `${hh}:${mm}`, tz);
        if (start.getTime() < minStart) continue;
        const end = new Date(start.getTime() + durationMinutes * 60_000);

        const blockedAll = blocks.some(
          (b) =>
            b.professionalId === null &&
            new Date(b.startsAt) < end &&
            new Date(b.endsAt) > start,
        );
        if (blockedAll) continue;

        for (const prof of professionals) {
          const busy = appointments.some(
            (a) =>
              a.professionalId === prof.id &&
              new Date(a.startsAt) < end &&
              new Date(a.endsAt) > start,
          );
          const blocked = blocks.some(
            (b) =>
              b.professionalId === prof.id &&
              new Date(b.startsAt) < end &&
              new Date(b.endsAt) > start,
          );
          if (!busy && !blocked) {
            const [, m, d] = dateISO.split("-");
            slots.push({
              slotId: `${prof.id}|${start.toISOString()}`,
              label: `${WEEKDAYS_BR[weekday]} ${d}/${m} às ${hh}:${mm} com ${prof.name}`,
              dateISO,
              timeHHMM: `${hh}:${mm}`,
              professionalName: prof.name,
            });
            takenToday++;
            break;
          }
        }
      }
    }
  }
  return slots;
}

/** Profissionais ativas aptas a TODOS os procedimentos pedidos.
 *  Convenção: profissional SEM vínculos em professional_procedures faz todos. */
export async function eligibleProfessionalIds(
  db: Db | Tx,
  clinicId: string,
  procedureIds: string[],
): Promise<string[]> {
  const pros = await db
    .select({ id: schema.professionals.id })
    .from(schema.professionals)
    .where(and(eq(schema.professionals.clinicId, clinicId), eq(schema.professionals.active, true)));
  if (procedureIds.length === 0) return pros.map((p) => p.id);
  const links = await db
    .select({
      professionalId: schema.professionalProcedures.professionalId,
      procedureId: schema.professionalProcedures.procedureId,
    })
    .from(schema.professionalProcedures)
    .where(eq(schema.professionalProcedures.clinicId, clinicId));
  const porPro = new Map<string, Set<string>>();
  for (const l of links) {
    if (!porPro.has(l.professionalId)) porPro.set(l.professionalId, new Set());
    porPro.get(l.professionalId)!.add(l.procedureId);
  }
  return pros
    .filter((p) => {
      const faz = porPro.get(p.id);
      if (!faz || faz.size === 0) return true; // sem vínculos = faz todos
      return procedureIds.every((id) => faz.has(id));
    })
    .map((p) => p.id);
}
