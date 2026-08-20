"use server";

import { and, eq, ilike, isNull, or, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  assertTransition,
  type AppointmentStatus,
} from "@clinicaos/core/appointment-fsm";
import { formatPhoneBR, normalizePhoneBR } from "@clinicaos/core/phone";
import { zonedToUtc } from "@clinicaos/core/timezone";
import { schema, type Tx } from "@clinicaos/db";
import { authAction } from "@/lib/auth-action";

export interface AgendaResult {
  ok: boolean;
  error?: string;
  /** Conflito de horário — a UI oferece "Encaixar mesmo assim". */
  conflict?: "professional" | "room";
  appointmentId?: string;
}

async function clinicTimezone(tx: Tx, clinicId: string): Promise<string> {
  const rows = await tx
    .select({ timezone: schema.clinics.timezone })
    .from(schema.clinics)
    .where(eq(schema.clinics.id, clinicId))
    .limit(1);
  return rows[0]?.timezone ?? "America/Sao_Paulo";
}

async function hasBlockOverlap(
  tx: Tx,
  professionalId: string,
  startsAt: Date,
  endsAt: Date,
): Promise<boolean> {
  const rows = await tx.execute(sql`
    SELECT 1 FROM schedule_blocks
    WHERE (professional_id IS NULL OR professional_id = ${professionalId})
      AND tstzrange(starts_at, ends_at) && tstzrange(${startsAt}, ${endsAt})
    LIMIT 1
  `);
  return (rows.rowCount ?? 0) > 0;
}

function detectConflict(err: unknown): "professional" | "room" | null {
  const text = String(err);
  if (text.includes("appointments_no_overlap_professional")) return "professional";
  if (text.includes("appointments_no_overlap_room")) return "room";
  return null;
}

// ── Criação rápida ───────────────────────────────────────────────────

const createSchema = z.object({
  customerId: z.string().uuid().optional(),
  // Cliente nova inline: só nome + WhatsApp
  newCustomerName: z.string().trim().optional(),
  newCustomerPhone: z.string().trim().optional(),
  professionalId: z.string().uuid("Escolha a profissional"),
  procedureId: z.string().uuid("Escolha o procedimento"),
  roomId: z
    .string()
    .transform((v) => (v && v !== "none" ? v : null))
    .pipe(z.string().uuid().nullable()),
  dateISO: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  timeHHMM: z.string().regex(/^\d{2}:\d{2}$/),
  notes: z.string().trim().transform((v) => v || null),
  allowOverlap: z.boolean().default(false),
});

export const createAppointment = authAction({
  permission: "agenda.write",
  schema: createSchema,
  handler: async (input, { auth, tx }): Promise<AgendaResult> => {
    // Cliente: existente ou criação inline (nome + WhatsApp)
    let customerId = input.customerId;
    if (!customerId) {
      const name = input.newCustomerName ?? "";
      const phone = normalizePhoneBR(input.newCustomerPhone ?? "");
      if (name.length < 2 || !phone) {
        return { ok: false, error: "Para cliente nova, informe nome e WhatsApp válido." };
      }
      const existing = await tx
        .select({ id: schema.customers.id, fullName: schema.customers.fullName })
        .from(schema.customers)
        .where(
          and(eq(schema.customers.phoneE164, phone), isNull(schema.customers.deletedAt)),
        )
        .limit(1);
      if (existing[0]) {
        // Telefone já cadastrado — usa a ficha existente em vez de duplicar
        customerId = existing[0].id;
      } else {
        const [created] = await tx
          .insert(schema.customers)
          .values({
            clinicId: auth.clinicId,
            fullName: name,
            phoneE164: phone,
            source: "agenda",
          })
          .returning({ id: schema.customers.id });
        customerId = created?.id;
      }
    }
    if (!customerId) return { ok: false, error: "Cliente inválida." };

    const proc = (
      await tx
        .select({
          durationMinutes: schema.procedures.durationMinutes,
          price: schema.procedures.price,
        })
        .from(schema.procedures)
        .where(eq(schema.procedures.id, input.procedureId))
        .limit(1)
    )[0];
    if (!proc) return { ok: false, error: "Procedimento não encontrado." };

    const tz = await clinicTimezone(tx, auth.clinicId);
    const startsAt = zonedToUtc(input.dateISO, input.timeHHMM, tz);
    const endsAt = new Date(startsAt.getTime() + proc.durationMinutes * 60_000);

    if (await hasBlockOverlap(tx, input.professionalId, startsAt, endsAt)) {
      return { ok: false, error: "Esse horário está bloqueado na agenda." };
    }

    try {
      const [created] = await tx
        .insert(schema.appointments)
        .values({
          clinicId: auth.clinicId,
          customerId,
          professionalId: input.professionalId,
          roomId: input.roomId,
          procedureId: input.procedureId,
          startsAt,
          endsAt,
          price: proc.price,
          notes: input.notes,
          allowOverlap: input.allowOverlap,
          createdBy: auth.userId,
        })
        .returning({ id: schema.appointments.id });

      if (created) {
        await tx.insert(schema.appointmentStatusHistory).values({
          clinicId: auth.clinicId,
          appointmentId: created.id,
          fromStatus: null,
          toStatus: "scheduled",
          changedByUserId: auth.userId,
        });
      }

      revalidatePath("/agenda");
      revalidatePath("/inicio");
      return { ok: true, appointmentId: created?.id };
    } catch (err) {
      const conflict = detectConflict(err);
      if (conflict) {
        return {
          ok: false,
          conflict,
          error:
            conflict === "professional"
              ? "A profissional já tem atendimento nesse horário."
              : "A sala já está ocupada nesse horário.",
        };
      }
      throw err;
    }
  },
});

// ── Mudança de status (FSM — porta única) ────────────────────────────

const statusSchema = z.object({
  id: z.string().uuid(),
  to: z.enum(["confirmed", "showed", "no_show", "cancelled"]),
  reason: z.string().trim().optional(),
});

export const changeAppointmentStatus = authAction({
  permission: "agenda.write",
  schema: statusSchema,
  handler: async (input, { auth, tx }): Promise<AgendaResult> => {
    const rows = await tx
      .select({ status: schema.appointments.status })
      .from(schema.appointments)
      .where(eq(schema.appointments.id, input.id))
      .limit(1);
    const current = rows[0]?.status as AppointmentStatus | undefined;
    if (!current) return { ok: false, error: "Agendamento não encontrado." };

    try {
      assertTransition(current, input.to);
    } catch {
      return {
        ok: false,
        error: `Não dá para mudar de "${current}" para "${input.to}".`,
      };
    }

    await tx
      .update(schema.appointments)
      .set({
        status: input.to,
        statusChangedAt: new Date(),
        cancelReason: input.to === "cancelled" ? (input.reason ?? null) : undefined,
      })
      .where(eq(schema.appointments.id, input.id));

    await tx.insert(schema.appointmentStatusHistory).values({
      clinicId: auth.clinicId,
      appointmentId: input.id,
      fromStatus: current,
      toStatus: input.to,
      changedByUserId: auth.userId,
      reason: input.reason ?? null,
    });

    // Efeitos de "showed"/"no_show" (financeiro, pós-atendimento, recuperação
    // de falta) entram na Fase 2 — o gancho é a FSM em packages/core.

    revalidatePath("/agenda");
    revalidatePath("/inicio");
    return { ok: true };
  },
});

// ── Reagendamento (cria NOVO appointment — decisão nº 2) ─────────────

const rescheduleSchema = z.object({
  id: z.string().uuid(),
  dateISO: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  timeHHMM: z.string().regex(/^\d{2}:\d{2}$/),
  allowOverlap: z.boolean().default(false),
});

export const rescheduleAppointment = authAction({
  permission: "agenda.write",
  schema: rescheduleSchema,
  handler: async (input, { auth, tx }): Promise<AgendaResult> => {
    const rows = await tx
      .select()
      .from(schema.appointments)
      .where(eq(schema.appointments.id, input.id))
      .limit(1);
    const original = rows[0];
    if (!original) return { ok: false, error: "Agendamento não encontrado." };
    if (!["scheduled", "confirmed", "no_show"].includes(original.status)) {
      return { ok: false, error: "Esse agendamento não pode ser remarcado." };
    }

    const durationMs =
      new Date(original.endsAt).getTime() - new Date(original.startsAt).getTime();
    const tz = await clinicTimezone(tx, auth.clinicId);
    const startsAt = zonedToUtc(input.dateISO, input.timeHHMM, tz);
    const endsAt = new Date(startsAt.getTime() + durationMs);

    if (await hasBlockOverlap(tx, original.professionalId, startsAt, endsAt)) {
      return { ok: false, error: "Esse horário está bloqueado na agenda." };
    }

    try {
      // 1º: marca o antigo como remarcado (sai do índice anti-conflito)
      await tx
        .update(schema.appointments)
        .set({ status: "rescheduled", statusChangedAt: new Date() })
        .where(eq(schema.appointments.id, input.id));

      const [created] = await tx
        .insert(schema.appointments)
        .values({
          clinicId: auth.clinicId,
          customerId: original.customerId,
          professionalId: original.professionalId,
          roomId: original.roomId,
          procedureId: original.procedureId,
          startsAt,
          endsAt,
          price: original.price,
          notes: original.notes,
          origin: "reschedule",
          allowOverlap: input.allowOverlap,
          parentAppointmentId: original.parentAppointmentId,
          createdBy: auth.userId,
        })
        .returning({ id: schema.appointments.id });
      if (!created) return { ok: false, error: "Falha ao remarcar." };

      await tx
        .update(schema.appointments)
        .set({ rescheduledToId: created.id })
        .where(eq(schema.appointments.id, input.id));

      await tx.insert(schema.appointmentStatusHistory).values([
        {
          clinicId: auth.clinicId,
          appointmentId: input.id,
          fromStatus: original.status,
          toStatus: "rescheduled",
          changedByUserId: auth.userId,
        },
        {
          clinicId: auth.clinicId,
          appointmentId: created.id,
          fromStatus: null,
          toStatus: "scheduled",
          changedByUserId: auth.userId,
          reason: "reagendamento",
        },
      ]);

      revalidatePath("/agenda");
      revalidatePath("/inicio");
      return { ok: true, appointmentId: created.id };
    } catch (err) {
      const conflict = detectConflict(err);
      if (conflict) {
        return {
          ok: false,
          conflict,
          error: "Já existe atendimento nesse horário.",
        };
      }
      throw err;
    }
  },
});

// ── Bloqueios ────────────────────────────────────────────────────────

const blockSchema = z.object({
  professionalId: z
    .string()
    .transform((v) => (v && v !== "all" ? v : null))
    .pipe(z.string().uuid().nullable()),
  dateISO: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startHHMM: z.string().regex(/^\d{2}:\d{2}$/),
  endHHMM: z.string().regex(/^\d{2}:\d{2}$/),
  reason: z.string().trim().transform((v) => v || null),
});

export const createBlock = authAction({
  permission: "agenda.write",
  schema: blockSchema,
  handler: async (input, { auth, tx }): Promise<AgendaResult> => {
    const tz = await clinicTimezone(tx, auth.clinicId);
    const startsAt = zonedToUtc(input.dateISO, input.startHHMM, tz);
    const endsAt = zonedToUtc(input.dateISO, input.endHHMM, tz);
    if (endsAt <= startsAt) {
      return { ok: false, error: "O fim do bloqueio precisa ser depois do início." };
    }
    await tx.insert(schema.scheduleBlocks).values({
      clinicId: auth.clinicId,
      professionalId: input.professionalId,
      startsAt,
      endsAt,
      reason: input.reason,
      createdBy: auth.userId,
    });
    revalidatePath("/agenda");
    return { ok: true };
  },
});

export const deleteBlock = authAction({
  permission: "agenda.write",
  schema: z.object({ id: z.string().uuid() }),
  handler: async (input, { tx }): Promise<AgendaResult> => {
    await tx.delete(schema.scheduleBlocks).where(eq(schema.scheduleBlocks.id, input.id));
    revalidatePath("/agenda");
    return { ok: true };
  },
});

// ── Busca de cliente para o combobox ─────────────────────────────────

const searchSchema = z.object({ q: z.string().trim().min(1) });

export const searchCustomers = authAction({
  permission: "customers.read",
  schema: searchSchema,
  handler: async (input, { tx }) => {
    const digits = input.q.replace(/\D/g, "");
    const rows = await tx
      .select({
        id: schema.customers.id,
        fullName: schema.customers.fullName,
        phoneE164: schema.customers.phoneE164,
      })
      .from(schema.customers)
      .where(
        and(
          isNull(schema.customers.deletedAt),
          digits.length >= 4
            ? or(
                ilike(schema.customers.fullName, `%${input.q}%`),
                ilike(schema.customers.phoneE164, `%${digits}%`),
              )
            : ilike(schema.customers.fullName, `%${input.q}%`),
        ),
      )
      .orderBy(schema.customers.fullName)
      .limit(8);
    return rows.map((r) => ({
      id: r.id,
      label: `${r.fullName} — ${formatPhoneBR(r.phoneE164)}`,
    }));
  },
});
