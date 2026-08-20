"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { unknownVariables } from "@clinicaos/core/template-render";
import { sql } from "drizzle-orm";
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
  messageTemplate: z.string().trim().optional(),
});

export const saveAutomationSetting = authAction({
  permission: "automations.manage",
  schema: settingSchema,
  handler: async (input, { auth, tx }): Promise<AutomationResult> => {
    if (input.messageTemplate !== undefined && input.messageTemplate.length > 0) {
      const unknown = unknownVariables(input.messageTemplate);
      if (unknown.length > 0) {
        return {
          ok: false,
          error: `Variável desconhecida: ${unknown.map((v) => `{{${v}}}`).join(", ")}`,
        };
      }
    }

    const template =
      input.messageTemplate !== undefined && input.messageTemplate.length > 0
        ? input.messageTemplate
        : undefined;

    await tx.execute(sql`
      INSERT INTO automation_settings (clinic_id, automation_id, enabled, requires_approval, message_template, updated_by, updated_at)
      VALUES (
        ${auth.clinicId}, ${input.automationId},
        COALESCE(${input.enabled ?? null}, false),
        COALESCE(${input.requiresApproval ?? null}, true),
        ${template ?? null}, ${auth.userId}, now()
      )
      ON CONFLICT (clinic_id, automation_id) DO UPDATE SET
        enabled = COALESCE(${input.enabled ?? null}, automation_settings.enabled),
        requires_approval = COALESCE(${input.requiresApproval ?? null}, automation_settings.requires_approval),
        message_template = CASE
          WHEN ${template !== undefined} THEN ${template ?? null}
          ELSE automation_settings.message_template
        END,
        updated_by = ${auth.userId},
        updated_at = now()
    `);

    void schema;
    revalidatePath("/automacoes");
    return { ok: true };
  },
});
