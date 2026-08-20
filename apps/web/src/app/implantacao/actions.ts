"use server";

import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { schema } from "@clinicaos/db";
import { authAction } from "@/lib/auth-action";

export interface WizardResult {
  ok: boolean;
  error?: string;
}

const basicsSchema = z.object({
  name: z.string().trim().min(2, "Informe o nome da clínica"),
  city: z.string().trim().transform((v) => v || null),
  state: z.string().trim().toUpperCase().transform((v) => v || null),
  specialty: z.enum(["estetica_facial", "estetica_corporal", "harmonizacao", "depilacao"]),
  weekOpen: z.string().regex(/^\d{2}:\d{2}$/),
  weekClose: z.string().regex(/^\d{2}:\d{2}$/),
  saturday: z.boolean(),
  satOpen: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  satClose: z.string().regex(/^\d{2}:\d{2}$/).optional(),
});

export const saveClinicBasics = authAction({
  permission: "settings.manage",
  schema: basicsSchema,
  handler: async (input, { auth, tx }): Promise<WizardResult> => {
    const week: [string, string][] = [[input.weekOpen, input.weekClose]];
    const businessHours: Record<string, [string, string][]> = {
      mon: week,
      tue: week,
      wed: week,
      thu: week,
      fri: week,
    };
    if (input.saturday && input.satOpen && input.satClose) {
      businessHours.sat = [[input.satOpen, input.satClose]];
    }

    await tx
      .update(schema.clinics)
      .set({
        name: input.name,
        addressCity: input.city,
        addressState: input.state,
        businessHours,
        settings: sql`settings || jsonb_build_object('specialty', ${input.specialty}::text)`,
      })
      .where(eq(schema.clinics.id, auth.clinicId));

    revalidatePath("/implantacao");
    return { ok: true };
  },
});

export const markOnboardingDone = authAction({
  permission: "settings.manage",
  schema: z.object({}),
  handler: async (_input, { auth, tx }): Promise<WizardResult> => {
    await tx
      .update(schema.clinics)
      .set({ settings: sql`settings || '{"onboarding_done": true}'::jsonb` })
      .where(eq(schema.clinics.id, auth.clinicId));
    revalidatePath("/inicio");
    return { ok: true };
  },
});
