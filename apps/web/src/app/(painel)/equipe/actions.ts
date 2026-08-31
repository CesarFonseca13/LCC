"use server";

import { randomBytes } from "node:crypto";
import argon2 from "argon2";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { schema, unsafeGlobalDb } from "@clinicaos/db";
import { authAction } from "@/lib/auth-action";

export interface FormResult {
  ok: boolean;
  error?: string;
  /** Senha temporária gerada — mostrada uma única vez para a administradora. */
  tempPassword?: string;
  info?: string;
}

// ── Profissionais (recurso de agenda) ────────────────────────────────

const professionalSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(2, "Informe o nome"),
  specialty: z.string().trim().transform((v) => v || null),
  registrationNumber: z.string().trim().transform((v) => v || null),
  calendarColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Cor inválida"),
  /** null/ausente = faz TODOS os serviços; lista = somente os marcados. */
  procedureIds: z.array(z.string().uuid()).nullable().optional(),
});

export const saveProfessional = authAction({
  permission: "team.manage",
  schema: professionalSchema,
  handler: async (input, { auth, tx }): Promise<FormResult> => {
    if (Array.isArray(input.procedureIds) && input.procedureIds.length === 0) {
      return { ok: false, error: "Marque pelo menos um serviço — ou volte para 'faz todos'." };
    }
    const values = {
      clinicId: auth.clinicId,
      name: input.name,
      specialty: input.specialty,
      registrationNumber: input.registrationNumber,
      calendarColor: input.calendarColor,
    };
    let profId = input.id;
    if (input.id) {
      await tx
        .update(schema.professionals)
        .set(values)
        .where(eq(schema.professionals.id, input.id));
    } else {
      const [created] = await tx
        .insert(schema.professionals)
        .values(values)
        .returning({ id: schema.professionals.id });
      profId = created?.id;
    }
    if (profId) {
      // Vínculos de serviço: sem linhas = faz todos (padrão)
      await tx
        .delete(schema.professionalProcedures)
        .where(eq(schema.professionalProcedures.professionalId, profId));
      if (input.procedureIds && input.procedureIds.length > 0) {
        await tx.insert(schema.professionalProcedures).values(
          input.procedureIds.map((procedureId) => ({
            clinicId: auth.clinicId,
            professionalId: profId!,
            procedureId,
          })),
        );
      }
    }
    revalidatePath("/equipe");
    return { ok: true };
  },
});

export const toggleProfessionalActive = authAction({
  permission: "team.manage",
  schema: z.object({ id: z.string().uuid(), active: z.boolean() }),
  handler: async (input, { tx }): Promise<FormResult> => {
    await tx
      .update(schema.professionals)
      .set({ active: input.active })
      .where(eq(schema.professionals.id, input.id));
    revalidatePath("/equipe");
    return { ok: true };
  },
});

// ── Acessos (usuários com login) ─────────────────────────────────────

const memberSchema = z.object({
  name: z.string().trim().min(2, "Informe o nome"),
  email: z.string().trim().email("E-mail inválido").toLowerCase(),
  role: z.enum(["owner", "manager", "professional", "reception"]),
  professionalId: z
    .string()
    .transform((v) => (v && v !== "none" ? v : null))
    .pipe(z.string().uuid().nullable()),
});

export const createMember = authAction({
  permission: "team.manage",
  schema: memberSchema,
  handler: async (input, { auth, tx }): Promise<FormResult> => {
    const globalDb = unsafeGlobalDb();

    // users é tabela global — e-mail pode já existir (pessoa em outra clínica)
    const existing = await globalDb
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, input.email))
      .limit(1);

    let userId: string;
    let tempPassword: string | undefined;
    let info: string | undefined;
    let createdNewUser = false;

    if (existing[0]) {
      userId = existing[0].id;
      info = "Essa pessoa já tinha conta no sistema — o acesso à clínica foi adicionado.";
    } else {
      tempPassword = randomBytes(6).toString("base64url");
      const passwordHash = await argon2.hash(tempPassword);
      const [created] = await globalDb
        .insert(schema.users)
        .values({ name: input.name, email: input.email, passwordHash })
        .onConflictDoNothing()
        .returning({ id: schema.users.id });
      if (!created) return { ok: false, error: "Falha ao criar o usuário — tente de novo." };
      userId = created.id;
      createdNewUser = true;
    }

    try {
      await tx.insert(schema.clinicMembers).values({
        clinicId: auth.clinicId,
        userId,
        role: input.role,
        professionalId: input.professionalId,
      });
    } catch (err) {
      // users é global e foi criado fora desta transação: sem vínculo, limpa o órfão
      if (createdNewUser) {
        await globalDb.delete(schema.users).where(eq(schema.users.id, userId));
      }
      if (String(err).includes("clinic_members_clinic_user_uq")) {
        return { ok: false, error: "Essa pessoa já tem acesso a esta clínica." };
      }
      throw err;
    }

    revalidatePath("/equipe");
    return { ok: true, tempPassword, info };
  },
});

export const toggleMemberActive = authAction({
  permission: "team.manage",
  schema: z.object({ id: z.string().uuid(), active: z.boolean() }),
  handler: async (input, { auth, tx }): Promise<FormResult> => {
    // Trava de segurança: a dona não pode remover o próprio acesso
    const rows = await tx
      .select({ userId: schema.clinicMembers.userId })
      .from(schema.clinicMembers)
      .where(eq(schema.clinicMembers.id, input.id))
      .limit(1);
    if (rows[0]?.userId === auth.userId && !input.active) {
      return { ok: false, error: "Você não pode remover o seu próprio acesso." };
    }

    await tx
      .update(schema.clinicMembers)
      .set({ active: input.active })
      .where(eq(schema.clinicMembers.id, input.id));

    // Desativar acesso derruba as sessões vivas AGORA (não em 30 dias)
    if (!input.active && rows[0]?.userId) {
      await unsafeGlobalDb()
        .delete(schema.authSessions)
        .where(eq(schema.authSessions.userId, rows[0].userId));
    }
    revalidatePath("/equipe");
    return { ok: true };
  },
});

// ── Salas ────────────────────────────────────────────────────────────

export const saveRoom = authAction({
  permission: "team.manage",
  schema: z.object({ name: z.string().trim().min(1, "Informe o nome da sala") }),
  handler: async (input, { auth, tx }): Promise<FormResult> => {
    await tx.insert(schema.rooms).values({ clinicId: auth.clinicId, name: input.name });
    revalidatePath("/equipe");
    return { ok: true };
  },
});

export const toggleRoomActive = authAction({
  permission: "team.manage",
  schema: z.object({ id: z.string().uuid(), active: z.boolean() }),
  handler: async (input, { tx }): Promise<FormResult> => {
    await tx
      .update(schema.rooms)
      .set({ active: input.active })
      .where(eq(schema.rooms.id, input.id));
    revalidatePath("/equipe");
    return { ok: true };
  },
});
