import "server-only";
import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { cache } from "react";
import { TERMS_VERSION } from "@clinicaos/core/terms-of-use";
import { schema, unsafeGlobalDb } from "@clinicaos/db";

/** Aceitou a versão vigente dos Termos? (tabela global, como auth_sessions) */
export const hasAcceptedTerms = cache(async (userId: string): Promise<boolean> => {
  const rows = await unsafeGlobalDb()
    .select({ id: schema.termsAcceptances.id })
    .from(schema.termsAcceptances)
    .where(
      and(
        eq(schema.termsAcceptances.userId, userId),
        eq(schema.termsAcceptances.version, TERMS_VERSION),
      ),
    )
    .limit(1);
  return rows.length > 0;
});

/** Todo acesso ao painel e ao wizard passa por aqui: sem aceite, vai para /aceite. */
export async function requireTermsAccepted(userId: string): Promise<void> {
  if (!(await hasAcceptedTerms(userId))) redirect("/aceite");
}
