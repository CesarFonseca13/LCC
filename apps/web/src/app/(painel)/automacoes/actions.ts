"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  extractVariables,
  strayPlaceholders,
  unknownVariables,
} from "@clinicaos/core/template-render";
import { eq, sql } from "drizzle-orm";
import { schema } from "@clinicaos/db";
import { authAction } from "@/lib/auth-action";

export interface AutomationResult {
  ok: boolean;
  error?: string;
}

const settingSchema = z.object({
  automationId: z.string().min(1),
  enabled: z.boolean().optional(),
  requiresApproval: z.boolean().optional(),
  messageTemplate: z.string().trim().max(1000, "Mensagem longa demais").optional(),
  /** Sequências (reativação): textos dos passos, na ordem. Os dias são fixos do catálogo. */
  steps: z
    .array(z.string().trim().min(1, "Passo vazio").max(1000, "Mensagem longa demais"))
    .max(10)
    .optional(),
});

/** Reativação não tem agendamento por trás: só estas variáveis existem no envio. */
const SEQUENCE_VARIABLES = new Set(["nome", "procedimento", "clinica"]);

/**
 * Variáveis que cada automação de fato fornece no envio — salvar {{data}} numa
 * automação sem agendamento por trás quebraria o envio na hora H.
 * TODA automação do catálogo tem entrada aqui (o executor é a fonte da verdade).
 */
const APPT_VARS = ["nome", "clinica", "procedimento", "data", "hora", "profissional"];
const TEMPLATE_VARIABLES: Record<string, Set<string>> = {
  reminder_24h: new Set(APPT_VARS),
  confirm_2h: new Set(APPT_VARS),
  reminder_45min: new Set(APPT_VARS),
  pre_care: new Set([...APPT_VARS, "cuidados"]),
  reply_on_confirm: new Set(APPT_VARS),
  reply_on_cancel: new Set(APPT_VARS),
  reply_on_reschedule: new Set(APPT_VARS),
  no_show_message: new Set(APPT_VARS),
  no_show_followup: new Set(APPT_VARS),
  post_visit: new Set([...APPT_VARS, "cuidados"]),
  feedback_request: new Set(APPT_VARS),
  touchup_offer: new Set([...APPT_VARS, "dias"]),
  post_sale_cadence: new Set(APPT_VARS),
  birthday: new Set(["nome", "clinica"]),
  smart_fill: new Set(["nome", "clinica", "procedimento", "horario"]),
  package_renewal_sessions: new Set(["nome", "clinica", "pacote", "sessoes", "procedimento"]),
  package_renewal_expiry: new Set(["nome", "clinica", "pacote", "sessoes", "procedimento"]),
};

export const saveAutomationSetting = authAction({
  permission: "automations.manage",
  schema: settingSchema,
  handler: async (input, { auth, tx }): Promise<AutomationResult> => {
    if (input.messageTemplate !== undefined && input.messageTemplate.length > 0) {
      const stray = strayPlaceholders(input.messageTemplate);
      if (stray.length > 0) {
        return {
          ok: false,
          error: `Escreva as variáveis em minúsculas e sem acento: ${stray.map((v) => `{{${v}}}`).join(", ")} sairia literal na mensagem`,
        };
      }
      const unknown = unknownVariables(input.messageTemplate);
      if (unknown.length > 0) {
        return {
          ok: false,
          error: `Variável desconhecida: ${unknown.map((v) => `{{${v}}}`).join(", ")}`,
        };
      }
      const allowed = TEMPLATE_VARIABLES[input.automationId];
      if (allowed) {
        const invalid = extractVariables(input.messageTemplate).filter((v) => !allowed.has(v));
        if (invalid.length > 0) {
          return {
            ok: false,
            error: `Essa automação não tem ${invalid.map((v) => `{{${v}}}`).join(", ")} — use ${[...allowed].map((v) => `{{${v}}}`).join(", ")}`,
          };
        }
      }
    }

    // Sequência: valida variáveis e casa cada texto com o dia do passo no catálogo
    let stepsJson: string | undefined;
    if (input.steps !== undefined) {
      const definition = (
        await tx
          .select({ defaultConfig: schema.automationDefinitions.defaultConfig })
          .from(schema.automationDefinitions)
          .where(eq(schema.automationDefinitions.id, input.automationId))
          .limit(1)
      )[0];
      const defaultSteps = ((definition?.defaultConfig ?? {}) as {
        steps?: { days: number; template: string }[];
      }).steps;
      if (!defaultSteps || defaultSteps.length !== input.steps.length) {
        return { ok: false, error: "Sequência inválida para essa automação." };
      }
      for (const [i, text] of input.steps.entries()) {
        const stray = strayPlaceholders(text);
        if (stray.length > 0) {
          return {
            ok: false,
            error: `Mensagem ${i + 1}: escreva em minúsculas e sem acento (${stray.map((v) => `{{${v}}}`).join(", ")} sairia literal)`,
          };
        }
        const invalid = extractVariables(text).filter((v) => !SEQUENCE_VARIABLES.has(v));
        if (invalid.length > 0) {
          return {
            ok: false,
            error: `Mensagem ${i + 1}: use só {{nome}}, {{procedimento}} e {{clinica}} (${invalid.map((v) => `{{${v}}}`).join(", ")} não existe nesse envio)`,
          };
        }
      }
      stepsJson = JSON.stringify({
        steps: defaultSteps.map((s, i) => ({ days: s.days, template: input.steps![i]! })),
      });
    }

    const template =
      input.messageTemplate !== undefined && input.messageTemplate.length > 0
        ? input.messageTemplate
        : undefined;

    await tx.execute(sql`
      INSERT INTO automation_settings (clinic_id, automation_id, enabled, requires_approval, message_template, config, updated_by, updated_at)
      VALUES (
        ${auth.clinicId}, ${input.automationId},
        COALESCE(${input.enabled ?? null}, false),
        COALESCE(${input.requiresApproval ?? null}, true),
        ${template ?? null},
        COALESCE(${stepsJson ?? null}::jsonb, '{}'::jsonb),
        ${auth.userId}, now()
      )
      ON CONFLICT (clinic_id, automation_id) DO UPDATE SET
        enabled = COALESCE(${input.enabled ?? null}, automation_settings.enabled),
        requires_approval = COALESCE(${input.requiresApproval ?? null}, automation_settings.requires_approval),
        message_template = CASE
          WHEN ${template !== undefined} THEN ${template ?? null}
          ELSE automation_settings.message_template
        END,
        config = CASE
          WHEN ${stepsJson !== undefined}
            THEN automation_settings.config || ${stepsJson ?? null}::jsonb
          ELSE automation_settings.config
        END,
        updated_by = ${auth.userId},
        updated_at = now()
    `);

    revalidatePath("/automacoes");
    return { ok: true };
  },
});
