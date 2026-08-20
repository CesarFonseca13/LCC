"use server";

import { and, eq, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  computeRiskSummary,
  type AnamnesisAnswers,
  type AnamnesisSchema,
} from "@clinicaos/core/anamnesis";
import { encryptSensitive } from "@clinicaos/core/crypto";
import { normalizePhoneBR } from "@clinicaos/core/phone";
import { addDaysISO, todayISO } from "@clinicaos/core/timezone";
import { schema } from "@clinicaos/db";
import { authAction } from "@/lib/auth-action";
import { parseBRLDecimal } from "@/lib/format";

export interface FormResult {
  ok: boolean;
  error?: string;
  customerId?: string;
}

function sensitiveKey(): string {
  const key = process.env.SENSITIVE_DATA_KEY;
  if (!key) throw new Error("SENSITIVE_DATA_KEY não configurada.");
  return key;
}

const phoneField = z.string().transform((v, ctx) => {
  const normalized = normalizePhoneBR(v);
  if (!normalized) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "WhatsApp inválido — use DDD + número (ex.: 11 98862-1152)",
    });
    return z.NEVER;
  }
  return normalized;
});

const optionalDate = z.string().transform((v, ctx) => {
  if (!v.trim()) return null;
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : brDateToISO(v);
  if (!iso) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Data inválida" });
    return z.NEVER;
  }
  return iso;
});

function brDateToISO(v: string): string | null {
  const m = v.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const [, d, mo, y] = m;
  const date = new Date(`${y}-${mo}-${d}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  return `${y}-${mo}-${d}`;
}

// ── Criar / editar cliente ───────────────────────────────────────────

const customerSchema = z.object({
  id: z.string().uuid().optional(),
  fullName: z.string().trim().min(2, "Informe o nome"),
  phone: phoneField,
  email: z.string().trim().transform((v) => v || null),
  cpf: z.string().trim().transform((v) => v || null),
  birthDate: optionalDate,
  socialName: z.string().trim().transform((v) => v || null),
  instagram: z.string().trim().transform((v) => v || null),
  source: z.string().trim().transform((v) => v || null),
  addressStreet: z.string().trim().transform((v) => v || null),
  addressNumber: z.string().trim().transform((v) => v || null),
  addressDistrict: z.string().trim().transform((v) => v || null),
  addressCity: z.string().trim().transform((v) => v || null),
  addressState: z.string().trim().toUpperCase().transform((v) => v || null),
  addressZip: z.string().trim().transform((v) => v || null),
  notes: z.string().trim().transform((v) => v || null),
});

export const saveCustomer = authAction({
  permission: "customers.write",
  schema: customerSchema,
  handler: async (input, { auth, tx }): Promise<FormResult> => {
    const values = {
      clinicId: auth.clinicId,
      fullName: input.fullName,
      phoneE164: input.phone,
      email: input.email,
      cpf: input.cpf,
      birthDate: input.birthDate,
      socialName: input.socialName,
      instagram: input.instagram,
      source: input.source,
      addressStreet: input.addressStreet,
      addressNumber: input.addressNumber,
      addressDistrict: input.addressDistrict,
      addressCity: input.addressCity,
      addressState: input.addressState,
      addressZip: input.addressZip,
      notes: input.notes,
    };

    try {
      if (input.id) {
        await tx
          .update(schema.customers)
          .set(values)
          .where(eq(schema.customers.id, input.id));
        revalidatePath(`/clientes/${input.id}`);
        revalidatePath("/clientes");
        return { ok: true, customerId: input.id };
      }
      const [created] = await tx
        .insert(schema.customers)
        .values(values)
        .returning({ id: schema.customers.id });
      revalidatePath("/clientes");
      return { ok: true, customerId: created?.id };
    } catch (err) {
      if (String(err).includes("customers_clinic_phone_uq")) {
        return {
          ok: false,
          error: "Já existe uma cliente com esse WhatsApp. Procure na lista — ou use a mesclagem se for duplicata.",
        };
      }
      throw err;
    }
  },
});

export const toggleAutomationsBlocked = authAction({
  permission: "customers.write",
  schema: z.object({ id: z.string().uuid(), blocked: z.boolean() }),
  handler: async (input, { tx }): Promise<FormResult> => {
    await tx
      .update(schema.customers)
      .set({ automationsBlocked: input.blocked })
      .where(eq(schema.customers.id, input.id));
    revalidatePath(`/clientes/${input.id}`);
    return { ok: true };
  },
});

// ── Anamnese (cifrada) ───────────────────────────────────────────────

const anamnesisSchema = z.object({
  customerId: z.string().uuid(),
  templateVersionId: z.string().uuid(),
  answers: z.record(z.union([z.string(), z.boolean()])),
});

export const saveAnamnesis = authAction({
  permission: "customers.clinical.write",
  schema: anamnesisSchema,
  handler: async (input, { auth, tx }): Promise<FormResult> => {
    const versions = await tx
      .select()
      .from(schema.anamnesisTemplateVersions)
      .where(eq(schema.anamnesisTemplateVersions.id, input.templateVersionId))
      .limit(1);
    const version = versions[0];
    if (!version) return { ok: false, error: "Modelo de anamnese não encontrado." };

    const templateSchema = version.schema as AnamnesisSchema;
    const validKeys = new Set(
      templateSchema.flatMap((s) => s.fields.map((f) => f.key)),
    );
    const answers: AnamnesisAnswers = {};
    for (const [key, value] of Object.entries(input.answers)) {
      if (validKeys.has(key)) answers[key] = value;
    }

    const riskSummary = computeRiskSummary(templateSchema, answers);

    await tx.insert(schema.anamnesisResponses).values({
      clinicId: auth.clinicId,
      customerId: input.customerId,
      templateVersionId: input.templateVersionId,
      answersEncrypted: encryptSensitive(JSON.stringify(answers), sensitiveKey()),
      riskSummary,
      filledByUserId: auth.userId,
    });

    // Registro LGPD: escrita de dado sensível
    await tx.insert(schema.auditLog).values({
      clinicId: auth.clinicId,
      userId: auth.userId,
      action: "create",
      tableName: "anamnesis_responses",
      recordId: input.customerId,
    });

    revalidatePath(`/clientes/${input.customerId}`);
    return { ok: true };
  },
});

// ── Histórico pré-sistema ("Inserir Histórico") ──────────────────────

const historyEntrySchema = z.object({
  customerId: z.string().uuid(),
  occurredOn: z.string().transform((v, ctx) => {
    const iso = /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : brDateToISO(v);
    if (!iso) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Data inválida" });
      return z.NEVER;
    }
    return iso;
  }),
  procedureId: z
    .string()
    .transform((v) => (v && v !== "none" ? v : null))
    .pipe(z.string().uuid().nullable()),
  procedureName: z.string().trim().transform((v) => v || null),
  amount: z.string().transform((v, ctx) => {
    if (!v.trim()) return null;
    const parsed = parseBRLDecimal(v);
    if (parsed === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Valor inválido" });
      return z.NEVER;
    }
    return parsed;
  }),
  notes: z.string().trim().transform((v) => v || null),
});

export const addHistoryEntry = authAction({
  permission: "customers.write",
  schema: historyEntrySchema,
  handler: async (input, { auth, tx }): Promise<FormResult> => {
    if (!input.procedureId && !input.procedureName) {
      return { ok: false, error: "Escolha um procedimento ou descreva-o." };
    }
    await tx.insert(schema.customerHistoryEntries).values({
      clinicId: auth.clinicId,
      customerId: input.customerId,
      occurredOn: input.occurredOn,
      procedureId: input.procedureId,
      procedureName: input.procedureName,
      amount: input.amount,
      notes: input.notes,
      createdBy: auth.userId,
    });

    // Cliente com atendimento registrado deixa de ser lead
    await tx
      .update(schema.customers)
      .set({ status: "active" })
      .where(
        and(eq(schema.customers.id, input.customerId), eq(schema.customers.status, "lead")),
      );

    revalidatePath(`/clientes/${input.customerId}`);
    revalidatePath("/clientes");
    return { ok: true };
  },
});

// ── Importação por planilha-modelo (CSV) ─────────────────────────────

export interface ImportResult {
  ok: boolean;
  error?: string;
  imported?: number;
  skipped?: { line: number; name: string; reason: string }[];
}

/** Parser CSV mínimo com suporte a aspas; separador , ou ; (auto). */
function parseCsv(text: string): string[][] {
  const sep = (text.split("\n")[0]?.match(/;/g)?.length ?? 0) >
    (text.split("\n")[0]?.match(/,/g)?.length ?? 0)
    ? ";"
    : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === sep) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else {
      cell += ch;
    }
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

const importSchema = z.object({ csv: z.string().min(1, "Arquivo vazio") });

export const importCustomersCsv = authAction({
  permission: "customers.write",
  schema: importSchema,
  handler: async (input, { auth, tx }): Promise<ImportResult> => {
    const rows = parseCsv(input.csv);
    if (rows.length < 2) {
      return { ok: false, error: "A planilha precisa do cabeçalho e de pelo menos uma linha." };
    }

    const header = rows[0]!.map((h) => h.trim().toLowerCase());
    const col = (name: string) => header.indexOf(name);
    if (col("nome") === -1 || col("telefone") === -1) {
      return {
        ok: false,
        error: 'A planilha precisa das colunas "nome" e "telefone". Baixe o modelo e preencha nele.',
      };
    }

    const existing = await tx
      .select({ phone: schema.customers.phoneE164 })
      .from(schema.customers)
      .where(isNull(schema.customers.deletedAt));
    const knownPhones = new Set(existing.map((e) => e.phone));

    const skipped: { line: number; name: string; reason: string }[] = [];
    let imported = 0;

    for (let i = 1; i < rows.length; i++) {
      const cells = rows[i]!;
      const get = (name: string) => {
        const idx = col(name);
        return idx === -1 ? "" : (cells[idx] ?? "").trim();
      };
      const name = get("nome");
      const line = i + 1;
      if (!name) {
        skipped.push({ line, name: "(sem nome)", reason: "nome vazio" });
        continue;
      }
      const phone = normalizePhoneBR(get("telefone"));
      if (!phone) {
        skipped.push({ line, name, reason: `telefone inválido: "${get("telefone")}"` });
        continue;
      }
      if (knownPhones.has(phone)) {
        skipped.push({ line, name, reason: "telefone já cadastrado" });
        continue;
      }
      knownPhones.add(phone);

      const lastVisitISO = brDateToISO(get("ultima_visita"));
      const birthISO = brDateToISO(get("nascimento"));
      const amount = parseBRLDecimal(get("total_gasto"));

      const [created] = await tx
        .insert(schema.customers)
        .values({
          clinicId: auth.clinicId,
          fullName: name,
          phoneE164: phone,
          email: get("email") || null,
          birthDate: birthISO,
          source: "import",
          status: lastVisitISO ? "active" : "lead",
        })
        .returning({ id: schema.customers.id });

      if (created && lastVisitISO) {
        await tx.insert(schema.customerHistoryEntries).values({
          clinicId: auth.clinicId,
          customerId: created.id,
          occurredOn: lastVisitISO,
          procedureName: get("ultimo_procedimento") || null,
          amount,
          notes: "Importado da planilha",
          createdBy: auth.userId,
        });
      }
      imported++;
    }

    revalidatePath("/clientes");
    return { ok: true, imported, skipped };
  },
});

// ── Pacotes: atribuição gera a conta a receber do pacote ─────────────

const assignPackageSchema = z.object({
  customerId: z.string().uuid(),
  packageId: z.string().uuid("Escolha o pacote"),
});

export const assignPackage = authAction({
  permission: "customers.write",
  schema: assignPackageSchema,
  handler: async (input, { auth, tx }): Promise<FormResult> => {
    const pkg = (
      await tx
        .select()
        .from(schema.packages)
        .where(and(eq(schema.packages.id, input.packageId), eq(schema.packages.active, true)))
        .limit(1)
    )[0];
    if (!pkg) return { ok: false, error: "Pacote não encontrado." };

    const item = (
      await tx
        .select()
        .from(schema.packageItems)
        .where(eq(schema.packageItems.packageId, input.packageId))
        .limit(1)
    )[0];
    if (!item) return { ok: false, error: "Pacote sem procedimento vinculado." };

    const today = todayISO("America/Sao_Paulo");
    const [customerPackage] = await tx
      .insert(schema.customerPackages)
      .values({
        clinicId: auth.clinicId,
        customerId: input.customerId,
        packageId: pkg.id,
        procedureId: item.procedureId,
        sessionsTotal: item.sessions,
        pricePaid: pkg.price,
        purchasedAt: today,
        expiresAt: pkg.validityDays ? addDaysISO(today, pkg.validityDays) : null,
        createdBy: auth.userId,
      })
      .returning({ id: schema.customerPackages.id });
    if (!customerPackage) return { ok: false, error: "Falha ao atribuir o pacote." };

    // Venda do pacote → conta a receber (categoria Pacotes)
    let category = (
      await tx
        .select({ id: schema.financeCategories.id })
        .from(schema.financeCategories)
        .where(
          and(
            eq(schema.financeCategories.clinicId, auth.clinicId),
            eq(schema.financeCategories.kind, "income"),
            eq(schema.financeCategories.name, "Pacotes"),
          ),
        )
        .limit(1)
    )[0];
    if (!category) {
      const [created] = await tx
        .insert(schema.financeCategories)
        .values({ clinicId: auth.clinicId, name: "Pacotes", kind: "income" })
        .onConflictDoNothing()
        .returning({ id: schema.financeCategories.id });
      category = created;
    }
    const customer = (
      await tx
        .select({ fullName: schema.customers.fullName })
        .from(schema.customers)
        .where(eq(schema.customers.id, input.customerId))
        .limit(1)
    )[0];
    await tx.insert(schema.receivables).values({
      clinicId: auth.clinicId,
      customerId: input.customerId,
      customerPackageId: customerPackage.id,
      categoryId: category?.id ?? null,
      description: `${pkg.name} — ${customer?.fullName ?? "Cliente"}`,
      grossAmount: pkg.price,
      netAmount: pkg.price,
      dueDate: today,
    });

    revalidatePath(`/clientes/${input.customerId}`);
    revalidatePath("/financeiro");
    return { ok: true };
  },
});

// ── Mesclagem de duplicatas ──────────────────────────────────────────

const mergeSchema = z.object({
  sourceId: z.string().uuid(),
  targetId: z.string().uuid(),
});

export const mergeCustomers = authAction({
  permission: "customers.write",
  schema: mergeSchema,
  handler: async (input, { auth, tx }): Promise<FormResult> => {
    if (input.sourceId === input.targetId) {
      return { ok: false, error: "Escolha uma cliente diferente para mesclar." };
    }
    const found = await tx
      .select({ id: schema.customers.id, phone: schema.customers.phoneE164 })
      .from(schema.customers)
      .where(
        and(
          sql`${schema.customers.id} IN (${input.sourceId}, ${input.targetId})`,
          isNull(schema.customers.deletedAt),
        ),
      );
    if (found.length !== 2) return { ok: false, error: "Cliente não encontrada." };
    const source = found.find((f) => f.id === input.sourceId)!;

    // Re-aponta dados da duplicata para a cliente principal
    await tx
      .update(schema.customerHistoryEntries)
      .set({ customerId: input.targetId })
      .where(eq(schema.customerHistoryEntries.customerId, input.sourceId));
    await tx
      .update(schema.anamnesisResponses)
      .set({ customerId: input.targetId })
      .where(eq(schema.anamnesisResponses.customerId, input.sourceId));
    await tx.execute(sql`
      INSERT INTO customer_tags (customer_id, tag_id, clinic_id)
      SELECT ${input.targetId}, tag_id, clinic_id FROM customer_tags
      WHERE customer_id = ${input.sourceId}
      ON CONFLICT DO NOTHING
    `);
    await tx.execute(sql`
      INSERT INTO customer_phones (clinic_id, customer_id, phone_e164, label)
      SELECT clinic_id, ${input.targetId}, phone_e164, label FROM customer_phones
      WHERE customer_id = ${input.sourceId}
      ON CONFLICT DO NOTHING
    `);
    // Telefone principal da duplicata vira secundário da principal
    await tx.execute(sql`
      INSERT INTO customer_phones (clinic_id, customer_id, phone_e164, label)
      VALUES (${auth.clinicId}, ${input.targetId}, ${source.phone}, 'mesclado')
      ON CONFLICT DO NOTHING
    `);
    // Funil: negociações fechadas migram; a aberta migra só se a principal
    // não tiver outra aberta (senão encerra como mesclada — nunca duplica card)
    await tx.execute(sql`
      UPDATE deals SET customer_id = ${input.targetId}
      WHERE customer_id = ${input.sourceId} AND status <> 'open'
    `);
    await tx.execute(sql`
      UPDATE deals SET customer_id = ${input.targetId}
      WHERE customer_id = ${input.sourceId} AND status = 'open'
        AND NOT EXISTS (
          SELECT 1 FROM deals d2 WHERE d2.customer_id = ${input.targetId} AND d2.status = 'open'
        )
    `);
    await tx.execute(sql`
      UPDATE deals SET status = 'lost', lost_at = now(), lost_reason = 'Ficha mesclada',
                       updated_at = now()
      WHERE customer_id = ${input.sourceId} AND status = 'open'
    `);

    await tx
      .update(schema.customers)
      .set({ deletedAt: new Date(), mergedIntoId: input.targetId })
      .where(eq(schema.customers.id, input.sourceId));

    await tx.insert(schema.auditLog).values({
      clinicId: auth.clinicId,
      userId: auth.userId,
      action: "update",
      tableName: "customers",
      recordId: input.targetId,
      changes: { merged_from: input.sourceId },
    });

    revalidatePath("/clientes");
    revalidatePath(`/clientes/${input.targetId}`);
    return { ok: true, customerId: input.targetId };
  },
});
