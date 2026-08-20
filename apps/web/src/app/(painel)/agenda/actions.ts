"use server";

import { and, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  assertTransition,
  type AppointmentStatus,
} from "@clinicaos/core/appointment-fsm";
import { formatPhoneBR, normalizePhoneBR } from "@clinicaos/core/phone";
import { todayISO, zonedToUtc } from "@clinicaos/core/timezone";
import { schema, type Tx } from "@clinicaos/db";
import { materializeConfirmationRuns } from "@/lib/appointment-runs";
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

/** Runs criadas quando o atendimento vira Compareceu ou Faltou. */
async function materializeOutcomeRuns(
  tx: Tx,
  clinicId: string,
  appointment: AppointmentRow,
  outcome: "showed" | "no_show",
): Promise<void> {
  const wanted =
    outcome === "showed"
      ? ["post_visit", "feedback_request", "touchup_offer", "post_sale_cadence"]
      : ["no_show_message", "no_show_followup"];
  const enabled = await tx
    .select({ automationId: schema.automationSettings.automationId })
    .from(schema.automationSettings)
    .where(
      and(
        eq(schema.automationSettings.clinicId, clinicId),
        eq(schema.automationSettings.enabled, true),
        inArray(schema.automationSettings.automationId, wanted),
      ),
    );
  const enabledSet = new Set(enabled.map((e) => e.automationId));
  if (enabledSet.size === 0) return;

  const proc = appointment.procedureId
    ? (
        await tx
          .select({
            touchupDays: schema.procedures.touchupDays,
            postSaleCadenceDays: schema.procedures.postSaleCadenceDays,
          })
          .from(schema.procedures)
          .where(eq(schema.procedures.id, appointment.procedureId))
          .limit(1)
      )[0]
    : undefined;

  const now = Date.now();
  const schedule: { automationId: string; at: number }[] = [];
  if (outcome === "showed") {
    schedule.push(
      { automationId: "post_visit", at: now + 2 * 3_600_000 },
      { automationId: "feedback_request", at: now + 24 * 3_600_000 },
    );
    if (proc?.touchupDays) {
      schedule.push({ automationId: "touchup_offer", at: now + proc.touchupDays * 86_400_000 });
    }
    const days = (proc?.postSaleCadenceDays ?? []).slice().sort((a, b) => a - b);
    if (days.length > 0) {
      schedule.push({ automationId: "post_sale_cadence", at: now + days[0]! * 86_400_000 });
    }
  } else {
    schedule.push(
      { automationId: "no_show_message", at: now + 40 * 60_000 },
      { automationId: "no_show_followup", at: now + 3 * 86_400_000 },
    );
  }

  for (const item of schedule) {
    if (!enabledSet.has(item.automationId)) continue;
    await tx
      .insert(schema.automationRuns)
      .values({
        clinicId,
        automationId: item.automationId,
        customerId: appointment.customerId,
        appointmentId: appointment.id,
        nextRunAt: new Date(item.at),
      })
      .onConflictDoNothing();
  }
}

async function ensureCategory(
  tx: Tx,
  clinicId: string,
  name: string,
  kind: "income" | "expense",
): Promise<string> {
  const existing = await tx
    .select({ id: schema.financeCategories.id })
    .from(schema.financeCategories)
    .where(
      and(
        eq(schema.financeCategories.clinicId, clinicId),
        eq(schema.financeCategories.kind, kind),
        eq(schema.financeCategories.name, name),
      ),
    )
    .limit(1);
  if (existing[0]) return existing[0].id;
  const [created] = await tx
    .insert(schema.financeCategories)
    .values({ clinicId, name, kind })
    .onConflictDoNothing()
    .returning({ id: schema.financeCategories.id });
  if (created) return created.id;
  const retry = await tx
    .select({ id: schema.financeCategories.id })
    .from(schema.financeCategories)
    .where(
      and(
        eq(schema.financeCategories.clinicId, clinicId),
        eq(schema.financeCategories.kind, kind),
        eq(schema.financeCategories.name, name),
      ),
    )
    .limit(1);
  return retry[0]!.id;
}

type AppointmentRow = typeof schema.appointments.$inferSelect;

/** Compareceu: debita o consumo de materiais do procedimento (fonte: procedure_supplies). */
async function applyStockConsumption(
  tx: Tx,
  clinicId: string,
  appointment: AppointmentRow,
): Promise<void> {
  if (!appointment.procedureId) return;
  const supplies = await tx
    .select({
      stockItemId: schema.procedureSupplies.stockItemId,
      quantity: schema.procedureSupplies.quantityPerSession,
    })
    .from(schema.procedureSupplies)
    .where(eq(schema.procedureSupplies.procedureId, appointment.procedureId));
  for (const supply of supplies) {
    // Índice único parcial (appointment, item) garante idempotência do débito
    await tx
      .insert(schema.stockMovements)
      .values({
        clinicId,
        stockItemId: supply.stockItemId,
        kind: "procedure_use",
        quantity: String(-Number(supply.quantity)),
        appointmentId: appointment.id,
      })
      .onConflictDoNothing();
  }
}

/** Compareceu: apura a comissão da profissional (regra específica > geral > padrão). */
async function applyCommission(
  tx: Tx,
  clinicId: string,
  appointment: AppointmentRow,
): Promise<void> {
  // Base: sessão de pacote vale preço_pago/total_de_sessões; avulso vale o preço
  let base = appointment.price ? Number(appointment.price) : 0;
  if (appointment.customerPackageId) {
    const pkg = (
      await tx
        .select({
          pricePaid: schema.customerPackages.pricePaid,
          sessionsTotal: schema.customerPackages.sessionsTotal,
        })
        .from(schema.customerPackages)
        .where(eq(schema.customerPackages.id, appointment.customerPackageId))
        .limit(1)
    )[0];
    if (pkg && pkg.sessionsTotal > 0) base = Number(pkg.pricePaid) / pkg.sessionsTotal;
  }

  const rules = await tx
    .select()
    .from(schema.commissionRules)
    .where(eq(schema.commissionRules.professionalId, appointment.professionalId));
  const specific = appointment.procedureId
    ? rules.find((r) => r.procedureId === appointment.procedureId)
    : undefined;
  const general = rules.find((r) => r.procedureId === null);

  let amount = 0;
  let source = "";
  if (specific) {
    amount = specific.kind === "fixed" ? Number(specific.value) : (base * Number(specific.value)) / 100;
    source = "regra específica";
  } else if (general) {
    amount = general.kind === "fixed" ? Number(general.value) : (base * Number(general.value)) / 100;
    source = "regra geral";
  } else if (appointment.procedureId) {
    const proc = (
      await tx
        .select({ pct: schema.procedures.commissionDefaultPct })
        .from(schema.procedures)
        .where(eq(schema.procedures.id, appointment.procedureId))
        .limit(1)
    )[0];
    if (proc?.pct) {
      amount = (base * Number(proc.pct)) / 100;
      source = "padrão do procedimento";
    }
  }
  if (amount <= 0) return;

  await tx
    .insert(schema.commissionEntries)
    .values({
      clinicId,
      professionalId: appointment.professionalId,
      appointmentId: appointment.id,
      customerId: appointment.customerId,
      procedureId: appointment.procedureId,
      baseAmount: base.toFixed(2),
      commissionAmount: amount.toFixed(2),
      ruleSource: source,
    })
    .onConflictDoNothing();
}

/** Efeitos do Compareceu: debita sessão de pacote OU cria a conta a receber. */
async function applyShowedEffects(
  tx: Tx,
  clinicId: string,
  appointment: AppointmentRow,
): Promise<void> {
  // Independentes da cobrança: materiais consumidos e comissão da profissional
  await applyStockConsumption(tx, clinicId, appointment);
  await applyCommission(tx, clinicId, appointment);

  if (appointment.customerPackageId) {
    // Sessão de pacote (pré-paga): debita, nunca cobra de novo
    const inserted = await tx
      .insert(schema.packageSessionUses)
      .values({
        clinicId,
        customerPackageId: appointment.customerPackageId,
        appointmentId: appointment.id,
      })
      .onConflictDoNothing()
      .returning({ id: schema.packageSessionUses.id });
    if (inserted[0]) {
      const [pkg] = await tx
        .update(schema.customerPackages)
        .set({ sessionsUsed: sql`${schema.customerPackages.sessionsUsed} + 1` })
        .where(eq(schema.customerPackages.id, appointment.customerPackageId))
        .returning({
          sessionsUsed: schema.customerPackages.sessionsUsed,
          sessionsTotal: schema.customerPackages.sessionsTotal,
        });
      if (pkg && pkg.sessionsUsed >= pkg.sessionsTotal) {
        await tx
          .update(schema.customerPackages)
          .set({ status: "completed" })
          .where(eq(schema.customerPackages.id, appointment.customerPackageId));
      }
    }
    return;
  }

  const price = appointment.price ? Number(appointment.price) : 0;
  if (price <= 0) return;

  // Idempotência: nunca duplica a conta do mesmo atendimento
  const existing = await tx
    .select({ id: schema.receivables.id })
    .from(schema.receivables)
    .where(
      and(
        eq(schema.receivables.appointmentId, appointment.id),
        sql`${schema.receivables.status} <> 'cancelled'`,
      ),
    )
    .limit(1);
  if (existing[0]) return;

  const customer = (
    await tx
      .select({ fullName: schema.customers.fullName })
      .from(schema.customers)
      .where(eq(schema.customers.id, appointment.customerId))
      .limit(1)
  )[0];
  const procedure = appointment.procedureId
    ? (
        await tx
          .select({ name: schema.procedures.name })
          .from(schema.procedures)
          .where(eq(schema.procedures.id, appointment.procedureId))
          .limit(1)
      )[0]
    : undefined;
  const tz = await clinicTimezone(tx, clinicId);
  const categoryId = await ensureCategory(tx, clinicId, "Procedimentos", "income");

  await tx.insert(schema.receivables).values({
    clinicId,
    customerId: appointment.customerId,
    appointmentId: appointment.id,
    categoryId,
    description: `${procedure?.name ?? "Atendimento"} — ${customer?.fullName ?? "Cliente"}`,
    grossAmount: appointment.price!,
    netAmount: appointment.price!,
    dueDate: todayISO(tz),
  });
}

/** Correção Compareceu→Faltou: devolve a sessão e cancela a conta pendente. */
async function revertShowedEffects(
  tx: Tx,
  clinicId: string,
  appointment: AppointmentRow,
): Promise<void> {
  void clinicId;
  // Materiais voltam ao estoque; comissão pendente morre (paga fica — decisão humana)
  await tx
    .delete(schema.stockMovements)
    .where(
      and(
        eq(schema.stockMovements.appointmentId, appointment.id),
        eq(schema.stockMovements.kind, "procedure_use"),
      ),
    );
  await tx
    .delete(schema.commissionEntries)
    .where(
      and(
        eq(schema.commissionEntries.appointmentId, appointment.id),
        eq(schema.commissionEntries.status, "pending"),
      ),
    );

  if (appointment.customerPackageId) {
    const reverted = await tx
      .update(schema.packageSessionUses)
      .set({ revertedAt: new Date() })
      .where(
        and(
          eq(schema.packageSessionUses.appointmentId, appointment.id),
          isNull(schema.packageSessionUses.revertedAt),
        ),
      )
      .returning({ id: schema.packageSessionUses.id });
    if (reverted[0]) {
      // Sessão devolvida: decrementa e reativa (pacote "completo" volta a ter saldo)
      await tx
        .update(schema.customerPackages)
        .set({
          sessionsUsed: sql`GREATEST(${schema.customerPackages.sessionsUsed} - 1, 0)`,
          status: "active",
        })
        .where(
          and(
            eq(schema.customerPackages.id, appointment.customerPackageId),
            sql`${schema.customerPackages.status} IN ('active','completed')`,
          ),
        );
    }
    return;
  }

  // Conta ainda pendente é cancelada; recebida fica (estorno é decisão humana)
  await tx
    .update(schema.receivables)
    .set({ status: "cancelled" })
    .where(
      and(
        eq(schema.receivables.appointmentId, appointment.id),
        eq(schema.receivables.status, "pending"),
      ),
    );
}

/** Encerra as runs pendentes de um agendamento (cancelou/remarcou/compareceu/confirmou). */
async function stopConfirmationRuns(
  tx: Tx,
  appointmentId: string,
  outcome: "cancelled" | "goal_reached",
  reason: string,
): Promise<void> {
  await tx
    .update(schema.automationRuns)
    .set({
      status: outcome,
      stopReason: reason,
      nextRunAt: null,
      finishedAt: new Date(),
    })
    .where(
      and(
        eq(schema.automationRuns.appointmentId, appointmentId),
        eq(schema.automationRuns.status, "active"),
      ),
    );
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

    // Pacote ativo cobre este procedimento? Sessão entra no pacote (sem nova cobrança)
    const activePackage = (
      await tx
        .select({ id: schema.customerPackages.id })
        .from(schema.customerPackages)
        .where(
          and(
            eq(schema.customerPackages.customerId, customerId),
            eq(schema.customerPackages.procedureId, input.procedureId),
            eq(schema.customerPackages.status, "active"),
            sql`${schema.customerPackages.sessionsUsed} < ${schema.customerPackages.sessionsTotal}`,
            sql`(${schema.customerPackages.expiresAt} IS NULL OR ${schema.customerPackages.expiresAt} >= current_date)`,
          ),
        )
        .limit(1)
    )[0];

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
          customerPackageId: activePackage?.id ?? null,
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
        await materializeConfirmationRuns(
          tx,
          auth.clinicId,
          created.id,
          customerId,
          startsAt,
          input.procedureId,
        );
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

    // Cadência de confirmação: confirmou → objetivo atingido; demais → cancela
    if (input.to === "confirmed") {
      await stopConfirmationRuns(tx, input.id, "goal_reached", "cliente confirmou");
    } else {
      await stopConfirmationRuns(tx, input.id, "cancelled", `status ${input.to}`);
    }

    // Efeitos financeiros/pacote (com correções simétricas showed ↔ no_show)
    const fullAppointment = (
      await tx
        .select()
        .from(schema.appointments)
        .where(eq(schema.appointments.id, input.id))
        .limit(1)
    )[0];
    if (fullAppointment) {
      if (input.to === "showed") {
        await applyShowedEffects(tx, auth.clinicId, fullAppointment);
        await materializeOutcomeRuns(tx, auth.clinicId, fullAppointment, "showed");
      } else if (input.to === "no_show") {
        if (current === "showed") {
          await revertShowedEffects(tx, auth.clinicId, fullAppointment);
        }
        await materializeOutcomeRuns(tx, auth.clinicId, fullAppointment, "no_show");
      }
    }

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
          customerPackageId: original.customerPackageId,
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

      // Cadência antiga morre; a nova nasce para o novo horário
      await stopConfirmationRuns(tx, input.id, "cancelled", "remarcado");
      await materializeConfirmationRuns(
        tx,
        auth.clinicId,
        created.id,
        original.customerId,
        startsAt,
        original.procedureId,
      );

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
