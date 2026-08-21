"use server";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { addDaysISO, todayISO } from "@clinicaos/core/timezone";
import { schema } from "@clinicaos/db";
import { authAction } from "@/lib/auth-action";
import { parseBRLDecimal } from "@/lib/format";

export interface StockResult {
  ok: boolean;
  error?: string;
}

const qty = (label: string) =>
  z.string().transform((v, ctx) => {
    // Formato pt-BR completo: "1.000" é MIL, "1.000,50" também funciona
    // (Number("1.000") daria 1 e o estoque sairia 1000x menor)
    const negative = v.trim().startsWith("-");
    const parsed = parseBRLDecimal(v.replace("-", ""));
    const n = parsed === null ? NaN : Number(parsed) * (negative ? -1 : 1);
    if (!Number.isFinite(n) || Math.abs(n) > 100_000) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: label });
      return z.NEVER;
    }
    return n;
  });

/** Custo em BRL: vazio = null; preenchido errado = erro (nunca ignora em silêncio). */
const brlOrNull = (label: string) =>
  z.string().transform((v, ctx) => {
    if (!v.trim()) return null;
    const parsed = parseBRLDecimal(v);
    if (parsed === null || Number(parsed) > 1_000_000) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: label });
      return z.NEVER;
    }
    return parsed;
  });

const itemSchema = z.object({
  name: z.string().trim().min(2, "Dê um nome ao item").max(80),
  unit: z.string().trim().min(1).max(10),
  minQuantity: qty("Quantidade mínima inválida"),
  cost: brlOrNull("Custo unitário inválido"),
});

export const createStockItem = authAction({
  permission: "stock.manage",
  schema: itemSchema,
  handler: async (input, { auth, tx }): Promise<StockResult> => {
    if (input.minQuantity < 0) return { ok: false, error: "Mínimo não pode ser negativo." };
    // "toxina" e "Toxina" são o mesmo item para a dona — evita duplicata de caixa
    const similar = await tx.execute(sql`
      SELECT name FROM stock_items WHERE lower(name) = lower(${input.name}) LIMIT 1
    `);
    if ((similar.rowCount ?? 0) > 0) {
      return {
        ok: false,
        error: `Já existe o item "${(similar.rows[0] as { name: string }).name}" — use ele ou escolha outro nome.`,
      };
    }
    const [created] = await tx
      .insert(schema.stockItems)
      .values({
        clinicId: auth.clinicId,
        name: input.name,
        unit: input.unit,
        minQuantity: input.minQuantity.toFixed(2),
        cost: input.cost,
        createdBy: auth.userId,
      })
      .onConflictDoNothing()
      .returning({ id: schema.stockItems.id });
    if (!created) return { ok: false, error: "Já existe um item com esse nome." };
    revalidatePath("/estoque");
    return { ok: true };
  },
});

const movementSchema = z.object({
  stockItemId: z.string().uuid(),
  kind: z.enum(["purchase", "adjustment", "loss"]),
  quantity: qty("Quantidade inválida"),
  unitCost: brlOrNull("Custo unitário inválido"),
  notes: z.string().trim().max(200).optional(),
  createPayable: z.boolean().optional(),
  supplier: z.string().trim().max(80).optional(),
});

export const createStockMovement = authAction({
  permission: "stock.manage",
  schema: movementSchema,
  handler: async (input, { auth, tx }): Promise<StockResult> => {
    if (input.quantity === 0) return { ok: false, error: "Quantidade não pode ser zero." };
    // Nunca falha em silêncio: pediu conta a pagar, precisa do custo
    if (
      input.kind === "purchase" &&
      input.createPayable &&
      (!input.unitCost || Number(input.unitCost) <= 0)
    ) {
      return {
        ok: false,
        error: "Informe o custo unitário para gerar a conta a pagar.",
      };
    }
    // Sinal pelo tipo: compra entra, perda sai; ajuste aceita os dois
    const signed =
      input.kind === "purchase"
        ? Math.abs(input.quantity)
        : input.kind === "loss"
          ? -Math.abs(input.quantity)
          : input.quantity;

    const item = (
      await tx
        .select({ id: schema.stockItems.id, name: schema.stockItems.name })
        .from(schema.stockItems)
        .where(eq(schema.stockItems.id, input.stockItemId))
        .limit(1)
    )[0];
    if (!item) return { ok: false, error: "Item não encontrado." };

    // Saída maior que o saldo: avisa em vez de deixar o estoque negativo mudo
    if (signed < 0) {
      const balance = await tx.execute(sql`
        SELECT COALESCE(sum(quantity), 0) AS n FROM stock_movements
        WHERE stock_item_id = ${item.id}
      `);
      const current = Number((balance.rows[0] as { n: string }).n);
      if (current + signed < 0) {
        return {
          ok: false,
          error: `Saldo atual é ${current} — não dá para tirar ${Math.abs(signed)}. Confira a quantidade ou lance um ajuste de entrada antes.`,
        };
      }
    }

    await tx.insert(schema.stockMovements).values({
      clinicId: auth.clinicId,
      stockItemId: item.id,
      kind: input.kind,
      quantity: signed.toFixed(2),
      unitCost: input.kind === "purchase" ? input.unitCost : null,
      notes: input.notes || null,
      createdBy: auth.userId,
    });

    // Compra pode virar conta a pagar com um clique (lacuna estoque→financeiro)
    if (input.kind === "purchase" && input.createPayable && input.unitCost) {
      const total = Math.abs(input.quantity) * Number(input.unitCost);
      if (total > 0) {
        let category = (
          await tx
            .select({ id: schema.financeCategories.id })
            .from(schema.financeCategories)
            .where(
              and(
                eq(schema.financeCategories.clinicId, auth.clinicId),
                eq(schema.financeCategories.kind, "expense"),
                eq(schema.financeCategories.name, "Materiais"),
              ),
            )
            .limit(1)
        )[0];
        if (!category) {
          category = (
            await tx
              .insert(schema.financeCategories)
              .values({ clinicId: auth.clinicId, name: "Materiais", kind: "expense" })
              .onConflictDoNothing()
              .returning({ id: schema.financeCategories.id })
          )[0];
        }
        const tzToday = todayISO("America/Sao_Paulo");
        await tx.insert(schema.payables).values({
          clinicId: auth.clinicId,
          description: `Compra de ${item.name} (${Math.abs(input.quantity)})`,
          supplier: input.supplier || null,
          categoryId: category?.id ?? null,
          amount: total.toFixed(2),
          dueDate: addDaysISO(tzToday, 14),
          createdBy: auth.userId,
        });
      }
    }

    revalidatePath("/estoque");
    revalidatePath("/financeiro");
    return { ok: true };
  },
});

const supplySchema = z.object({
  procedureId: z.string().uuid(),
  stockItemId: z.string().uuid(),
  quantityPerSession: qty("Quantidade inválida"),
});

export const saveProcedureSupply = authAction({
  permission: "stock.manage",
  schema: supplySchema,
  handler: async (input, { auth, tx }): Promise<StockResult> => {
    if (input.quantityPerSession <= 0) {
      return { ok: false, error: "Informe quanto o procedimento consome por sessão." };
    }
    await tx
      .insert(schema.procedureSupplies)
      .values({
        clinicId: auth.clinicId,
        procedureId: input.procedureId,
        stockItemId: input.stockItemId,
        quantityPerSession: input.quantityPerSession.toFixed(2),
      })
      .onConflictDoUpdate({
        target: [schema.procedureSupplies.procedureId, schema.procedureSupplies.stockItemId],
        set: { quantityPerSession: input.quantityPerSession.toFixed(2) },
      });
    revalidatePath("/estoque");
    return { ok: true };
  },
});

export const deleteProcedureSupply = authAction({
  permission: "stock.manage",
  schema: z.object({ id: z.string().uuid() }),
  handler: async (input, { tx }): Promise<StockResult> => {
    await tx.delete(schema.procedureSupplies).where(eq(schema.procedureSupplies.id, input.id));
    revalidatePath("/estoque");
    return { ok: true };
  },
});
