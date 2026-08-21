"use server";

import { and, eq, inArray } from "drizzle-orm";
import { headers } from "next/headers";
import { z } from "zod";
import { adoptClinic, schema, withContext } from "@clinicaos/db";

/**
 * Assinatura pública — autenticada exclusivamente pelo sign_token (RLS sign_resolve).
 * Captura IP, user-agent e evidências; grava o hash do conteúdo exato assinado.
 */

export interface SignResult {
  ok: boolean;
  error?: string;
}

const signSchema = z.object({
  token: z.string().min(20),
  signerName: z.string().trim().min(5, "Informe seu nome completo"),
  signatureKind: z.enum(["drawn", "typed"]),
  signatureImage: z
    .string()
    .regex(/^data:image\/png;base64,/)
    .max(200_000, "Assinatura muito grande")
    .optional(),
  typedSignature: z.string().trim().max(120).optional(),
  evidence: z.object({
    viewport: z.string().max(20).optional(),
    deviceTimezone: z.string().max(64).optional(),
  }),
});

export async function signDocument(rawInput: unknown): Promise<SignResult> {
  const parsed = signSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }
  const input = parsed.data;
  if (input.signatureKind === "drawn" && !input.signatureImage) {
    return { ok: false, error: "Desenhe sua assinatura." };
  }
  if (input.signatureKind === "typed" && !input.typedSignature) {
    return { ok: false, error: "Digite seu nome para assinar." };
  }

  const headerStore = await headers();
  const rawIp =
    headerStore.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    headerStore.get("x-real-ip") ||
    "";
  // Coluna é inet: lixo no header ("unknown", vazio) NUNCA pode travar a assinatura
  const ipPattern = /^(\d{1,3}(\.\d{1,3}){3}|[0-9a-fA-F:]+)$/;
  const ip = ipPattern.test(rawIp) ? rawIp : null;
  const userAgent = headerStore.get("user-agent") ?? "desconhecido";

  return withContext({ signToken: input.token }, async (tx) => {
    const doc = (
      await tx
        .select()
        .from(schema.documents)
        .where(eq(schema.documents.signToken, input.token))
        .limit(1)
    )[0];
    if (!doc) return { ok: false, error: "Link inválido." };
    if (doc.status === "signed") return { ok: true };
    if (!["sent", "viewed"].includes(doc.status)) {
      return { ok: false, error: "Este termo não está mais disponível." };
    }
    if (new Date(doc.tokenExpiresAt) < new Date()) {
      return { ok: false, error: "Este link expirou — peça para a clínica reenviar." };
    }

    await adoptClinic(tx, doc.clinicId);

    // Claim atômico: só a primeira assinatura vale
    const claimed = await tx
      .update(schema.documents)
      .set({ status: "signed", signedAt: new Date() })
      .where(
        and(
          eq(schema.documents.id, doc.id),
          inArray(schema.documents.status, ["sent", "viewed"]),
        ),
      )
      .returning({ id: schema.documents.id });
    if (!claimed[0]) return { ok: true };

    await tx.insert(schema.documentSignatures).values({
      clinicId: doc.clinicId,
      documentId: doc.id,
      signerName: input.signerName,
      signatureKind: input.signatureKind,
      signatureImage:
        input.signatureKind === "drawn"
          ? (input.signatureImage ?? null)
          : (input.typedSignature ?? null),
      ip,
      userAgent,
      contentSha256: doc.contentSha256,
      evidence: input.evidence,
    });
    await tx.insert(schema.documentAuditLog).values({
      clinicId: doc.clinicId,
      documentId: doc.id,
      event: "signed",
      ip,
      userAgent,
      metadata: { signatureKind: input.signatureKind, signerName: input.signerName },
    });

    return { ok: true };
  });
}
