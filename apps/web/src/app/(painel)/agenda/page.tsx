import { and, asc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { addDaysISO, todayISO, utcToZoned, zonedToUtc } from "@clinicaos/core/timezone";
import { schema, withTenant } from "@clinicaos/db";
import { requireAuth } from "@/lib/auth-action";
import { AgendaView, type AgendaData } from "./agenda-view";

export const metadata = { title: "Agenda" };

interface BusinessHours {
  [day: string]: [string, string][];
}

const WEEKDAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

function hoursForDate(businessHours: BusinessHours, weekday: number): [number, number] {
  const ranges = businessHours[WEEKDAY_KEYS[weekday] ?? "mon"];
  if (!ranges || ranges.length === 0) return [8 * 60, 19 * 60];
  const toMin = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    return (h ?? 0) * 60 + (m ?? 0);
  };
  const starts = ranges.map((r) => toMin(r[0]));
  const ends = ranges.map((r) => toMin(r[1]));
  return [Math.min(...starts), Math.max(...ends)];
}

export default async function AgendaPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; date?: string; prof?: string }>;
}) {
  const auth = await requireAuth();
  if (!auth.clinicId) return null;
  const sp = await searchParams;

  const data = await withTenant(
    auth.clinicId,
    async (tx): Promise<AgendaData> => {
      const clinic = (
        await tx
          .select({
            timezone: schema.clinics.timezone,
            businessHours: schema.clinics.businessHours,
          })
          .from(schema.clinics)
          .where(eq(schema.clinics.id, auth.clinicId!))
          .limit(1)
      )[0];
      const tz = clinic?.timezone ?? "America/Sao_Paulo";
      const businessHours = (clinic?.businessHours ?? {}) as BusinessHours;

      const view =
        sp.view === "semana" ? "semana" : sp.view === "lista" ? "lista" : "dia";
      const dateISO = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? "")
        ? sp.date!
        : todayISO(tz);

      const professionals = await tx
        .select({
          id: schema.professionals.id,
          name: schema.professionals.name,
          color: schema.professionals.calendarColor,
        })
        .from(schema.professionals)
        .where(eq(schema.professionals.active, true))
        .orderBy(schema.professionals.name);

      const profId =
        sp.prof && professionals.some((p) => p.id === sp.prof)
          ? sp.prof
          : professionals[0]?.id;

      const procedures = await tx
        .select({
          id: schema.procedures.id,
          name: schema.procedures.name,
          durationMinutes: schema.procedures.durationMinutes,
        })
        .from(schema.procedures)
        .where(eq(schema.procedures.active, true))
        .orderBy(schema.procedures.name);

      const rooms = await tx
        .select({ id: schema.rooms.id, name: schema.rooms.name })
        .from(schema.rooms)
        .where(eq(schema.rooms.active, true))
        .orderBy(schema.rooms.name);

      // Intervalo consultado: dia OU semana (7 dias) OU lista (14 dias)
      const rangeStartISO =
        view === "semana" ? addDaysISO(dateISO, -((await weekdayOf(dateISO, tz)) + 6) % 7) : dateISO;
      const rangeDays = view === "semana" ? 7 : view === "lista" ? 14 : 1;
      const rangeStart = zonedToUtc(rangeStartISO, "00:00", tz);
      const rangeEnd = zonedToUtc(addDaysISO(rangeStartISO, rangeDays), "00:00", tz);

      const visibleStatuses =
        view === "lista"
          ? (["scheduled", "confirmed", "showed", "no_show", "cancelled"] as const)
          : (["scheduled", "confirmed", "showed", "no_show"] as const);

      const rows = await tx
        .select({
          id: schema.appointments.id,
          customerId: schema.appointments.customerId,
          customerName: schema.customers.fullName,
          professionalId: schema.appointments.professionalId,
          procedureName: sql<string | null>`(SELECT p2.name FROM procedures p2 WHERE p2.id = appointments.procedure_id)`,
          startsAt: schema.appointments.startsAt,
          endsAt: schema.appointments.endsAt,
          status: schema.appointments.status,
          notes: schema.appointments.notes,
          allowOverlap: schema.appointments.allowOverlap,
        })
        .from(schema.appointments)
        .innerJoin(
          schema.customers,
          eq(schema.customers.id, schema.appointments.customerId),
        )
        .where(
          and(
            gte(schema.appointments.startsAt, rangeStart),
            lt(schema.appointments.startsAt, rangeEnd),
            inArray(schema.appointments.status, [...visibleStatuses]),
          ),
        )
        .orderBy(asc(schema.appointments.startsAt));

      const appointments = rows.map((r) => {
        const start = utcToZoned(new Date(r.startsAt), tz);
        const end = utcToZoned(new Date(r.endsAt), tz);
        return {
          id: r.id,
          customerId: r.customerId,
          customerName: r.customerName,
          professionalId: r.professionalId,
          procedureName: r.procedureName,
          dateISO: start.dateISO,
          startMin: start.minutesOfDay,
          endMin: end.minutesOfDay > start.minutesOfDay ? end.minutesOfDay : 24 * 60,
          timeHHMM: start.timeHHMM,
          endHHMM: end.timeHHMM,
          status: r.status,
          notes: r.notes,
          allowOverlap: r.allowOverlap,
        };
      });

      const blockRows = await tx
        .select()
        .from(schema.scheduleBlocks)
        .where(
          and(
            gte(schema.scheduleBlocks.endsAt, rangeStart),
            lt(schema.scheduleBlocks.startsAt, rangeEnd),
          ),
        );
      const blocks = blockRows.map((b) => {
        const start = utcToZoned(new Date(b.startsAt), tz);
        const end = utcToZoned(new Date(b.endsAt), tz);
        return {
          id: b.id,
          professionalId: b.professionalId,
          dateISO: start.dateISO,
          startMin: start.minutesOfDay,
          endMin: end.minutesOfDay > start.minutesOfDay ? end.minutesOfDay : 24 * 60,
          reason: b.reason,
        };
      });

      // Janela do grid: horário da clínica ± o que existir agendado fora dele
      const weekday = await weekdayOf(dateISO, tz);
      let [openMin, closeMin] = hoursForDate(businessHours, weekday);
      for (const a of appointments) {
        if (a.startMin < openMin) openMin = Math.floor(a.startMin / 30) * 30;
        if (a.endMin > closeMin) closeMin = Math.ceil(a.endMin / 30) * 30;
      }

      const nowZ = utcToZoned(new Date(), tz);

      return {
        view,
        dateISO,
        todayISO: nowZ.dateISO,
        nowMin: nowZ.minutesOfDay,
        weekStartISO: rangeStartISO,
        timezone: tz,
        openMin,
        closeMin,
        professionals,
        selectedProfessionalId: profId ?? null,
        procedures,
        rooms,
        appointments,
        blocks,
      };
    },
    auth.userId,
  );

  return <AgendaView data={data} />;
}

async function weekdayOf(dateISO: string, tz: string): Promise<number> {
  return utcToZoned(zonedToUtc(dateISO, "12:00", tz), tz).weekday;
}
