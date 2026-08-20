"use server";

import { and, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  outreachMessage,
  recomputeScores,
  schema,
  type ScoreMetrics,
  type SuggestedKind,
} from "@clinicaos/db";
import { authAction } from "@/lib/auth-action";

export interface IntelligenceResult {
  ok: boolean;
  error?: string;
  computed?: number;
}

/** Recalcula os scores da clínica sob demanda (botão "Atualizar análise"). */
export const refreshScores = authAction({
  permission: "intelligence.read",
  schema: z.object({}),
  handler: async (_input, { auth, tx }): Promise<IntelligenceResult> => {
    const clinic = (
      await tx
        .select({ timezone: schema.clinics.timezone })
        .from(schema.clinics)
        .where(eq(schema.clinics.id, auth.clinicId))
        .limit(1)
    )[0];
    const computed = await recomputeScores(
      tx,
      auth.clinicId,
      clinic?.timezone ?? "America/Sao_Paulo",
    );
    revalidatePath("/inteligencia");
    revalidatePath("/relatorios");
    return { ok: true, computed };
  },
});

/**
 * "Preparar mensagem": transforma a ação sugerida em uma mensagem humanizada
 * que SEMPRE passa pela fila de Aprovações — a Inteligência nunca envia sozinha.
 */
export const prepareOutreach = authAction({
  permission: "intelligence.read",
  schema: z.object({ customerId: z.string().uuid() }),
  handler: async (input, { auth, tx }): Promise<IntelligenceResult> => {
    // Serializa preparos concorrentes para a mesma cliente (duplo clique, duas abas)
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`outreach-${input.customerId}`}))`,
    );

    const customer = (
      await tx
        .select({
          id: schema.customers.id,
          fullName: schema.customers.fullName,
          phoneE164: schema.customers.phoneE164,
          automationsBlocked: schema.customers.automationsBlocked,
          optedOutAt: schema.customers.optedOutAt,
        })
        .from(schema.customers)
        .where(
          and(
            eq(schema.customers.id, input.customerId),
            isNull(schema.customers.deletedAt),
            isNull(schema.customers.mergedIntoId),
          ),
        )
        .limit(1)
    )[0];
    if (!customer) return { ok: false, error: "Cliente não encontrada." };
    if (customer.automationsBlocked || customer.optedOutAt) {
      return {
        ok: false,
        error: "Essa cliente pediu para não receber mensagens automáticas.",
      };
    }

    const scoreRow = (
      await tx
        .select({
          suggestedKind: schema.customerScores.suggestedKind,
          suggestedAction: schema.customerScores.suggestedAction,
          metrics: schema.customerScores.metrics,
        })
        .from(schema.customerScores)
        .where(eq(schema.customerScores.customerId, input.customerId))
        .limit(1)
    )[0];
    if (!scoreRow || scoreRow.suggestedKind === "none") {
      return { ok: false, error: "Não há ação sugerida para essa cliente agora." };
    }

    // O snapshot pode ter até 24h: reconfere AGORA se a cliente já marcou horário
    // (convidar quem acabou de agendar é o tipo de escorregão que entrega um sistema)
    if (scoreRow.suggestedKind !== "package_renewal") {
      const upcoming = (
        await tx
          .select({ id: schema.appointments.id })
          .from(schema.appointments)
          .where(
            and(
              eq(schema.appointments.customerId, input.customerId),
              inArray(schema.appointments.status, ["scheduled", "confirmed"]),
              gt(schema.appointments.startsAt, new Date()),
            ),
          )
          .limit(1)
      )[0];
      if (upcoming) {
        return {
          ok: false,
          error:
            "Essa cliente já tem um horário marcado — clique em “Atualizar análise” para atualizar a lista.",
        };
      }
    }

    const instance = (
      await tx
        .select({ id: schema.whatsappInstances.id, status: schema.whatsappInstances.status })
        .from(schema.whatsappInstances)
        .where(eq(schema.whatsappInstances.clinicId, auth.clinicId))
        .limit(1)
    )[0];
    if (!instance || instance.status !== "connected") {
      return {
        ok: false,
        error: "Conecte o WhatsApp da clínica primeiro (em Configurações).",
      };
    }

    // Nunca empilha duas sugestões para a mesma cliente na fila
    const dup = (
      await tx
        .select({ id: schema.approvals.id })
        .from(schema.approvals)
        .where(
          and(
            eq(schema.approvals.customerId, input.customerId),
            eq(schema.approvals.automationId, "intelligence_suggestion"),
            eq(schema.approvals.status, "pending"),
          ),
        )
        .limit(1)
    )[0];
    if (dup) {
      return {
        ok: false,
        error: "Já existe uma mensagem para essa cliente aguardando em Aprovações.",
      };
    }

    const metrics = scoreRow.metrics as unknown as ScoreMetrics;
    const body = outreachMessage(scoreRow.suggestedKind as SuggestedKind, {
      fullName: customer.fullName,
      favoriteProcedure: metrics.overdueProcedure ?? metrics.favoriteProcedure,
      packageName: metrics.packageName,
    });

    const remoteJid = `${customer.phoneE164.replace("+", "")}@s.whatsapp.net`;
    let conversation = (
      await tx
        .select({ id: schema.conversations.id })
        .from(schema.conversations)
        .where(
          and(
            eq(schema.conversations.instanceId, instance.id),
            eq(schema.conversations.remoteJid, remoteJid),
          ),
        )
        .limit(1)
    )[0];
    if (!conversation) {
      conversation = (
        await tx
          .insert(schema.conversations)
          .values({
            clinicId: auth.clinicId,
            instanceId: instance.id,
            remoteJid,
            customerId: customer.id,
          })
          .returning({ id: schema.conversations.id })
      )[0];
    }
    if (!conversation) return { ok: false, error: "Não foi possível abrir a conversa." };

    const [message] = await tx
      .insert(schema.messages)
      .values({
        clinicId: auth.clinicId,
        conversationId: conversation.id,
        direction: "outbound",
        author: "automation",
        body,
        status: "pending_approval",
        automationId: "intelligence_suggestion",
      })
      .returning({ id: schema.messages.id });
    if (!message) return { ok: false, error: "Não foi possível preparar a mensagem." };

    await tx.insert(schema.approvals).values({
      clinicId: auth.clinicId,
      messageId: message.id,
      customerId: customer.id,
      automationId: "intelligence_suggestion",
      generatedBody: body,
      contextLine: scoreRow.suggestedAction
        ? `✨ Inteligência: ${scoreRow.suggestedAction}`
        : "✨ Sugestão da Inteligência",
      expiresAt: new Date(Date.now() + 7 * 86_400_000),
    });

    revalidatePath("/inteligencia");
    revalidatePath("/relatorios");
    revalidatePath("/aprovacoes");
    revalidatePath("/inicio");
    return { ok: true };
  },
});
