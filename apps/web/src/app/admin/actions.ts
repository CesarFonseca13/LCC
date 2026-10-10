"use server";

import { randomBytes } from "node:crypto";
import argon2 from "argon2";
import { and, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { PLANS } from "@clinicaos/core/plans";
import { MAX_MONTHLY_LIMIT_BRL } from "@clinicaos/core/spend";
import { adminDb, schema } from "@clinicaos/db";
import { platformAudit, requireSuperadmin } from "@/lib/admin";

type Result = { ok: true; message?: string; password?: string } | { ok: false; error: string };

function fail(error: string): Result {
  return { ok: false, error };
}

const PLAN_IDS = PLANS.map((p) => p.id) as [string, ...string[]];
const ROLES = ["owner", "manager", "professional", "reception"] as const;

function genPassword(): string {
  // Legível, sem caracteres ambíguos; a dona troca no primeiro acesso se quiser
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  const bytes = randomBytes(10);
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return `${out.slice(0, 5)}-${out.slice(5)}`;
}

// ── Clínica: plano, preço, limite, demo, status ───────────────────────

const clinicSettingsSchema = z.object({
  clinicId: z.string().uuid(),
  plan: z.enum(PLAN_IDS),
  customMonthlyBrl: z.string().trim().max(20),
  billingNote: z.string().trim().max(200),
  monthlyLimitBrl: z.string().trim().max(20),
  allowOverage: z.boolean(),
  isDemo: z.boolean(),
  status: z.enum(["active", "suspended", "cancelled"]),
});

export async function saveClinicAdmin(raw: unknown): Promise<Result> {
  const auth = await requireSuperadmin();
  const parsed = clinicSettingsSchema.safeParse(raw);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Dados inválidos");
  const input = parsed.data;
  const custom = input.customMonthlyBrl ? Number(input.customMonthlyBrl.replace(/\./g, "").replace(",", ".")) : null;
  if (custom !== null && (!Number.isFinite(custom) || custom < 0)) return fail("Mensalidade negociada inválida");
  const limit = input.monthlyLimitBrl ? Number(input.monthlyLimitBrl.replace(/\./g, "").replace(",", ".")) : null;
  if (limit !== null && (!Number.isFinite(limit) || limit < 1 || limit > MAX_MONTHLY_LIMIT_BRL)) return fail("Limite de gastos inválido");

  const db = adminDb();
  await db.execute(sql`
    UPDATE clinics SET
      status = ${input.status},
      settings = settings
        || jsonb_build_object('plan', ${input.plan}::text, 'isDemo', ${input.isDemo}::boolean)
        || jsonb_build_object('billing', jsonb_build_object(
             'monthlyBrl', ${custom}::numeric,
             'note', ${input.billingNote || null}::text))
        || jsonb_build_object('spend',
             COALESCE(settings->'spend', '{}'::jsonb)
             || jsonb_build_object('allowOverage', ${input.allowOverage}::boolean)
             || CASE WHEN ${limit}::numeric IS NULL
                  THEN '{}'::jsonb
                  ELSE jsonb_build_object('monthlyLimitBrl', ${limit}::numeric) END)
    WHERE id = ${input.clinicId}
  `);
  if (limit === null) {
    await db.execute(sql`
      UPDATE clinics SET settings = jsonb_set(settings, '{spend}', (settings->'spend') - 'monthlyLimitBrl')
      WHERE id = ${input.clinicId} AND settings ? 'spend'
    `);
  }
  await platformAudit(auth.userId, "clinic.update", { clinicId: input.clinicId, details: input });
  revalidatePath("/admin");
  revalidatePath(`/admin/clinicas/${input.clinicId}`);
  return { ok: true, message: "Clínica atualizada." };
}

// ── Nova clínica + dona ───────────────────────────────────────────────

const newClinicSchema = z.object({
  clinicName: z.string().trim().min(2, "Nome da clínica").max(80),
  ownerName: z.string().trim().min(2, "Nome da responsável").max(80),
  ownerEmail: z.string().trim().email("E-mail inválido").max(120),
  plan: z.enum(PLAN_IDS),
  isDemo: z.boolean().default(false),
});

export async function createClinic(raw: unknown): Promise<Result> {
  const auth = await requireSuperadmin();
  const parsed = newClinicSchema.safeParse(raw);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Dados inválidos");
  const input = parsed.data;
  const email = input.ownerEmail.toLowerCase();
  const db = adminDb();
  const password = genPassword();

  const result = await db.transaction(async (tx) => {
    const [clinic] = await tx
      .insert(schema.clinics)
      .values({ name: input.clinicName, settings: { plan: input.plan, isDemo: input.isDemo } })
      .returning({ id: schema.clinics.id });
    let user = (await tx.select().from(schema.users).where(eq(schema.users.email, email)))[0];
    let createdUser = false;
    if (!user) {
      [user] = await tx
        .insert(schema.users)
        .values({ name: input.ownerName, email, passwordHash: await argon2.hash(password) })
        .returning();
      createdUser = true;
    }
    await tx
      .insert(schema.clinicMembers)
      .values({ clinicId: clinic!.id, userId: user!.id, role: "owner", active: true })
      .onConflictDoNothing();
    return { clinicId: clinic!.id, createdUser };
  });
  await platformAudit(auth.userId, "clinic.create", { clinicId: result.clinicId, target: email, details: { plan: input.plan, isDemo: input.isDemo } });
  revalidatePath("/admin");
  return {
    ok: true,
    message: result.createdUser
      ? `Clínica criada. A dona entra com ${email} e a senha abaixo; no primeiro acesso ela passa pelo wizard de implantação.`
      : `Clínica criada e vinculada ao usuário já existente ${email} (senha mantida).`,
    password: result.createdUser ? password : undefined,
  };
}

// ── Usuários da clínica ───────────────────────────────────────────────

const addUserSchema = z.object({
  clinicId: z.string().uuid(),
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().email().max(120),
  role: z.enum(ROLES),
});

export async function addClinicUser(raw: unknown): Promise<Result> {
  const auth = await requireSuperadmin();
  const parsed = addUserSchema.safeParse(raw);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Dados inválidos");
  const input = parsed.data;
  const email = input.email.toLowerCase();
  const db = adminDb();
  const password = genPassword();
  let created = false;
  await db.transaction(async (tx) => {
    let user = (await tx.select().from(schema.users).where(eq(schema.users.email, email)))[0];
    if (!user) {
      [user] = await tx
        .insert(schema.users)
        .values({ name: input.name, email, passwordHash: await argon2.hash(password) })
        .returning();
      created = true;
    }
    await tx
      .insert(schema.clinicMembers)
      .values({ clinicId: input.clinicId, userId: user!.id, role: input.role, active: true })
      .onConflictDoUpdate({
        target: [schema.clinicMembers.clinicId, schema.clinicMembers.userId],
        set: { role: input.role, active: true },
      });
  });
  await platformAudit(auth.userId, "user.add", { clinicId: input.clinicId, target: email, details: { role: input.role } });
  revalidatePath(`/admin/clinicas/${input.clinicId}`);
  return { ok: true, message: created ? `Usuário criado: ${email}` : `Usuário já existia: vinculado como ${input.role}.`, password: created ? password : undefined };
}

export async function removeClinicUser(raw: unknown): Promise<Result> {
  const auth = await requireSuperadmin();
  const parsed = z.object({ clinicId: z.string().uuid(), userId: z.string().uuid() }).safeParse(raw);
  if (!parsed.success) return fail("Dados inválidos");
  const db = adminDb();
  await db
    .update(schema.clinicMembers)
    .set({ active: false })
    .where(and(eq(schema.clinicMembers.clinicId, parsed.data.clinicId), eq(schema.clinicMembers.userId, parsed.data.userId)));
  await platformAudit(auth.userId, "user.remove", { clinicId: parsed.data.clinicId, target: parsed.data.userId });
  revalidatePath(`/admin/clinicas/${parsed.data.clinicId}`);
  return { ok: true, message: "Acesso desativado." };
}

export async function resetUserPassword(raw: unknown): Promise<Result> {
  const auth = await requireSuperadmin();
  const parsed = z.object({ clinicId: z.string().uuid(), userId: z.string().uuid() }).safeParse(raw);
  if (!parsed.success) return fail("Dados inválidos");
  const password = genPassword();
  const db = adminDb();
  await db.update(schema.users).set({ passwordHash: await argon2.hash(password) }).where(eq(schema.users.id, parsed.data.userId));
  // Derruba sessões antigas desse usuário
  await db.delete(schema.authSessions).where(eq(schema.authSessions.userId, parsed.data.userId));
  await platformAudit(auth.userId, "user.reset_password", { clinicId: parsed.data.clinicId, target: parsed.data.userId });
  return { ok: true, message: "Nova senha gerada. Entregue à pessoa por um canal seguro.", password };
}

// ── Entrar na clínica (superadmin vira membro owner) ──────────────────

export async function enterClinic(raw: unknown): Promise<Result> {
  const auth = await requireSuperadmin();
  const parsed = z.object({ clinicId: z.string().uuid() }).safeParse(raw);
  if (!parsed.success) return fail("Dados inválidos");
  const db = adminDb();
  await db
    .insert(schema.clinicMembers)
    .values({ clinicId: parsed.data.clinicId, userId: auth.userId, role: "owner", active: true })
    .onConflictDoUpdate({ target: [schema.clinicMembers.clinicId, schema.clinicMembers.userId], set: { active: true, role: "owner" } });
  await db.update(schema.authSessions).set({ activeClinicId: parsed.data.clinicId }).where(eq(schema.authSessions.id, auth.sessionId));
  await platformAudit(auth.userId, "clinic.enter", { clinicId: parsed.data.clinicId });
  redirect("/inicio");
}

export async function leaveClinic(raw: unknown): Promise<Result> {
  const auth = await requireSuperadmin();
  const parsed = z.object({ clinicId: z.string().uuid() }).safeParse(raw);
  if (!parsed.success) return fail("Dados inválidos");
  const db = adminDb();
  await db
    .update(schema.clinicMembers)
    .set({ active: false })
    .where(and(eq(schema.clinicMembers.clinicId, parsed.data.clinicId), eq(schema.clinicMembers.userId, auth.userId)));
  await db
    .update(schema.authSessions)
    .set({ activeClinicId: null })
    .where(and(eq(schema.authSessions.id, auth.sessionId), eq(schema.authSessions.activeClinicId, parsed.data.clinicId)));
  await platformAudit(auth.userId, "clinic.leave", { clinicId: parsed.data.clinicId });
  revalidatePath(`/admin/clinicas/${parsed.data.clinicId}`);
  return { ok: true, message: "Seu acesso a essa clínica foi removido." };
}

// ── Demonstração: limpar conversas ────────────────────────────────────

export async function clearDemoConversations(raw: unknown): Promise<Result> {
  const auth = await requireSuperadmin();
  const parsed = z.object({ clinicId: z.string().uuid() }).safeParse(raw);
  if (!parsed.success) return fail("Dados inválidos");
  const db = adminDb();
  const clinic = (await db.select({ settings: schema.clinics.settings }).from(schema.clinics).where(eq(schema.clinics.id, parsed.data.clinicId)))[0];
  if (!clinic || ((clinic.settings ?? {}) as Record<string, unknown>).isDemo !== true) {
    return fail("Só clínicas marcadas como demonstração podem ter as conversas limpas por aqui.");
  }
  const n = await db.transaction(async (tx) => {
    await tx.delete(schema.approvals).where(eq(schema.approvals.clinicId, parsed.data.clinicId));
    const r = await tx.delete(schema.conversations).where(eq(schema.conversations.clinicId, parsed.data.clinicId)).returning({ id: schema.conversations.id });
    return r.length;
  });
  await platformAudit(auth.userId, "demo.clear_conversations", { clinicId: parsed.data.clinicId, details: { conversations: n } });
  revalidatePath("/admin");
  return { ok: true, message: `${n} conversa(s) apagada(s). Clientes, agenda e catálogo foram mantidos.` };
}

// ── Apagar clínica (só vazia) ─────────────────────────────────────────

export async function deleteClinic(raw: unknown): Promise<Result> {
  const auth = await requireSuperadmin();
  const parsed = z.object({ clinicId: z.string().uuid(), confirmName: z.string() }).safeParse(raw);
  if (!parsed.success) return fail("Dados inválidos");
  const db = adminDb();
  const clinic = (await db.select({ id: schema.clinics.id, name: schema.clinics.name }).from(schema.clinics).where(eq(schema.clinics.id, parsed.data.clinicId)))[0];
  if (!clinic) return fail("Clínica não encontrada.");
  if (parsed.data.confirmName.trim() !== clinic.name) return fail("Digite o nome da clínica exatamente como está para confirmar.");
  const counts = (
    await db.execute(sql`
      SELECT (SELECT count(*) FROM customers WHERE clinic_id = ${clinic.id})
           + (SELECT count(*) FROM appointments WHERE clinic_id = ${clinic.id})
           + (SELECT count(*) FROM conversations WHERE clinic_id = ${clinic.id}) AS n
    `)
  ).rows[0] as { n: string | number };
  if (Number(counts.n) > 0) {
    return fail("Esta clínica já tem clientes, atendimentos ou conversas. Suspenda o acesso em vez de apagar; exclusão completa é feita com backup, pelo suporte.");
  }
  await db.transaction(async (tx) => {
    const memberIds = (await tx.select({ userId: schema.clinicMembers.userId }).from(schema.clinicMembers).where(eq(schema.clinicMembers.clinicId, clinic.id))).map((m) => m.userId);
    await tx.execute(sql`UPDATE auth_sessions SET active_clinic_id = NULL WHERE active_clinic_id = ${clinic.id}`);
    for (const table of [
      "whatsapp_templates", "whatsapp_usage", "ai_usage", "whatsapp_instances", "automation_settings", "notifications",
      "audit_log", "kb_entries", "document_templates", "anamnesis_templates", "pipeline_stages", "procedure_pairings",
      "package_items", "packages", "procedures", "professional_procedures", "professionals", "rooms",
      "clinic_members",
    ]) {
      await tx.execute(sql.raw(`DELETE FROM ${table} WHERE clinic_id = '${clinic.id}'`));
    }
    await tx.delete(schema.clinics).where(eq(schema.clinics.id, clinic.id));
    // Usuários que ficaram sem nenhuma clínica e não são admin: apaga também
    if (memberIds.length > 0) {
      const still = await tx.select({ userId: schema.clinicMembers.userId }).from(schema.clinicMembers).where(inArray(schema.clinicMembers.userId, memberIds));
      const keep = new Set(still.map((s) => s.userId));
      const orphans = memberIds.filter((id) => !keep.has(id));
      if (orphans.length > 0) {
        await tx.delete(schema.authSessions).where(inArray(schema.authSessions.userId, orphans));
        await tx.delete(schema.termsAcceptances).where(inArray(schema.termsAcceptances.userId, orphans));
        await tx.delete(schema.users).where(and(inArray(schema.users.id, orphans), eq(schema.users.isSuperadmin, false)));
      }
    }
  });
  await platformAudit(auth.userId, "clinic.delete", { clinicId: clinic.id, target: clinic.name });
  revalidatePath("/admin");
  redirect("/admin");
}
