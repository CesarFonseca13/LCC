"use server";

import { randomBytes } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { addDaysISO, todayISO } from "@clinicaos/core/timezone";
import { schema, type Tx } from "@clinicaos/db";
import { authAction } from "@/lib/auth-action";
import { parseBRLDecimal } from "@/lib/format";

export interface QuoteResult {
  ok: boolean;
  error?: string;
  quoteUrl?: string;
  whatsappSent?: boolean;
}

async function nextQuoteNumber(tx: Tx, clinicId: string): Promise<number> {
  const rows = await tx.execute(sql`
    INSERT INTO clinic_counters (clinic_id, key, value) VALUES (${clinicId}, 'quote', 1)
    ON CONFLICT (clinic_id, key) DO UPDATE SET value = clinic_counters.value + 1
    RETURNING value
  `);
  return Number((rows.rows[0] as { value: number }).value);
}

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
    automationId: "quote",
    scheduledFor: new Date(Date.now() + 2_000 + Math.floor(Math.random() * 5_000)),
  });
  return true;
}

// ── Criar e enviar ───────────────────────────────────────────────────

const itemSchema = z.object({
  kind: z.enum(["procedure", "package"]),
  refId: z.string().uuid(),
  quantity: z.coerce.number().int().min(1).max(50),
  unitPrice: z.string().transform((v, ctx) => {
    const parsed = parseBRLDecimal(v);
    if (parsed === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Preço inválido" });
      return z.NEVER;
    }
    return parsed;
  }),
});

const createQuoteSchema = z.object({
  customerId: z.string().uuid("Escolha a cliente"),
  items: z.array(itemSchema).min(1, "Adicione pelo menos um item"),
  discount: z.string().transform((v, ctx) => {
    if (!v.trim()) return "0.00";
    const parsed = parseBRLDecimal(v);
    if (parsed === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Desconto inválido" });
      return z.NEVER;
    }
    return parsed;
  }),
  validDays: z.coerce.number().int().min(1).max(90).default(7),
  notes: z.string().trim().transform((v) => v || null),
});

export const createAndSendQuote = authAction({
  permission: "quotes.manage",
  schema: createQuoteSchema,
  handler: async (input, { auth, tx }): Promise<QuoteResult> => {
    const customer = (
      await tx
        .select({ fullName: schema.customers.fullName, phoneE164: schema.customers.phoneE164 })
        .from(schema.customers)
        .where(eq(schema.customers.id, input.customerId))
        .limit(1)
    )[0];
    if (!customer) return { ok: false, error: "Cliente não encontrada." };

    // Resolve descrições dos itens no catálogo (nunca confia no rótulo do cliente)
    const resolved: {
      kind: "procedure" | "package";
      procedureId: string | null;
      packageId: string | null;
      description: string;
      quantity: number;
      unitPrice: string;
      total: string;
    }[] = [];
    for (const item of input.items) {
      if (item.kind === "procedure") {
        const proc = (
          await tx
            .select({ name: schema.procedures.name })
            .from(schema.procedures)
            .where(eq(schema.procedures.id, item.refId))
            .limit(1)
        )[0];
        if (!proc) return { ok: false, error: "Procedimento não encontrado." };
        resolved.push({
          kind: "procedure",
          procedureId: item.refId,
          packageId: null,
          description: proc.name,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          total: (Number(item.unitPrice) * item.quantity).toFixed(2),
        });
      } else {
        const pkg = (
          await tx
            .select({ name: schema.packages.name })
            .from(schema.packages)
            .where(eq(schema.packages.id, item.refId))
            .limit(1)
        )[0];
        if (!pkg) return { ok: false, error: "Pacote não encontrado." };
        resolved.push({
          kind: "package",
          procedureId: null,
          packageId: item.refId,
          description: pkg.name,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          total: (Number(item.unitPrice) * item.quantity).toFixed(2),
        });
      }
    }

    const subtotal = resolved.reduce((acc, i) => acc + Number(i.total), 0);
    const discount = Number(input.discount);
    if (discount > subtotal) return { ok: false, error: "Desconto maior que o subtotal." };
    const total = (subtotal - discount).toFixed(2);

    const number = await nextQuoteNumber(tx, auth.clinicId);
    const publicToken = randomBytes(24).toString("base64url");
    const hoje = todayISO("America/Sao_Paulo");

    const [quote] = await tx
      .insert(schema.quotes)
      .values({
        clinicId: auth.clinicId,
        customerId: input.customerId,
        number,
        validUntil: addDaysISO(hoje, input.validDays),
        subtotal: subtotal.toFixed(2),
        discountAmount: discount.toFixed(2),
        total,
        notes: input.notes,
        publicToken,
        createdBy: auth.userId,
      })
      .returning({ id: schema.quotes.id });
    if (!quote) return { ok: false, error: "Falha ao criar o orçamento." };

    await tx.insert(schema.quoteItems).values(
      resolved.map((i) => ({
        clinicId: auth.clinicId,
        quoteId: quote.id,
        kind: i.kind,
        procedureId: i.procedureId,
        packageId: i.packageId,
        description: i.description,
        quantity: i.quantity,
        unitPrice: i.unitPrice,
        total: i.total,
      })),
    );

    const appUrl = process.env.APP_URL ?? "http://localhost:3000";
    const quoteUrl = `${appUrl}/orcamento/${publicToken}`;
    const primeiroNome = customer.fullName.split(" ")[0];
    const whatsappSent = await queueWhatsAppText(
      tx,
      auth.clinicId,
      customer.phoneE164,
      `Oi ${primeiroNome}! Preparei seu orçamento com todo carinho 💛 É só abrir aqui para ver os detalhes — e qualquer dúvida me chama: ${quoteUrl}`,
    );

    revalidatePath("/orcamentos");
    return { ok: true, quoteUrl, whatsappSent };
  },
});

// ── Aceite manual / recusa ───────────────────────────────────────────

export const setQuoteStatus = authAction({
  permission: "quotes.manage",
  schema: z.object({
    id: z.string().uuid(),
    status: z.enum(["accepted", "rejected"]),
  }),
  handler: async (input, { tx }): Promise<QuoteResult> => {
    const updated = await tx
      .update(schema.quotes)
      .set({
        status: input.status,
        acceptedAt: input.status === "accepted" ? new Date() : null,
      })
      .where(
        and(
          eq(schema.quotes.id, input.id),
          sql`${schema.quotes.status} IN ('sent','viewed')`,
        ),
      )
      .returning({ id: schema.quotes.id });
    if (!updated[0]) return { ok: false, error: "Orçamento não está mais pendente." };
    revalidatePath("/orcamentos");
    return { ok: true };
  },
});

// ── Conversão em venda ───────────────────────────────────────────────

export const convertQuote = authAction({
  permission: "quotes.manage",
  schema: z.object({ id: z.string().uuid() }),
  handler: async (input, { auth, tx }): Promise<QuoteResult> => {
    const quote = (
      await tx
        .select()
        .from(schema.quotes)
        .where(eq(schema.quotes.id, input.id))
        .limit(1)
    )[0];
    if (!quote) return { ok: false, error: "Orçamento não encontrado." };
    if (quote.status !== "accepted") {
      return { ok: false, error: "Só orçamentos aceitos podem virar venda." };
    }
    if (quote.convertedAt) return { ok: false, error: "Este orçamento já virou venda." };

    // Claim atômico contra duplo clique
    const claimed = await tx
      .update(schema.quotes)
      .set({ convertedAt: new Date() })
      .where(and(eq(schema.quotes.id, input.id), isNull(schema.quotes.convertedAt)))
      .returning({ id: schema.quotes.id });
    if (!claimed[0]) return { ok: false, error: "Este orçamento já virou venda." };

    const items = await tx
      .select()
      .from(schema.quoteItems)
      .where(eq(schema.quoteItems.quoteId, input.id));
    const customer = (
      await tx
        .select({ fullName: schema.customers.fullName })
        .from(schema.customers)
        .where(eq(schema.customers.id, quote.customerId))
        .limit(1)
    )[0];
    const hoje = todayISO("America/Sao_Paulo");

    // Pacotes do orçamento viram pacotes da cliente (sem conta própria — o total cobre).
    // O desconto do orçamento é RATEADO no preço pago do pacote: comissão por
    // sessão e renovação enxergam o valor que a cliente pagou de verdade.
    const subtotalNum = Number(quote.subtotal);
    const discountFactor =
      subtotalNum > 0 ? 1 - Number(quote.discountAmount ?? 0) / subtotalNum : 1;
    for (const item of items) {
      if (item.kind !== "package" || !item.packageId) continue;
      const pkg = (
        await tx
          .select()
          .from(schema.packages)
          .where(eq(schema.packages.id, item.packageId))
          .limit(1)
      )[0];
      const pkgItem = (
        await tx
          .select()
          .from(schema.packageItems)
          .where(eq(schema.packageItems.packageId, item.packageId))
          .limit(1)
      )[0];
      if (!pkg || !pkgItem) continue;
      for (let i = 0; i < item.quantity; i++) {
        await tx.insert(schema.customerPackages).values({
          clinicId: auth.clinicId,
          customerId: quote.customerId,
          packageId: pkg.id,
          procedureId: pkgItem.procedureId,
          sessionsTotal: pkgItem.sessions,
          pricePaid: (Number(item.unitPrice) * discountFactor).toFixed(2),
          purchasedAt: hoje,
          expiresAt: pkg.validityDays ? addDaysISO(hoje, pkg.validityDays) : null,
          createdBy: auth.userId,
        });
      }
    }

    // Conta a receber única com o total do orçamento
    let category = (
      await tx
        .select({ id: schema.financeCategories.id })
        .from(schema.financeCategories)
        .where(
          and(
            eq(schema.financeCategories.clinicId, auth.clinicId),
            eq(schema.financeCategories.kind, "income"),
            eq(schema.financeCategories.name, "Orçamentos"),
          ),
        )
        .limit(1)
    )[0];
    if (!category) {
      const [created] = await tx
        .insert(schema.financeCategories)
        .values({ clinicId: auth.clinicId, name: "Orçamentos", kind: "income" })
        .onConflictDoNothing()
        .returning({ id: schema.financeCategories.id });
      category = created;
    }
    await tx.insert(schema.receivables).values({
      clinicId: auth.clinicId,
      customerId: quote.customerId,
      categoryId: category?.id ?? null,
      description: `Orçamento #${quote.number} — ${customer?.fullName ?? "Cliente"}`,
      grossAmount: quote.total,
      netAmount: quote.total,
      dueDate: hoje,
    });

    revalidatePath("/orcamentos");
    revalidatePath("/financeiro");
    revalidatePath(`/clientes/${quote.customerId}`);
    return { ok: true };
  },
});
