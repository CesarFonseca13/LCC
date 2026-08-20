"use server";

import { and, eq, gte, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { normalizePhoneBR } from "@clinicaos/core/phone";
import { todayISO } from "@clinicaos/core/timezone";
import {
  adoptClinic,
  findSlots,
  parseSlotId,
  schema,
  withContext,
  type FreeSlot,
} from "@clinicaos/db";
import { materializeConfirmationRuns } from "@/lib/appointment-runs";

/** Agendamento online público — autenticado pelo slug da clínica (RLS booking_resolve). */

export interface BookingSlotsResult {
  ok: boolean;
  error?: string;
  slots?: FreeSlot[];
}

export async function getBookingSlots(
  slug: string,
  procedureId: string,
): Promise<BookingSlotsResult> {
  if (typeof slug !== "string" || typeof procedureId !== "string") {
    return { ok: false, error: "Dados inválidos." };
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

    const slots = await findSlots(tx, clinic.id, clinic.timezone, procedure.durationMinutes, 9);
    return { ok: true, slots };
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
