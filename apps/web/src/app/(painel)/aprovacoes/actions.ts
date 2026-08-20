"use server";

import { and, eq } from "drizzle-orm";
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

    const edited =
      input.editedBody && input.editedBody !== approval.generatedBody
        ? input.editedBody
        : null;
    if (edited !== null && edited.length === 0) {
      return { ok: false, error: "A mensagem não pode ficar vazia." };
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

    await tx
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
      );

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
    const pending = await tx
      .select({ id: schema.approvals.id, messageId: schema.approvals.messageId, body: schema.approvals.generatedBody })
      .from(schema.approvals)
      .where(eq(schema.approvals.status, "pending"));

    let approved = 0;
    for (const item of pending) {
      await tx
        .update(schema.approvals)
        .set({ status: "approved", reviewedBy: auth.userId, reviewedAt: new Date() })
        .where(eq(schema.approvals.id, item.id));
      await tx
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
        );
      approved++;
    }

    revalidatePath("/aprovacoes");
    revalidatePath("/inicio");
    return { ok: true, approved };
  },
});
