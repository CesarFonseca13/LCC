"use server";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { schema } from "@clinicaos/db";
import { authAction } from "@/lib/auth-action";

export interface ApprovalResult {
  ok: boolean;
  error?: string;
  approved?: number;
}

const reviewSchema = z.object({
  id: z.string().uuid(),
  editedBody: z.string().trim().optional(),
});

export const approveMessage = authAction({
  permission: "approvals.review",
  schema: reviewSchema,
  handler: async (input, { auth, tx }): Promise<ApprovalResult> => {
    const approval = (
      await tx
        .select()
        .from(schema.approvals)
        .where(and(eq(schema.approvals.id, input.id), eq(schema.approvals.status, "pending")))
        .limit(1)
    )[0];
    if (!approval) return { ok: false, error: "Aprovação não encontrada ou já revisada." };

    // Vencida não sai (lembrete de horário que já passou vira spam sem sentido)
    if (approval.expiresAt && approval.expiresAt <= new Date()) {
      await tx
        .update(schema.approvals)
        .set({ status: "expired" })
        .where(eq(schema.approvals.id, input.id));
      await tx
        .update(schema.messages)
        .set({ status: "expired" })
        .where(
          and(
            eq(schema.messages.id, approval.messageId),
            eq(schema.messages.status, "pending_approval"),
          ),
        );
      revalidatePath("/aprovacoes");
      return { ok: false, error: "Essa mensagem venceu (o horário já passou) — foi removida da fila." };
    }

    // Opt-out/bloqueio SEMPRE vence a fila: pediu para parar, não recebe
    const blocked = (
      await tx
        .select({ id: schema.customers.id })
        .from(schema.customers)
        .where(
          and(
            eq(schema.customers.id, approval.customerId),
            sql`(automations_blocked OR opted_out_at IS NOT NULL OR deleted_at IS NOT NULL)`,
          ),
        )
        .limit(1)
    )[0];
    if (blocked) {
      await tx
        .update(schema.approvals)
        .set({ status: "rejected", reviewedBy: auth.userId, reviewedAt: new Date() })
        .where(eq(schema.approvals.id, input.id));
      await tx
        .update(schema.messages)
        .set({ status: "rejected" })
        .where(eq(schema.messages.id, approval.messageId));
      revalidatePath("/aprovacoes");
      return {
        ok: false,
        error: "Essa cliente pediu para não receber mensagens — a aprovação foi descartada.",
      };
    }

    if (input.editedBody !== undefined && input.editedBody.length === 0) {
      return {
        ok: false,
        error: "A mensagem não pode ficar vazia — escreva o texto ou cancele a edição.",
      };
    }
    const edited =
      input.editedBody !== undefined && input.editedBody !== approval.generatedBody
        ? input.editedBody
        : null;

    // Primeiro a mensagem (com guarda de status) — se ela já expirou/enviou
    // numa corrida, a aprovação NÃO é marcada como aprovada
    const queued = await tx
      .update(schema.messages)
      .set({
        status: "queued",
        body: edited ?? approval.generatedBody,
        // Jitter: nunca dispara em rajada nem em segundo redondo
        scheduledFor: new Date(Date.now() + 3_000 + Math.floor(Math.random() * 15_000)),
      })
      .where(
        and(
          eq(schema.messages.id, approval.messageId),
          eq(schema.messages.status, "pending_approval"),
        ),
      )
      .returning({ id: schema.messages.id });
    if (!queued[0]) {
      revalidatePath("/aprovacoes");
      return { ok: false, error: "Essa mensagem mudou de estado (expirou?) — recarregue a fila." };
    }

    await tx
      .update(schema.approvals)
      .set({
        status: edited ? "edited_approved" : "approved",
        editedBody: edited,
        reviewedBy: auth.userId,
        reviewedAt: new Date(),
      })
      .where(eq(schema.approvals.id, input.id));

    revalidatePath("/aprovacoes");
    revalidatePath("/inicio");
    return { ok: true, approved: 1 };
  },
});

export const rejectMessage = authAction({
  permission: "approvals.review",
  schema: z.object({ id: z.string().uuid() }),
  handler: async (input, { auth, tx }): Promise<ApprovalResult> => {
    const approval = (
      await tx
        .select()
        .from(schema.approvals)
        .where(and(eq(schema.approvals.id, input.id), eq(schema.approvals.status, "pending")))
        .limit(1)
    )[0];
    if (!approval) return { ok: false, error: "Aprovação não encontrada ou já revisada." };

    await tx
      .update(schema.approvals)
      .set({ status: "rejected", reviewedBy: auth.userId, reviewedAt: new Date() })
      .where(eq(schema.approvals.id, input.id));
    await tx
      .update(schema.messages)
      .set({ status: "rejected" })
      .where(eq(schema.messages.id, approval.messageId));

    revalidatePath("/aprovacoes");
    revalidatePath("/inicio");
    return { ok: true };
  },
});

export const approveAllPending = authAction({
  permission: "approvals.review",
  schema: z.object({}),
  handler: async (_input, { auth, tx }): Promise<ApprovalResult> => {
    // Vencidas e clientes que pediram para parar saem ANTES do lote
    const pending = await tx
      .select({
        id: schema.approvals.id,
        messageId: schema.approvals.messageId,
        expiresAt: schema.approvals.expiresAt,
        customerBlocked: sql<boolean>`EXISTS (
          SELECT 1 FROM customers c WHERE c.id = approvals.customer_id
          AND (c.automations_blocked OR c.opted_out_at IS NOT NULL OR c.deleted_at IS NOT NULL)
        )`,
      })
      .from(schema.approvals)
      .where(eq(schema.approvals.status, "pending"));

    const now = new Date();
    let approved = 0;
    for (const item of pending) {
      if ((item.expiresAt && item.expiresAt <= now) || item.customerBlocked) {
        const status = item.customerBlocked ? "rejected" : "expired";
        await tx
          .update(schema.approvals)
          .set({ status, reviewedBy: auth.userId, reviewedAt: now })
          .where(and(eq(schema.approvals.id, item.id), eq(schema.approvals.status, "pending")));
        await tx
          .update(schema.messages)
          .set({ status })
          .where(
            and(eq(schema.messages.id, item.messageId), eq(schema.messages.status, "pending_approval")),
          );
        continue;
      }
      // Mensagem primeiro (guarda de corrida) — só então a aprovação
      const queued = await tx
        .update(schema.messages)
        .set({
          status: "queued",
          // Espalha os envios do lote (jitter incremental: nada de rajada)
          scheduledFor: new Date(
            Date.now() + 3_000 + approved * 20_000 + Math.floor(Math.random() * 10_000),
          ),
        })
        .where(
          and(
            eq(schema.messages.id, item.messageId),
            eq(schema.messages.status, "pending_approval"),
          ),
        )
        .returning({ id: schema.messages.id });
      if (!queued[0]) continue;
      await tx
        .update(schema.approvals)
        .set({ status: "approved", reviewedBy: auth.userId, reviewedAt: now })
        .where(and(eq(schema.approvals.id, item.id), eq(schema.approvals.status, "pending")));
      approved++;
    }

    revalidatePath("/aprovacoes");
    revalidatePath("/inicio");
    return { ok: true, approved };
  },
});
