"use server";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { schema } from "@clinicaos/db";
import { authAction } from "@/lib/auth-action";

export interface InboxResult {
  ok: boolean;
  error?: string;
}

/** Enviar mensagem manual: digitar no inbox também assume a conversa. */
export const sendManualMessage = authAction({
  permission: "inbox.access",
  schema: z.object({
    conversationId: z.string().uuid(),
    body: z.string().trim().min(1, "Digite a mensagem"),
  }),
  handler: async (input, { auth, tx }): Promise<InboxResult> => {
    const conversation = (
      await tx
        .select({ id: schema.conversations.id })
        .from(schema.conversations)
        .where(eq(schema.conversations.id, input.conversationId))
        .limit(1)
    )[0];
    if (!conversation) return { ok: false, error: "Conversa não encontrada." };

    await tx.insert(schema.messages).values({
      clinicId: auth.clinicId,
      conversationId: input.conversationId,
      direction: "outbound",
      author: "human",
      authorUserId: auth.userId,
      body: input.body,
      status: "queued", // envio manual sai na próxima varredura (≤3s)
    });
    await tx
      .update(schema.conversations)
      .set({ mode: "human", assignedUserId: auth.userId, lastMessageAt: new Date() })
      .where(eq(schema.conversations.id, input.conversationId));

    revalidatePath("/whatsapp");
    return { ok: true };
  },
});

export const setConversationMode = authAction({
  permission: "inbox.access",
  schema: z.object({
    conversationId: z.string().uuid(),
    mode: z.enum(["ai", "human"]),
  }),
  handler: async (input, { auth, tx }): Promise<InboxResult> => {
    await tx
      .update(schema.conversations)
      .set({
        mode: input.mode,
        assignedUserId: input.mode === "human" ? auth.userId : null,
      })
      .where(eq(schema.conversations.id, input.conversationId));
    revalidatePath("/whatsapp");
    return { ok: true };
  },
});

export const markConversationRead = authAction({
  permission: "inbox.access",
  schema: z.object({ conversationId: z.string().uuid() }),
  handler: async (input, { tx }): Promise<InboxResult> => {
    await tx
      .update(schema.conversations)
      .set({ unreadCount: 0 })
      .where(
        and(
          eq(schema.conversations.id, input.conversationId),
          sql`${schema.conversations.unreadCount} > 0`,
        ),
      );
    return { ok: true };
  },
});
