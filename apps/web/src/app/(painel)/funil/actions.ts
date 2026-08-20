"use server";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { schema } from "@clinicaos/db";
import type { Tx } from "@clinicaos/db";
import { authAction } from "@/lib/auth-action";
import { parseBRLDecimal } from "@/lib/format";

import { FUNNEL_STAGES } from "./stages";

export interface FunnelResult {
  ok: boolean;
  error?: string;
}

/** Garante a linha da etapa (colunas são fixas; a linha nasce quando alguém move). */
async function ensureStage(tx: Tx, clinicId: string, name: string): Promise<string> {
  const sort = FUNNEL_STAGES.indexOf(name as (typeof FUNNEL_STAGES)[number]);
  if (sort < 0) throw new Error("etapa desconhecida");
  const [created] = await tx
    .insert(schema.pipelineStages)
    .values({ clinicId, name, sort })
    .onConflictDoNothing()
    .returning({ id: schema.pipelineStages.id });
  if (created) return created.id;
  const existing = (
    await tx
      .select({ id: schema.pipelineStages.id })
      .from(schema.pipelineStages)
      .where(eq(schema.pipelineStages.name, name))
      .limit(1)
  )[0];
  if (!existing) throw new Error("falha ao garantir etapa");
  return existing.id;
}

const brlOrNull = z.string().transform((v, ctx) => {
  const parsed = v.trim() ? parseBRLDecimal(v) : null;
  if (v.trim() && parsed === null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Valor inválido — use só números, ex.: 1500,00" });
    return z.NEVER;
  }
  return parsed;
});

const createDealSchema = z.object({
  customerId: z.string().uuid(),
  value: brlOrNull.nullable(),
  notes: z.string().trim().max(200).optional(),
});

export const createDeal = authAction({
  permission: "funnel.manage",
  schema: createDealSchema,
  handler: async (input, { auth, tx }): Promise<FunnelResult> => {
    // Cliente precisa ser DESTA clínica e estar viva (RLS filtra; FK não)
    const customer = (
      await tx
        .select({ id: schema.customers.id })
        .from(schema.customers)
        .where(
          and(
            eq(schema.customers.id, input.customerId),
            sql`deleted_at IS NULL AND merged_into_id IS NULL`,
          ),
        )
        .limit(1)
    )[0];
    if (!customer) return { ok: false, error: "Cliente não encontrada." };

    const [created] = await tx
      .insert(schema.deals)
      .values({
        clinicId: auth.clinicId,
        customerId: input.customerId,
        value: input.value,
        notes: input.notes || null,
        source: "manual",
        createdBy: auth.userId,
      })
      .onConflictDoNothing()
      .returning({ id: schema.deals.id });
    if (!created) {
      return { ok: false, error: "Essa cliente já tem uma negociação aberta no funil." };
    }
    revalidatePath("/funil");
    return { ok: true };
  },
});

const moveDealSchema = z.object({
  dealId: z.string().uuid(),
  stageName: z.enum(FUNNEL_STAGES),
});

export const moveDeal = authAction({
  permission: "funnel.manage",
  schema: moveDealSchema,
  handler: async (input, { auth, tx }): Promise<FunnelResult> => {
    const stageId =
      input.stageName === FUNNEL_STAGES[0]
        ? null
        : await ensureStage(tx, auth.clinicId, input.stageName);
    const updated = await tx
      .update(schema.deals)
      .set({ stageId, updatedAt: new Date() })
      .where(and(eq(schema.deals.id, input.dealId), eq(schema.deals.status, "open")))
      .returning({ id: schema.deals.id });
    if (!updated[0]) return { ok: false, error: "Negociação não encontrada ou já fechada." };
    revalidatePath("/funil");
    return { ok: true };
  },
});

const updateValueSchema = z.object({
  dealId: z.string().uuid(),
  value: z.string().transform((v, ctx) => {
    const parsed = v.trim() ? parseBRLDecimal(v) : null;
    if (v.trim() && parsed === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Valor inválido" });
      return z.NEVER;
    }
    return parsed;
  }),
});

export const updateDealValue = authAction({
  permission: "funnel.manage",
  schema: updateValueSchema,
  handler: async (input, { tx }): Promise<FunnelResult> => {
    const updated = await tx
      .update(schema.deals)
      .set({ value: input.value, updatedAt: new Date() })
      .where(and(eq(schema.deals.id, input.dealId), eq(schema.deals.status, "open")))
      .returning({ id: schema.deals.id });
    if (!updated[0]) return { ok: false, error: "Negociação não encontrada ou já fechada." };
    revalidatePath("/funil");
    return { ok: true };
  },
});

const closeDealSchema = z.object({
  dealId: z.string().uuid(),
  outcome: z.enum(["won", "lost"]),
  lostReason: z.string().trim().max(120).optional(),
});

export const closeDeal = authAction({
  permission: "funnel.manage",
  schema: closeDealSchema,
  handler: async (input, { tx }): Promise<FunnelResult> => {
    const now = new Date();
    const updated = await tx
      .update(schema.deals)
      .set(
        input.outcome === "won"
          ? { status: "won", wonAt: now, updatedAt: now }
          : { status: "lost", lostAt: now, lostReason: input.lostReason || null, updatedAt: now },
      )
      .where(and(eq(schema.deals.id, input.dealId), eq(schema.deals.status, "open")))
      .returning({ id: schema.deals.id, customerId: schema.deals.customerId });
    if (!updated[0]) return { ok: false, error: "Negociação não encontrada ou já fechada." };

    // Ganhou = virou cliente de verdade (lead deixa de ser lead)
    if (input.outcome === "won") {
      await tx
        .update(schema.customers)
        .set({ status: "active" })
        .where(
          and(
            eq(schema.customers.id, updated[0].customerId),
            eq(schema.customers.status, "lead"),
          ),
        );
    }
    revalidatePath("/funil");
    return { ok: true };
  },
});
