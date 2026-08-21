"use server";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { schema } from "@clinicaos/db";
import { authAction } from "@/lib/auth-action";
import { parseBRLDecimal } from "@/lib/format";

/** Resultado padrão dos formulários de catálogo. */
export interface FormResult {
  ok: boolean;
  error?: string;
}

const moneySchema = z
  .string()
  .transform((v, ctx) => {
    const parsed = parseBRLDecimal(v);
    if (parsed === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Valor inválido (ex.: 180,00)" });
      return z.NEVER;
    }
    return parsed;
  });

const optionalPositiveInt = z
  .string()
  .transform((v, ctx) => {
    if (!v.trim()) return null;
    const n = Number(v);
    if (!Number.isInteger(n) || n <= 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Use um número inteiro positivo" });
      return z.NEVER;
    }
    return n;
  });

const procedureSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(2, "Informe o nome do procedimento"),
  category: z.string().trim().transform((v) => v || null),
  durationMinutes: z.coerce.number().int().min(5, "Mínimo 5 min").max(600, "Máximo 600 min"),
  price: moneySchema,
  returnDays: optionalPositiveInt,
  touchupDays: optionalPositiveInt,
  preCare: z.string().trim().transform((v) => v || null),
  postCare: z.string().trim().transform((v) => v || null),
  commissionDefaultPct: z.string().transform((v, ctx) => {
    if (!v.trim()) return null;
    const n = Number(v.replace(",", "."));
    if (Number.isNaN(n) || n < 0 || n > 100) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Percentual entre 0 e 100" });
      return z.NEVER;
    }
    return n.toFixed(2);
  }),
});

export const saveProcedure = authAction({
  permission: "catalog.manage",
  schema: procedureSchema,
  handler: async (input, { auth, tx }): Promise<FormResult> => {
    const values = {
      clinicId: auth.clinicId,
      name: input.name,
      category: input.category,
      durationMinutes: input.durationMinutes,
      price: input.price,
      returnDays: input.returnDays,
      touchupDays: input.touchupDays,
      preCare: input.preCare,
      postCare: input.postCare,
      commissionDefaultPct: input.commissionDefaultPct,
    };

    try {
      if (input.id) {
        await tx
          .update(schema.procedures)
          .set(values)
          .where(eq(schema.procedures.id, input.id));
      } else {
        await tx.insert(schema.procedures).values(values);
      }
    } catch (err) {
      if (String(err).includes("procedures_clinic_name_uq")) {
        return { ok: false, error: "Já existe um procedimento ativo com esse nome." };
      }
      throw err;
    }

    revalidatePath("/servicos");
    return { ok: true };
  },
});

export const toggleProcedureActive = authAction({
  permission: "catalog.manage",
  schema: z.object({ id: z.string().uuid(), active: z.boolean() }),
  handler: async (input, { tx }): Promise<FormResult> => {
    // Desativar procedimento que sustenta pacote ativo deixaria sessões PAGAS
    // impossíveis de agendar — bloqueia com o motivo na cara
    if (!input.active) {
      const inPackage = await tx.execute(sql`
        SELECT pk.name FROM package_items pi
        JOIN packages pk ON pk.id = pi.package_id AND pk.active
        WHERE pi.procedure_id = ${input.id}
        LIMIT 3
      `);
      if ((inPackage.rowCount ?? 0) > 0) {
        const nomes = (inPackage.rows as { name: string }[]).map((r) => r.name).join(", ");
        return {
          ok: false,
          error: `Esse procedimento faz parte do(s) pacote(s) ${nomes} — desative o pacote primeiro (clientes com sessões pagas continuam podendo usar).`,
        };
      }
    }
    try {
      await tx
        .update(schema.procedures)
        .set({ active: input.active })
        .where(eq(schema.procedures.id, input.id));
    } catch (err) {
      if (String(err).includes("procedures_clinic_name_uq")) {
        return {
          ok: false,
          error: "Já existe outro procedimento ativo com esse nome — renomeie um deles antes de reativar.",
        };
      }
      throw err;
    }
    revalidatePath("/servicos");
    return { ok: true };
  },
});

const packageSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(2, "Informe o nome do pacote"),
  price: moneySchema,
  validityDays: optionalPositiveInt,
  procedureId: z.string().uuid("Escolha o procedimento"),
  sessions: z.coerce.number().int().min(1, "Mínimo 1 sessão").max(100, "Máximo 100"),
});

export const savePackage = authAction({
  permission: "catalog.manage",
  schema: packageSchema,
  handler: async (input, { auth, tx }): Promise<FormResult> => {
    // O procedimento precisa ser DESTA clínica (RLS filtra; FK sozinha não)
    const owned = (
      await tx
        .select({ id: schema.procedures.id })
        .from(schema.procedures)
        .where(eq(schema.procedures.id, input.procedureId))
        .limit(1)
    )[0];
    if (!owned) return { ok: false, error: "Procedimento não encontrado." };

    if (input.id) {
      await tx
        .update(schema.packages)
        .set({ name: input.name, price: input.price, validityDays: input.validityDays })
        .where(eq(schema.packages.id, input.id));
      // MVP: um procedimento por pacote — substitui o item
      await tx
        .delete(schema.packageItems)
        .where(eq(schema.packageItems.packageId, input.id));
      await tx.insert(schema.packageItems).values({
        clinicId: auth.clinicId,
        packageId: input.id,
        procedureId: input.procedureId,
        sessions: input.sessions,
      });
    } else {
      const [pkg] = await tx
        .insert(schema.packages)
        .values({
          clinicId: auth.clinicId,
          name: input.name,
          price: input.price,
          validityDays: input.validityDays,
        })
        .returning({ id: schema.packages.id });
      if (!pkg) return { ok: false, error: "Falha ao criar o pacote." };
      await tx.insert(schema.packageItems).values({
        clinicId: auth.clinicId,
        packageId: pkg.id,
        procedureId: input.procedureId,
        sessions: input.sessions,
      });
    }

    revalidatePath("/servicos");
    return { ok: true };
  },
});

export const togglePackageActive = authAction({
  permission: "catalog.manage",
  schema: z.object({ id: z.string().uuid(), active: z.boolean() }),
  handler: async (input, { tx }): Promise<FormResult> => {
    await tx
      .update(schema.packages)
      .set({ active: input.active })
      .where(
        and(eq(schema.packages.id, input.id)),
      );
    revalidatePath("/servicos");
    return { ok: true };
  },
});
