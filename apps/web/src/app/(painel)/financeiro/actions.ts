"use server";

import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { todayISO } from "@clinicaos/core/timezone";
import { schema } from "@clinicaos/db";
import { authAction } from "@/lib/auth-action";
import { parseBRLDecimal } from "@/lib/format";

export interface FinanceResult {
  ok: boolean;
  error?: string;
}

const receiveSchema = z.object({
  id: z.string().uuid(),
  method: z.enum(["cash", "pix", "debit", "credit", "transfer", "boleto"]),
});

export const confirmReceivable = authAction({
  permission: "finance.write",
  schema: receiveSchema,
  handler: async (input, { tx }): Promise<FinanceResult> => {
    const updated = await tx
      .update(schema.receivables)
      .set({
        status: "received",
        method: input.method,
        receivedAt: todayISO("America/Sao_Paulo"),
      })
      .where(
        and(eq(schema.receivables.id, input.id), eq(schema.receivables.status, "pending")),
      )
      .returning({ id: schema.receivables.id });
    if (!updated[0]) return { ok: false, error: "Conta não encontrada ou já recebida." };
    revalidatePath("/financeiro");
    return { ok: true };
  },
});

export const cancelReceivable = authAction({
  permission: "finance.write",
  schema: z.object({ id: z.string().uuid() }),
  handler: async (input, { tx }): Promise<FinanceResult> => {
    await tx
      .update(schema.receivables)
      .set({ status: "cancelled" })
      .where(
        and(eq(schema.receivables.id, input.id), eq(schema.receivables.status, "pending")),
      );
    revalidatePath("/financeiro");
    return { ok: true };
  },
});

const payableSchema = z.object({
  description: z.string().trim().min(2, "Descreva a despesa"),
  supplier: z.string().trim().transform((v) => v || null),
  amount: z.string().transform((v, ctx) => {
    const parsed = parseBRLDecimal(v);
    if (parsed === null || Number(parsed) <= 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Valor inválido" });
      return z.NEVER;
    }
    return parsed;
  }),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Informe a data"),
  categoryName: z.string().trim().min(1, "Escolha a categoria"),
});

export const createPayable = authAction({
  permission: "finance.write",
  schema: payableSchema,
  handler: async (input, { auth, tx }): Promise<FinanceResult> => {
    // Categoria de despesa: cria sob demanda
    let category = (
      await tx
        .select({ id: schema.financeCategories.id })
        .from(schema.financeCategories)
        .where(
          and(
            eq(schema.financeCategories.clinicId, auth.clinicId),
            eq(schema.financeCategories.kind, "expense"),
            eq(schema.financeCategories.name, input.categoryName),
          ),
        )
        .limit(1)
    )[0];
    if (!category) {
      const [created] = await tx
        .insert(schema.financeCategories)
        .values({ clinicId: auth.clinicId, name: input.categoryName, kind: "expense" })
        .onConflictDoNothing()
        .returning({ id: schema.financeCategories.id });
      category = created;
    }

    await tx.insert(schema.payables).values({
      clinicId: auth.clinicId,
      description: input.description,
      supplier: input.supplier,
      categoryId: category?.id ?? null,
      amount: input.amount,
      dueDate: input.dueDate,
      createdBy: auth.userId,
    });
    revalidatePath("/financeiro");
    return { ok: true };
  },
});

const ruleSchema = z.object({
  professionalId: z.string().uuid(),
  procedureId: z
    .string()
    .transform((v) => (v && v !== "all" ? v : null))
    .nullable(),
  value: z.string().transform((v, ctx) => {
    const parsed = parseBRLDecimal(v);
    if (parsed === null || Number(parsed) <= 0 || Number(parsed) > 100) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Percentual entre 0 e 100" });
      return z.NEVER;
    }
    return parsed;
  }),
});

export const saveCommissionRule = authAction({
  permission: "commissions.manage",
  schema: ruleSchema,
  handler: async (input, { auth, tx }): Promise<FinanceResult> => {
    // Upsert manual: o índice único usa COALESCE (procedure_id NULL = geral)
    const existing = (
      await tx
        .select({ id: schema.commissionRules.id })
        .from(schema.commissionRules)
        .where(
          and(
            eq(schema.commissionRules.professionalId, input.professionalId),
            input.procedureId
              ? eq(schema.commissionRules.procedureId, input.procedureId)
              : isNull(schema.commissionRules.procedureId),
          ),
        )
        .limit(1)
    )[0];
    if (existing) {
      // Só o valor: nunca converte silenciosamente uma regra fixa em percentual
      await tx
        .update(schema.commissionRules)
        .set({ value: input.value })
        .where(eq(schema.commissionRules.id, existing.id));
    } else {
      await tx.insert(schema.commissionRules).values({
        clinicId: auth.clinicId,
        professionalId: input.professionalId,
        procedureId: input.procedureId,
        kind: "pct",
        value: input.value,
        createdBy: auth.userId,
      });
    }
    revalidatePath("/financeiro");
    return { ok: true };
  },
});

export const deleteCommissionRule = authAction({
  permission: "commissions.manage",
  schema: z.object({ id: z.string().uuid() }),
  handler: async (input, { tx }): Promise<FinanceResult> => {
    await tx.delete(schema.commissionRules).where(eq(schema.commissionRules.id, input.id));
    revalidatePath("/financeiro");
    return { ok: true };
  },
});

export const payCommissions = authAction({
  permission: "commissions.manage",
  schema: z.object({
    professionalId: z.string().uuid(),
    // Paga EXATAMENTE o que a tela mostrou (nunca arrasta meses anteriores junto)
    entryIds: z.array(z.string().uuid()).min(1).max(500),
  }),
  handler: async (input, { auth, tx }): Promise<FinanceResult> => {
    // Trava a apuração da profissional contra pagamento duplo concorrente
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`commission-pay-${input.professionalId}`}))`,
    );

    // Claim atômico: só o que AINDA está pendente entra no pagamento — um
    // "Faltou" simultâneo não deixa valor fantasma na despesa
    const claimed = await tx
      .update(schema.commissionEntries)
      .set({ status: "paid" })
      .where(
        and(
          inArray(schema.commissionEntries.id, input.entryIds),
          eq(schema.commissionEntries.professionalId, input.professionalId),
          eq(schema.commissionEntries.status, "pending"),
        ),
      )
      .returning({
        id: schema.commissionEntries.id,
        amount: schema.commissionEntries.commissionAmount,
      });
    if (claimed.length === 0) {
      return { ok: false, error: "Nenhuma comissão pendente para pagar." };
    }
    const pending = claimed;
    const total = pending.reduce((sum, e) => sum + Number(e.amount), 0);

    const professional = (
      await tx
        .select({ name: schema.professionals.name })
        .from(schema.professionals)
        .where(eq(schema.professionals.id, input.professionalId))
        .limit(1)
    )[0];

    // Vira despesa paga no financeiro (categoria Comissões)
    let category = (
      await tx
        .select({ id: schema.financeCategories.id })
        .from(schema.financeCategories)
        .where(
          and(
            eq(schema.financeCategories.clinicId, auth.clinicId),
            eq(schema.financeCategories.kind, "expense"),
            eq(schema.financeCategories.name, "Comissões"),
          ),
        )
        .limit(1)
    )[0];
    if (!category) {
      category = (
        await tx
          .insert(schema.financeCategories)
          .values({ clinicId: auth.clinicId, name: "Comissões", kind: "expense" })
          .onConflictDoNothing()
          .returning({ id: schema.financeCategories.id })
      )[0];
    }
    const hoje = todayISO("America/Sao_Paulo");
    const [payable] = await tx
      .insert(schema.payables)
      .values({
        clinicId: auth.clinicId,
        description: `Comissões — ${professional?.name ?? "profissional"} (${pending.length} atendimento${pending.length === 1 ? "" : "s"})`,
        categoryId: category?.id ?? null,
        amount: total.toFixed(2),
        dueDate: hoje,
        paidAt: hoje,
        status: "paid",
        createdBy: auth.userId,
      })
      .returning({ id: schema.payables.id });

    const [payment] = await tx
      .insert(schema.commissionPayments)
      .values({
        clinicId: auth.clinicId,
        professionalId: input.professionalId,
        totalAmount: total.toFixed(2),
        entryCount: pending.length,
        payableId: payable?.id ?? null,
        createdBy: auth.userId,
      })
      .returning({ id: schema.commissionPayments.id });

    await tx
      .update(schema.commissionEntries)
      .set({ paymentId: payment?.id ?? null })
      .where(
        inArray(
          schema.commissionEntries.id,
          pending.map((e) => e.id),
        ),
      );

    revalidatePath("/financeiro");
    return { ok: true };
  },
});

export const markPayablePaid = authAction({
  permission: "finance.write",
  schema: z.object({ id: z.string().uuid() }),
  handler: async (input, { tx }): Promise<FinanceResult> => {
    await tx
      .update(schema.payables)
      .set({ status: "paid", paidAt: todayISO("America/Sao_Paulo") })
      .where(and(eq(schema.payables.id, input.id), eq(schema.payables.status, "pending")));
    revalidatePath("/financeiro");
    return { ok: true };
  },
});
