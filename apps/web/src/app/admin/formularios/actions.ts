"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { adminDb, schema } from "@clinicaos/db";
import { platformAudit, requireSuperadmin } from "@/lib/admin";

type Result = { ok: true } | { ok: false; error: string };

const statusSchema = z.object({ id: z.string().uuid(), status: z.enum(["new", "done"]) });

/** Marca um formulário como configurado (ou volta para novo). */
export async function setOnboardingFormStatus(raw: unknown): Promise<Result> {
  const auth = await requireSuperadmin();
  const parsed = statusSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Dados inválidos" };
  const db = adminDb();
  const updated = await db
    .update(schema.onboardingForms)
    .set({
      status: parsed.data.status,
      handledAt: parsed.data.status === "done" ? new Date() : null,
      handledBy: parsed.data.status === "done" ? auth.userId : null,
    })
    .where(eq(schema.onboardingForms.id, parsed.data.id))
    .returning({ id: schema.onboardingForms.id });
  if (updated.length === 0) return { ok: false, error: "Formulário não encontrado (já foi apagado?)" };
  await platformAudit(auth.userId, "onboarding_form.status", { target: parsed.data.id, details: { status: parsed.data.status } });
  revalidatePath("/admin/formularios");
  revalidatePath(`/admin/formularios/${parsed.data.id}`);
  return { ok: true };
}

/** Apaga um formulário (ex.: teste ou duplicado). */
export async function deleteOnboardingForm(raw: unknown): Promise<Result> {
  const auth = await requireSuperadmin();
  const parsed = z.object({ id: z.string().uuid() }).safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Dados inválidos" };
  const deleted = await adminDb().delete(schema.onboardingForms).where(eq(schema.onboardingForms.id, parsed.data.id)).returning({ id: schema.onboardingForms.id });
  if (deleted.length === 0) return { ok: false, error: "Formulário não encontrado (já foi apagado?)" };
  await platformAudit(auth.userId, "onboarding_form.delete", { target: parsed.data.id });
  revalidatePath("/admin/formularios");
  return { ok: true };
}
