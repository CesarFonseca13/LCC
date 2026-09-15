"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { TERMS_VERSION } from "@clinicaos/core/terms-of-use";
import { schema, unsafeGlobalDb } from "@clinicaos/db";
import { requireAuth } from "@/lib/auth-action";

/** Registra o aceite da versão vigente (com IP e navegador como evidência). */
export async function acceptTermsAction(): Promise<void> {
  const auth = await requireAuth();
  const headerStore = await headers();
  await unsafeGlobalDb()
    .insert(schema.termsAcceptances)
    .values({
      userId: auth.userId,
      clinicId: auth.clinicId,
      version: TERMS_VERSION,
      ip: headerStore.get("x-forwarded-for")?.split(",")[0]?.trim() || null,
      userAgent: headerStore.get("user-agent")?.slice(0, 500) ?? null,
    })
    .onConflictDoNothing();
  redirect("/inicio");
}
