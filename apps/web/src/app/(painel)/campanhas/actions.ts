"use server";

import { and, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { extractVariables, strayPlaceholders } from "@clinicaos/core/template-render";
import { schema } from "@clinicaos/db";
import type { Tx } from "@clinicaos/db";
import { authAction } from "@/lib/auth-action";

export interface CampaignResult {
  ok: boolean;
  error?: string;
  count?: number;
}

const segmentSchema = z.object({
  status: z.enum(["todas", "active", "lead"]),
  procedureId: z
    .string()
    .transform((v) => (v && v !== "all" ? v : null))
    .nullable(),
  semVisitaDias: z
    .string()
    .transform((v) => (v && v !== "0" ? Number(v) : null))
    .nullable(),
});

type Segment = z.infer<typeof segmentSchema>;

/** O que fica gravado em campaigns.segment (JÁ transformado — nunca re-passe no schema do form). */
const storedSegmentSchema = z.object({
  status: z.enum(["todas", "active", "lead"]),
  procedureId: z.string().uuid().nullable().catch(null),
  semVisitaDias: z.number().int().positive().nullable().catch(null),
});

const ALLOWED_VARS = new Set(["nome", "clinica"]);

/** Só base cadastrada e contatável — cold list não existe aqui por design. */
function segmentWhere(segment: Segment) {
  return sql`
    customers.deleted_at IS NULL AND customers.merged_into_id IS NULL
    AND NOT customers.automations_blocked AND customers.opted_out_at IS NULL
    AND customers.whatsapp_valid IS DISTINCT FROM false
    ${segment.status === "todas" ? sql`` : sql`AND customers.status = ${segment.status}`}
    ${
      segment.procedureId
        ? sql`AND (
            EXISTS (SELECT 1 FROM appointments a WHERE a.customer_id = customers.id
                    AND a.procedure_id = ${segment.procedureId} AND a.status = 'showed')
            OR EXISTS (SELECT 1 FROM customer_history_entries h WHERE h.customer_id = customers.id
                       AND h.procedure_id = ${segment.procedureId})
          )`
        : sql``
    }
    ${
      segment.semVisitaDias
        ? sql`AND COALESCE(
            (SELECT max(d) FROM (
              SELECT max((a.starts_at AT TIME ZONE 'America/Sao_Paulo')::date) AS d
              FROM appointments a WHERE a.customer_id = customers.id AND a.status = 'showed'
              UNION ALL
              SELECT max(h.occurred_on) FROM customer_history_entries h
              WHERE h.customer_id = customers.id
            ) v),
            '1900-01-01'::date
          ) < current_date - make_interval(days => ${segment.semVisitaDias})`
        : sql``
    }
  `;
}

async function countSegment(tx: Tx, segment: Segment): Promise<number> {
  const result = await tx.execute(
    sql`SELECT count(*)::int AS n FROM customers WHERE ${segmentWhere(segment)}`,
  );
  return Number((result.rows[0] as { n: number }).n);
}

const previewSchema = z.object({ segment: segmentSchema });

export const previewCampaign = authAction({
  permission: "automations.manage",
  schema: previewSchema,
  handler: async (input, { tx }): Promise<CampaignResult> => {
    const count = await countSegment(tx, input.segment);
    return { ok: true, count };
  },
});

const createSchema = z.object({
  name: z.string().trim().min(2, "Dê um nome à campanha").max(80),
  messageTemplate: z.string().trim().min(10, "Escreva a mensagem").max(1000),
  dailyCap: z.enum(["10", "30", "50"]),
  segment: segmentSchema,
});

export const createCampaign = authAction({
  permission: "automations.manage",
  schema: createSchema,
  handler: async (input, { auth, tx }): Promise<CampaignResult> => {
    const invalid = extractVariables(input.messageTemplate).filter((v) => !ALLOWED_VARS.has(v));
    if (invalid.length > 0) {
      return {
        ok: false,
        error: `Use só {{nome}} e {{clinica}} (${invalid.map((v) => `{{${v}}}`).join(", ")} não existe aqui)`,
      };
    }
    // {{Nome}}/{{ NOME }}/acentos não seriam substituídos e sairiam LITERAIS
    const stray = strayPlaceholders(input.messageTemplate);
    if (stray.length > 0) {
      return {
        ok: false,
        error: `Escreva as variáveis em minúsculas e sem acento: ${stray.map((v) => `{{${v}}}`).join(", ")} sairia literal na mensagem`,
      };
    }
    const count = await countSegment(tx, input.segment);
    if (count === 0) {
      return { ok: false, error: "Nenhuma cliente nesse filtro — ajuste o público." };
    }
    await tx.insert(schema.campaigns).values({
      clinicId: auth.clinicId,
      name: input.name,
      messageTemplate: input.messageTemplate,
      segment: input.segment,
      dailyCap: Number(input.dailyCap),
      createdBy: auth.userId,
    });
    revalidatePath("/campanhas");
    return { ok: true, count };
  },
});

export const startCampaign = authAction({
  permission: "automations.manage",
  schema: z.object({ id: z.string().uuid() }),
  handler: async (input, { auth, tx }): Promise<CampaignResult> => {
    const campaign = (
      await tx
        .select()
        .from(schema.campaigns)
        .where(and(eq(schema.campaigns.id, input.id), eq(schema.campaigns.status, "draft")))
        .limit(1)
    )[0];
    if (!campaign) return { ok: false, error: "Campanha não encontrada ou já iniciada." };

    const instance = (
      await tx
        .select({ status: schema.whatsappInstances.status })
        .from(schema.whatsappInstances)
        .where(eq(schema.whatsappInstances.clinicId, auth.clinicId))
        .limit(1)
    )[0];
    if (instance?.status !== "connected") {
      return { ok: false, error: "Conecte o WhatsApp antes de iniciar a campanha." };
    }

    // Congela a lista de destinatárias agora; no envio o worker ainda revalida
    // bloqueio/opt-out e pula quem visitou depois do início
    const segment = storedSegmentSchema.parse(campaign.segment);
    await tx.execute(sql`
      INSERT INTO campaign_recipients (clinic_id, campaign_id, customer_id)
      SELECT ${auth.clinicId}, ${input.id}, customers.id
      FROM customers WHERE ${segmentWhere(segment)}
      ON CONFLICT DO NOTHING
    `);
    const total = await tx.execute(sql`
      SELECT count(*)::int AS n FROM campaign_recipients WHERE campaign_id = ${input.id}
    `);
    const n = Number((total.rows[0] as { n: number }).n);
    if (n === 0) return { ok: false, error: "Nenhuma cliente elegível nesse filtro." };

    await tx
      .update(schema.campaigns)
      .set({
        status: "running",
        recipientCount: n,
        startedAt: new Date(),
        nextSendAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(schema.campaigns.id, input.id), eq(schema.campaigns.status, "draft")));
    revalidatePath("/campanhas");
    return { ok: true, count: n };
  },
});

const transitionSchema = z.object({
  id: z.string().uuid(),
  to: z.enum(["paused", "running", "cancelled"]),
});

export const deleteCampaign = authAction({
  permission: "automations.manage",
  schema: z.object({ id: z.string().uuid() }),
  handler: async (input, { tx }): Promise<CampaignResult> => {
    // Excluir apaga os recipients por CASCADE — se JÁ HOUVE envio, o registro
    // fica (senão o teto diário do número zeraria e permitiria enviar em dobro)
    const sent = await tx.execute(sql`
      SELECT 1 FROM campaign_recipients
      WHERE campaign_id = ${input.id} AND status = 'sent' LIMIT 1
    `);
    if ((sent.rowCount ?? 0) > 0) {
      return {
        ok: false,
        error: "Essa campanha já enviou mensagens — o histórico fica guardado (cancele em vez de excluir).",
      };
    }
    const deleted = await tx
      .delete(schema.campaigns)
      .where(
        and(
          eq(schema.campaigns.id, input.id),
          inArray(schema.campaigns.status, ["draft", "cancelled"]),
        ),
      )
      .returning({ id: schema.campaigns.id });
    if (!deleted[0]) {
      return { ok: false, error: "Só rascunhos e campanhas canceladas podem ser excluídos." };
    }
    revalidatePath("/campanhas");
    return { ok: true };
  },
});

export const transitionCampaign = authAction({
  permission: "automations.manage",
  schema: transitionSchema,
  handler: async (input, { tx }): Promise<CampaignResult> => {
    const allowedFrom: Record<string, string[]> = {
      paused: ["running"],
      running: ["paused"],
      cancelled: ["running", "paused", "draft"],
    };
    const updated = await tx
      .update(schema.campaigns)
      .set({
        status: input.to,
        updatedAt: new Date(),
        ...(input.to === "cancelled" ? { finishedAt: new Date() } : {}),
      })
      .where(
        and(
          eq(schema.campaigns.id, input.id),
          inArray(schema.campaigns.status, allowedFrom[input.to]! as ("draft" | "running" | "paused")[]),
        ),
      )
      .returning({ id: schema.campaigns.id });
    if (!updated[0]) return { ok: false, error: "A campanha mudou de estado — recarregue." };
    revalidatePath("/campanhas");
    return { ok: true };
  },
});
