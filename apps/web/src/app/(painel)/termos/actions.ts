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

const valorSchema = z.string().transform((v, ctx) => {
  const parsed = parseBRLDecimal(v);
  if (parsed === null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Valor inválido" });
    return z.NEVER;
  }
  return parsed;
});

const generateSchema = z.object({
  customerId: z.string().uuid("Escolha a cliente"),
  templateId: z.string().uuid("Escolha o modelo"),
  procedureId: z.string().uuid("Escolha o procedimento"),
  valor: valorSchema,
  /** Valores conferidos/editados na tela — prevalecem sobre os automáticos. */
  overrides: z.record(z.string(), z.string()).optional(),
});

/** Rótulos humanos das variáveis (vão para a tela dentro da resposta do preview —
 *  módulo "use server" só pode exportar funções assíncronas). */
const VARIABLE_LABELS: Record<string, string> = {
  nome: "Nome completo",
  cpf: "CPF",
  telefone: "Telefone",
  email: "E-mail",
  endereco: "Endereço",
  valor: "Valor (R$)",
  procedimento: "Procedimento",
  clinica: "Clínica",
  data: "Data",
};

/** Valores automáticos das variáveis, vindos da ficha/catálogo/clínica.
 *  Campo vazio na ficha vira "" (a tela pede para preencher) — nunca inventa. */
async function autoTermValues(
  tx: Tx,
  clinicId: string,
  customer: typeof schema.customers.$inferSelect,
  procedureId: string | null,
  /** Decimal normalizado por parseBRLDecimal ("1500.00") ou null. */
  valor: string | null,
): Promise<Record<string, string>> {
  const procedure = procedureId
    ? (
        await tx
          .select({ name: schema.procedures.name })
          .from(schema.procedures)
          .where(eq(schema.procedures.id, procedureId))
          .limit(1)
      )[0]
    : undefined;
  const clinic = (
    await tx
      .select({ name: schema.clinics.name, timezone: schema.clinics.timezone })
      .from(schema.clinics)
      .where(eq(schema.clinics.id, clinicId))
      .limit(1)
  )[0];
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
  const hoje = todayISO(clinic?.timezone ?? "America/Sao_Paulo");
  const [y, m, d] = hoje.split("-");
  return {
    nome: customer.fullName ?? "",
    cpf: customer.cpf ?? "",
    telefone: customer.phoneE164 ? formatPhoneBR(customer.phoneE164) : "",
    email: customer.email ?? "",
    endereco,
    valor:
      valor !== null && Number.isFinite(Number(valor))
        ? Number(valor).toLocaleString("pt-BR", { minimumFractionDigits: 2 })
        : "",
    procedimento: procedure?.name ?? "",
    clinica: clinic?.name ?? "",
    data: `${d}/${m}/${y}`,
  };
}

/** Passo de conferência: quais variáveis o modelo usa e o que já vem preenchido. */
export const previewTermVariables = authAction({
  permission: "terms.manage",
  schema: z.object({
    customerId: z.string().uuid(),
    templateId: z.string().uuid(),
    procedureId: z.string().uuid().optional(),
    valor: z.string().optional(),
  }),
  handler: async (input, { auth, tx }) => {
    const customer = (
      await tx
        .select()
        .from(schema.customers)
        .where(eq(schema.customers.id, input.customerId))
        .limit(1)
    )[0];
    const template = (
      await tx
        .select({ bodyText: schema.documentTemplates.bodyText })
        .from(schema.documentTemplates)
        .where(eq(schema.documentTemplates.id, input.templateId))
        .limit(1)
    )[0];
    if (!customer || !template) {
      return { ok: false as const, error: "Cliente ou modelo não encontrado." };
    }
    const valorNum = input.valor ? parseBRLDecimal(input.valor) : null;
    const auto = await autoTermValues(
      tx,
      auth.clinicId,
      customer,
      input.procedureId ?? null,
      valorNum,
    );
    const usadas = extractVariables(template.bodyText);
    return {
      ok: true as const,
      variables: usadas.map((name) => ({
        name,
        label: VARIABLE_LABELS[name] ?? name,
        value: auto[name] ?? "",
        auto: Boolean(auto[name]),
      })),
    };
  },
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
    if (!template || !procedure) {
      return { ok: false, error: "Modelo ou procedimento não encontrado." };
    }

    // Automático (ficha/catálogo) + o que a equipe conferiu/editou na tela.
    // Termo legal não sai com lacuna: variável usada pelo modelo e ainda vazia
    // bloqueia, dizendo exatamente qual — nunca placeholder inventado.
    const auto = await autoTermValues(tx, auth.clinicId, customer, input.procedureId, input.valor);
    const valores: Record<string, string> = { ...auto };
    for (const [k, v] of Object.entries(input.overrides ?? {})) {
      if (k in VARIABLE_LABELS && v.trim()) valores[k] = v.trim();
    }
    const usadas = extractVariables(template.bodyText);
    const faltando = usadas.filter((v) => !valores[v]);
    if (faltando.length > 0) {
      return {
        ok: false,
        error: `Preencha antes de enviar: ${faltando.map((v) => VARIABLE_LABELS[v] ?? v).join(", ")}.`,
      };
    }

    // O que foi digitado aqui completa a ficha — SÓ campos vazios (a ficha manda)
    const fichaPatch: Partial<{ cpf: string; email: string }> = {};
    if (!customer.cpf && valores.cpf && usadas.includes("cpf")) fichaPatch.cpf = valores.cpf;
    if (!customer.email && valores.email && usadas.includes("email")) fichaPatch.email = valores.email;
    if (Object.keys(fichaPatch).length > 0) {
      await tx
        .update(schema.customers)
        .set({ ...fichaPatch, updatedAt: new Date() })
        .where(eq(schema.customers.id, customer.id));
    }

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
