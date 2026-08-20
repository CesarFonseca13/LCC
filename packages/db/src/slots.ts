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

export async function findSlots(
  db: Db | Tx,
  clinicId: string,
  tz: string,
  durationMinutes: number,
  limit = 6,
): Promise<FreeSlot[]> {
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
    .where(and(eq(schema.professionals.clinicId, clinicId), eq(schema.professionals.active, true)));
  if (professionals.length === 0) return [];

  const windowStart = new Date();
  const windowEnd = new Date(Date.now() + 8 * 86_400_000);
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

  const slots: FreeSlot[] = [];
  const minStart = Date.now() + 90 * 60_000; // antecedência mínima de 1h30
  const today = todayISO(tz);

  for (let day = 0; day < 8 && slots.length < limit; day++) {
    const dateISO = addDaysISO(today, day);
    const weekday = utcToZoned(zonedToUtc(dateISO, "12:00", tz), tz).weekday;
    const ranges = hours[WEEKDAY_KEYS[weekday] ?? ""] ?? [];
    for (const [open, close] of ranges) {
      const [oh, om] = open.split(":").map(Number);
      const [ch, cm] = close.split(":").map(Number);
      for (
        let min = (oh ?? 8) * 60 + (om ?? 0);
        min + durationMinutes <= (ch ?? 19) * 60 + (cm ?? 0) && slots.length < limit;
        min += 30
      ) {
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
            break;
          }
        }
      }
    }
  }
  return slots;
}
