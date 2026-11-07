"use server";

import { and, eq, gte, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { normalizePhoneBR } from "@clinicaos/core/phone";
import { addDaysISO, todayISO, utcToZoned } from "@clinicaos/core/timezone";
import {
  adoptClinic,
  eligibleProfessionalIds,
  findSlots,
  parseSlotId,
  schema,
  withContext,
  type FreeSlot,
} from "@clinicaos/db";
import { materializeConfirmationRuns } from "@/lib/appointment-runs";

/** Agendamento online público — autenticado pelo slug da clínica (RLS booking_resolve). */

/** Até quantos dias à frente a página pública oferece horários. */
const BOOKING_DAYS = 21;
const WEEKDAYS_BR = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

export interface BookingDay {
  dateISO: string;
  /** "seg" */
  weekday: string;
  /** "09/11" */
  dayMonth: string;
}

export interface BookingSlotsResult {
  ok: boolean;
  error?: string;
  /** Horários do dia escolhido. */
  slots?: FreeSlot[];
  /** Dias com pelo menos um horário livre nas próximas 3 semanas (seletor de dia). */
  days?: BookingDay[];
  /** Dia mostrado em slots. */
  dateISO?: string | null;
}

export async function getBookingSlots(
  slug: string,
  procedureId: string,
  dateISO?: string | null,
): Promise<BookingSlotsResult> {
  if (typeof slug !== "string" || typeof procedureId !== "string") {
    return { ok: false, error: "Dados inválidos." };
  }
  if (dateISO !== undefined && dateISO !== null && (typeof dateISO !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dateISO))) {
    return { ok: false, error: "Dia inválido." };
  }
  return withContext({ bookingSlug: slug }, async (tx) => {
    const clinic = (
      await tx
        .select({ id: schema.clinics.id, timezone: schema.clinics.timezone })
        .from(schema.clinics)
        .where(eq(schema.clinics.bookingSlug, slug))
        .limit(1)
    )[0];
    if (!clinic) return { ok: false, error: "Agendamento online indisponível." };

    await adoptClinic(tx, clinic.id);
    const procedure = (
      await tx
        .select({ durationMinutes: schema.procedures.durationMinutes })
        .from(schema.procedures)
        .where(and(eq(schema.procedures.id, procedureId), eq(schema.procedures.active, true)))
        .limit(1)
    )[0];
    if (!procedure) return { ok: false, error: "Procedimento indisponível." };

    // Só profissionais que realizam o procedimento escolhido
    const aptas = await eligibleProfessionalIds(tx, clinic.id, [procedureId]);
    // Dias com vaga: o primeiro horário livre de cada dia (perDay 1) nas próximas 3 semanas
    const firstOfDay = await findSlots(tx, clinic.id, clinic.timezone, procedure.durationMinutes, BOOKING_DAYS, aptas, {
      perDay: 1,
      days: BOOKING_DAYS,
    });
    const days: BookingDay[] = firstOfDay.map((s) => {
      const [, m, d] = s.dateISO.split("-");
      const weekday = WEEKDAYS_BR[new Date(`${s.dateISO}T12:00:00Z`).getUTCDay()] ?? "";
      return { dateISO: s.dateISO, weekday, dayMonth: `${d}/${m}` };
    });
    // Dia pedido que lotou (ou saiu da janela): devolve o próprio dia, vazio — a
    // tela avisa "esse dia acabou de lotar". Nunca troca de dia em silêncio.
    const chosen = dateISO ?? days[0]?.dateISO ?? null;
    const slots =
      chosen && days.some((d) => d.dateISO === chosen)
        ? await findSlots(tx, clinic.id, clinic.timezone, procedure.durationMinutes, 48, aptas, {
            fromDate: chosen,
            onlyThatDay: true,
          })
        : [];
    return { ok: true, slots, days, dateISO: chosen };
  });
}

export interface BookResult {
  ok: boolean;
  error?: string;
  conflict?: boolean;
  whenLabel?: string;
}

const bookSchema = z.object({
  slug: z.string().min(1),
  procedureId: z.string().uuid(),
  slotId: z.string().min(10),
  name: z.string().trim().min(5, "Informe seu nome completo"),
  phone: z.string().trim().min(8, "Informe seu WhatsApp"),
});

export async function bookOnline(rawInput: unknown): Promise<BookResult> {
  const parsed = bookSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }
  const input = parsed.data;
  const phone = normalizePhoneBR(input.phone);
  if (!phone) return { ok: false, error: "WhatsApp inválido — use DDD + número." };
  const slot = parseSlotId(input.slotId);
  if (!slot) return { ok: false, error: "Escolha um horário de novo, por favor." };
  const startsAt = new Date(slot.startISO);
  if (startsAt.getTime() < Date.now() + 30 * 60_000) {
    return { ok: false, error: "Esse horário já passou — escolha outro.", conflict: true };
  }

  return withContext({ bookingSlug: input.slug }, async (tx) => {
    const clinic = (
      await tx
        .select({ id: schema.clinics.id, timezone: schema.clinics.timezone })
        .from(schema.clinics)
        .where(eq(schema.clinics.bookingSlug, input.slug))
        .limit(1)
    )[0];
    if (!clinic) return { ok: false, error: "Agendamento online indisponível." };
    await adoptClinic(tx, clinic.id);

    const procedure = (
      await tx
        .select({
          id: schema.procedures.id,
          name: schema.procedures.name,
          durationMinutes: schema.procedures.durationMinutes,
          price: schema.procedures.price,
        })
        .from(schema.procedures)
        .where(and(eq(schema.procedures.id, input.procedureId), eq(schema.procedures.active, true)))
        .limit(1)
    )[0];
    if (!procedure) return { ok: false, error: "Procedimento indisponível." };

    // O slotId vem do navegador da cliente: NUNCA confie nele. A profissional
    // precisa ser DESTA clínica e estar ativa, e o horário tem que existir de
    // verdade na janela de oferta (nada de gravar em agenda alheia ou às 3h).
    const professional = (
      await tx
        .select({ id: schema.professionals.id })
        .from(schema.professionals)
        .where(
          and(
            eq(schema.professionals.id, slot.professionalId),
            eq(schema.professionals.clinicId, clinic.id),
            eq(schema.professionals.active, true),
          ),
        )
        .limit(1)
    )[0];
    if (!professional) {
      return { ok: false, error: "Esse horário não está mais disponível.", conflict: true };
    }
    const aptas = await eligibleProfessionalIds(tx, clinic.id, [input.procedureId]);
    // Confere o horário no PRÓPRIO dia dele (a página oferece até 3 semanas à frente)
    const slotDate = utcToZoned(startsAt, clinic.timezone).dateISO;
    if (slotDate > addDaysISO(todayISO(clinic.timezone), BOOKING_DAYS)) {
      return { ok: false, error: "Esse horário não está mais disponível.", conflict: true };
    }
    const validSlots = await findSlots(tx, clinic.id, clinic.timezone, procedure.durationMinutes, 200, aptas, {
      fromDate: slotDate,
      onlyThatDay: true,
    });
    if (!validSlots.some((s) => s.slotId === input.slotId)) {
      return { ok: false, error: "Esse horário acabou de ser preenchido 😅", conflict: true };
    }

    // Cliente: reaproveita a ficha pelo telefone (nunca duplica)
    let customer = (
      await tx
        .select({ id: schema.customers.id })
        .from(schema.customers)
        .where(and(eq(schema.customers.phoneE164, phone), isNull(schema.customers.deletedAt)))
        .limit(1)
    )[0];
    if (!customer) {
      const [created] = await tx
        .insert(schema.customers)
        .values({
          clinicId: clinic.id,
          fullName: input.name,
          phoneE164: phone,
          status: "lead",
          source: "online_booking",
        })
        .onConflictDoNothing()
        .returning({ id: schema.customers.id });
      customer = created;
    }
    if (!customer) return { ok: false, error: "Não foi possível criar seu cadastro." };

    // Anti-abuso: máximo 3 agendamentos online por dia por telefone
    const hoje = todayISO(clinic.timezone);
    const todayCount = (
      await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.appointments)
        .where(
          and(
            eq(schema.appointments.customerId, customer.id),
            eq(schema.appointments.origin, "online_booking"),
            gte(schema.appointments.createdAt, new Date(`${hoje}T00:00:00-03:00`)),
          ),
        )
    )[0];
    if ((todayCount?.count ?? 0) >= 3) {
      return {
        ok: false,
        error: "Você já fez vários agendamentos hoje — fale direto com a clínica pelo WhatsApp. 💛",
      };
    }

    const endsAt = new Date(startsAt.getTime() + procedure.durationMinutes * 60_000);
    try {
      const [created] = await tx
        .insert(schema.appointments)
        .values({
          clinicId: clinic.id,
          customerId: customer.id,
          professionalId: slot.professionalId,
          procedureId: procedure.id,
          startsAt,
          endsAt,
          price: procedure.price,
          origin: "online_booking",
        })
        .returning({ id: schema.appointments.id });
      if (!created) throw new Error("insert falhou");

      await tx.insert(schema.appointmentStatusHistory).values({
        clinicId: clinic.id,
        appointmentId: created.id,
        fromStatus: null,
        toStatus: "scheduled",
        source: "customer_whatsapp",
        reason: "agendamento online",
      });
      await materializeConfirmationRuns(
        tx,
        clinic.id,
        created.id,
        customer.id,
        startsAt,
        procedure.id,
      );
      await tx.insert(schema.notifications).values({
        clinicId: clinic.id,
        type: "online_booking",
        title: `${input.name} agendou online: ${procedure.name}`,
        refTable: "appointments",
        refId: created.id,
      });
      // Funil corre sozinho: agendou online → card vai para "Agendou avaliação"
      await tx.execute(sql`
        INSERT INTO pipeline_stages (clinic_id, name, sort)
        SELECT ${clinic.id}, 'Agendou avaliação', 3
        WHERE NOT EXISTS (SELECT 1 FROM pipeline_stages
                          WHERE clinic_id = ${clinic.id} AND name = 'Agendou avaliação')
      `);
      // Valor da negociação nasce do agendamento (só se ninguém preencheu antes)
      await tx.execute(sql`
        UPDATE deals d SET stage_id = s.id, updated_at = now(),
          value = COALESCE(d.value, (SELECT NULLIF(a.price, 0) FROM appointments a WHERE a.id = ${created.id})),
          notes = COALESCE(NULLIF(d.notes, ''),
            (SELECT 'Agendou: ' || p.name FROM appointments a
             JOIN procedures p ON p.id = a.procedure_id WHERE a.id = ${created.id}))
        FROM pipeline_stages s
        WHERE d.customer_id = ${customer.id} AND d.status = 'open'
          AND s.clinic_id = d.clinic_id AND s.name = 'Agendou avaliação'
      `);

      const z2 = new Intl.DateTimeFormat("pt-BR", {
        weekday: "long",
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: clinic.timezone,
      }).format(startsAt);
      return { ok: true, whenLabel: z2 };
    } catch (err) {
      if (String(err).includes("appointments_no_overlap")) {
        return {
          ok: false,
          conflict: true,
          error: "Esse horário acabou de ser preenchido 😅 Escolha outro, por favor!",
        };
      }
      throw err;
    }
  });
}
