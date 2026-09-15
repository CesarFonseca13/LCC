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
import {
  formatCPF,
  formatDecimalBR,
  isValidEmail,
  normalizeCPF,
  parseBRLDecimal,
} from "@/lib/format";

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
    // {{hora}}, {{link}} etc. existem para mensagens de WhatsApp; num termo não
    // teriam de onde vir e o envio nunca conseguiria completar.
    const foraDoTermo = extractVariables(input.bodyText).filter((v) => !(v in VARIABLE_LABELS));
    if (foraDoTermo.length > 0) {
      return {
        ok: false,
        error: `Variável não disponível em termos: ${foraDoTermo.map((v) => `{{${v}}}`).join(", ")}. Use ${Object.keys(VARIABLE_LABELS).map((v) => `{{${v}}}`).join(", ")}.`,
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
  /** Valores conferidos/editados na tela — prevalecem sobre os da ficha.
   *  Só entram os que o modelo usa; valor/procedimento/clínica/data vêm sempre
   *  do formulário e do cadastro (nunca de texto livre). */
  overrides: z.record(z.string(), z.string()).optional(),
});

/** Variáveis que um termo pode usar, com rótulo humano (vai para a tela dentro
 *  da resposta do preview — módulo "use server" só exporta funções assíncronas). */
const VARIABLE_LABELS: Record<string, string> = {
  nome: "Nome completo",
  cpf: "CPF",
  telefone: "Telefone",
  email: "E-mail",
  endereco: "Endereço",
  profissional: "Profissional",
  valor: "Valor (R$)",
  procedimento: "Procedimento",
  clinica: "Clínica",
  data: "Data",
};

/** De onde vem cada variável — a tela mostra a origem e só deixa editar o que
 *  não é derivado do próprio formulário ou do cadastro da clínica. */
type VariableSource = "ficha" | "clinica" | "hoje" | "formulario" | "manual";
const VARIABLE_SOURCE: Record<string, VariableSource> = {
  nome: "ficha",
  cpf: "ficha",
  telefone: "ficha",
  email: "ficha",
  endereco: "ficha",
  profissional: "manual",
  valor: "formulario",
  procedimento: "formulario",
  clinica: "clinica",
  data: "hoje",
};
const DERIVED_VARIABLES = new Set(["valor", "procedimento", "clinica", "data"]);

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
    valor: valor !== null ? formatDecimalBR(valor) : "",
    procedimento: procedure?.name ?? "",
    clinica: clinic?.name ?? "",
    data: `${d}/${m}/${y}`,
  };
}

/** Passo de conferência: quais variáveis o modelo usa e o que já vem preenchido.
 *  Valor e procedimento a tela calcula sozinha a partir do formulário (por isso
 *  não entram aqui — evita uma ida ao servidor a cada tecla no valor). */
export const previewTermVariables = authAction({
  permission: "terms.manage",
  schema: z.object({
    customerId: z.string().uuid(),
    templateId: z.string().uuid(),
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
    const auto = await autoTermValues(tx, auth.clinicId, customer, null, null);
    const usadas = extractVariables(template.bodyText);
    return {
      ok: true as const,
      variables: usadas.map((name) => ({
        name,
        label: VARIABLE_LABELS[name] ?? name,
        value: auto[name] ?? "",
        source: VARIABLE_SOURCE[name] ?? ("manual" as VariableSource),
        editable: !DERIVED_VARIABLES.has(name),
      })),
    };
  },
});

async function queueWhatsAppText(
  tx: Tx,
  clinicId: string,
  customerPhone: string,
  body: string,
  /** Valores para o template da Meta (API oficial fora da janela de 24h). */
  templateVars: Record<string, string>,
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
    templateVars,
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
    // Só entra override de variável que o modelo usa e que não é derivada do
    // formulário/cadastro (valor, procedimento, clínica, data). Termo legal não
    // sai com lacuna: variável usada e ainda vazia bloqueia, dizendo qual.
    const auto = await autoTermValues(tx, auth.clinicId, customer, input.procedureId, input.valor);
    const valores: Record<string, string> = { ...auto };
    const usadas = extractVariables(template.bodyText);
    const digitados: Record<string, string> = {};
    for (const [k, v] of Object.entries(input.overrides ?? {})) {
      if (usadas.includes(k) && !DERIVED_VARIABLES.has(k) && v.trim()) digitados[k] = v.trim();
    }
    Object.assign(valores, digitados);
    const faltando = usadas.filter((v) => !valores[v]);
    if (faltando.length > 0) {
      return {
        ok: false,
        error: `Preencha antes de enviar: ${faltando.map((v) => VARIABLE_LABELS[v] ?? v).join(", ")}.`,
      };
    }
    // Documento legal: CPF e e-mail precisam ter formato, venham da ficha ou da tela
    if (usadas.includes("cpf")) {
      const cpf = normalizeCPF(valores.cpf ?? "");
      if (!cpf) {
        return { ok: false, error: "CPF precisa ter 11 dígitos — corrija aqui ou na ficha da cliente." };
      }
      valores.cpf = formatCPF(cpf);
    }
    if (usadas.includes("email") && !isValidEmail(valores.email ?? "")) {
      return { ok: false, error: "E-mail inválido — corrija aqui ou na ficha da cliente." };
    }

    // CPF/e-mail digitados aqui completam a ficha — SÓ campos vazios (a ficha manda)
    const fichaPatch: Partial<{ cpf: string; email: string }> = {};
    if (!customer.cpf && digitados.cpf !== undefined) fichaPatch.cpf = valores.cpf;
    if (!customer.email && digitados.email !== undefined) fichaPatch.email = valores.email;
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
        // Evidência do termo: só o que de fato entrou no texto assinado
        variablesSnapshot: Object.fromEntries(usadas.map((v) => [v, valores[v] ?? ""])),
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
      { nome: primeiroNome, procedimento: procedure.name, link_token: signToken },
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
    const procedureName =
      (doc.procedureId
        ? (
            await tx
              .select({ name: schema.procedures.name })
              .from(schema.procedures)
              .where(eq(schema.procedures.id, doc.procedureId))
              .limit(1)
          )[0]?.name
        : null) ?? "procedimento";
    const primeiroNome = customer.fullName.split(" ")[0] ?? customer.fullName;
    const sent = await queueWhatsAppText(
      tx,
      auth.clinicId,
      customer.phoneE164,
      `Oi ${primeiroNome}! Passando para lembrar do seu termo de consentimento — leva 1 minutinho para assinar: ${signUrl}`,
      { nome: primeiroNome, procedimento: procedureName, link_token: newToken },
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
