"use server";

import { and, eq } from "drizzle-orm";
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
