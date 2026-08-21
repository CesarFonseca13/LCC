"use server";

import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { renderTermHtml, sha256Hex } from "@clinicaos/core/documents";
import { formatPhoneBR } from "@clinicaos/core/phone";
import { unknownVariables, extractVariables } from "@clinicaos/core/template-render";
import { todayISO } from "@clinicaos/core/timezone";
import { schema, type Tx } from "@clinicaos/db";
import { authAction } from "@/lib/auth-action";
import { parseBRLDecimal } from "@/lib/format";

export interface TermsResult {
  ok: boolean;
  error?: string;
  /** Link público de assinatura (para copiar quando o WhatsApp não estiver conectado). */
  signUrl?: string;
  whatsappSent?: boolean;
}

// ── Modelos ──────────────────────────────────────────────────────────

const templateSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(3, "Dê um nome ao modelo"),
  bodyText: z.string().trim().min(50, "O termo parece curto demais"),
});

export const saveDocumentTemplate = authAction({
  permission: "terms.manage",
  schema: templateSchema,
  handler: async (input, { auth, tx }): Promise<TermsResult> => {
    const unknown = unknownVariables(input.bodyText);
    if (unknown.length > 0) {
      return {
        ok: false,
        error: `Variável desconhecida: ${unknown.map((v) => `{{${v}}}`).join(", ")}`,
      };
    }
    const values = {
      clinicId: auth.clinicId,
      name: input.name,
      bodyText: input.bodyText,
      variables: extractVariables(input.bodyText),
      createdBy: auth.userId,
    };
    if (input.id) {
      await tx
        .update(schema.documentTemplates)
        .set(values)
        .where(eq(schema.documentTemplates.id, input.id));
    } else {
      await tx.insert(schema.documentTemplates).values(values);
    }
    revalidatePath("/termos");
    return { ok: true };
  },
});

export const toggleTemplateActive = authAction({
  permission: "terms.manage",
  schema: z.object({ id: z.string().uuid(), active: z.boolean() }),
  handler: async (input, { tx }): Promise<TermsResult> => {
    await tx
      .update(schema.documentTemplates)
      .set({ active: input.active })
      .where(eq(schema.documentTemplates.id, input.id));
    revalidatePath("/termos");
    return { ok: true };
  },
});

// ── Gerar e enviar ───────────────────────────────────────────────────

const generateSchema = z.object({
  customerId: z.string().uuid("Escolha a cliente"),
  templateId: z.string().uuid("Escolha o modelo"),
  procedureId: z.string().uuid("Escolha o procedimento"),
  valor: z.string().transform((v, ctx) => {
    const parsed = parseBRLDecimal(v);
    if (parsed === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Valor inválido" });
      return z.NEVER;
    }
    return parsed;
  }),
});

async function queueWhatsAppText(
  tx: Tx,
  clinicId: string,
  customerPhone: string,
  body: string,
): Promise<boolean> {
  const instance = (
    await tx
      .select({ id: schema.whatsappInstances.id, status: schema.whatsappInstances.status })
      .from(schema.whatsappInstances)
      .where(eq(schema.whatsappInstances.clinicId, clinicId))
      .limit(1)
  )[0];
  if (!instance || instance.status !== "connected") return false;

  const remoteJid = `${customerPhone.replace("+", "")}@s.whatsapp.net`;
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
    const [created] = await tx
      .insert(schema.conversations)
      .values({ clinicId, instanceId: instance.id, remoteJid })
      .onConflictDoNothing()
      .returning({ id: schema.conversations.id });
    conversation = created;
  }
  if (!conversation) return false;

  await tx.insert(schema.messages).values({
    clinicId,
    conversationId: conversation.id,
    direction: "outbound",
    author: "automation",
    body,
    status: "queued",
    automationId: "consent_term",
    scheduledFor: new Date(Date.now() + 2_000 + Math.floor(Math.random() * 5_000)),
  });
  return true;
}

export const generateAndSendTerm = authAction({
  permission: "terms.manage",
  schema: generateSchema,
  handler: async (input, { auth, tx }): Promise<TermsResult> => {
    const customer = (
      await tx
        .select()
        .from(schema.customers)
        .where(eq(schema.customers.id, input.customerId))
        .limit(1)
    )[0];
    if (!customer) return { ok: false, error: "Cliente não encontrada." };

    // Termo legal exige os dados completos — honestidade > placeholder vazio
    const missing: string[] = [];
    if (!customer.cpf) missing.push("CPF");
    if (!customer.addressStreet || !customer.addressCity) missing.push("endereço");
    if (missing.length > 0) {
      return {
        ok: false,
        error: `Complete a ficha da cliente antes: falta ${missing.join(" e ")}. (Clientes → ${customer.fullName} → Dados)`,
      };
    }

    const template = (
      await tx
        .select()
        .from(schema.documentTemplates)
        .where(eq(schema.documentTemplates.id, input.templateId))
        .limit(1)
    )[0];
    const procedure = (
      await tx
        .select({ name: schema.procedures.name })
        .from(schema.procedures)
        .where(eq(schema.procedures.id, input.procedureId))
        .limit(1)
    )[0];
    const clinic = (
      await tx
        .select({ name: schema.clinics.name, timezone: schema.clinics.timezone })
        .from(schema.clinics)
        .where(eq(schema.clinics.id, auth.clinicId))
        .limit(1)
    )[0];
    if (!template || !procedure || !clinic) {
      return { ok: false, error: "Modelo ou procedimento não encontrado." };
    }

    const endereco = [
      customer.addressStreet,
      customer.addressNumber,
      customer.addressDistrict,
      customer.addressCity && customer.addressState
        ? `${customer.addressCity}/${customer.addressState}`
        : customer.addressCity,
    ]
      .filter(Boolean)
      .join(", ");
    const hoje = todayISO(clinic.timezone);
    const [y, m, d] = hoje.split("-");
    const valores = {
      nome: customer.fullName,
      cpf: customer.cpf!,
      telefone: formatPhoneBR(customer.phoneE164),
      email: customer.email ?? "não informado",
      endereco,
      valor: Number(input.valor).toLocaleString("pt-BR", { minimumFractionDigits: 2 }),
      procedimento: procedure.name,
      clinica: clinic.name,
      data: `${d}/${m}/${y}`,
    };

    let bodyHtml: string;
    try {
      bodyHtml = renderTermHtml(template.bodyText, valores);
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "Falha no modelo." };
    }

    const signToken = randomBytes(32).toString("base64url");
    const title = `${template.name} — ${procedure.name}`;
    const [doc] = await tx
      .insert(schema.documents)
      .values({
        clinicId: auth.clinicId,
        customerId: customer.id,
        templateId: template.id,
        procedureId: input.procedureId,
        title,
        bodyHtmlRendered: bodyHtml,
        variablesSnapshot: valores,
        contentSha256: sha256Hex(bodyHtml),
        signToken,
        tokenExpiresAt: new Date(Date.now() + 7 * 86_400_000),
        createdBy: auth.userId,
      })
      .returning({ id: schema.documents.id });
    if (!doc) return { ok: false, error: "Falha ao gerar o documento." };

    await tx.insert(schema.documentAuditLog).values([
      { clinicId: auth.clinicId, documentId: doc.id, event: "created" },
      { clinicId: auth.clinicId, documentId: doc.id, event: "sent" },
    ]);

    const appUrl = process.env.APP_URL ?? "http://localhost:3000";
    const signUrl = `${appUrl}/assinar/${signToken}`;
    const primeiroNome = customer.fullName.split(" ")[0];
    const whatsappSent = await queueWhatsAppText(
      tx,
      auth.clinicId,
      customer.phoneE164,
      `Oi ${primeiroNome}! Para deixar tudo certinho para o seu procedimento de ${procedure.name}, preparei seu termo de consentimento. É rapidinho — é só abrir, revisar e assinar aqui: ${signUrl}`,
    );

    revalidatePath("/termos");
    return { ok: true, signUrl, whatsappSent };
  },
});

export const resendTerm = authAction({
  permission: "terms.manage",
  schema: z.object({ id: z.string().uuid() }),
  handler: async (input, { auth, tx }): Promise<TermsResult> => {
    const doc = (
      await tx
        .select()
        .from(schema.documents)
        .where(eq(schema.documents.id, input.id))
        .limit(1)
    )[0];
    if (!doc || !["sent", "viewed", "expired"].includes(doc.status)) {
      return { ok: false, error: "Documento não está pendente." };
    }

    // Reenviar RENOVA o link: token novo + 7 dias de validade (link morto nunca sai)
    const newToken = randomBytes(32).toString("base64url");
    await tx
      .update(schema.documents)
      .set({
        signToken: newToken,
        tokenExpiresAt: new Date(Date.now() + 7 * 86_400_000),
        status: "sent",
        updatedAt: new Date(),
      })
      .where(eq(schema.documents.id, doc.id));
    doc.signToken = newToken;
    const customer = (
      await tx
        .select({ fullName: schema.customers.fullName, phoneE164: schema.customers.phoneE164 })
        .from(schema.customers)
        .where(eq(schema.customers.id, doc.customerId))
        .limit(1)
    )[0];
    if (!customer) return { ok: false, error: "Cliente não encontrada." };

    const appUrl = process.env.APP_URL ?? "http://localhost:3000";
    const signUrl = `${appUrl}/assinar/${doc.signToken}`;
    const sent = await queueWhatsAppText(
      tx,
      auth.clinicId,
      customer.phoneE164,
      `Oi ${customer.fullName.split(" ")[0]}! Passando para lembrar do seu termo de consentimento — leva 1 minutinho para assinar: ${signUrl}`,
    );
    await tx.insert(schema.documentAuditLog).values({
      clinicId: auth.clinicId,
      documentId: doc.id,
      event: "resent",
    });
    revalidatePath("/termos");
    return { ok: true, signUrl, whatsappSent: sent };
  },
});
