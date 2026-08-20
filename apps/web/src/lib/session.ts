import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { cookies } from "next/headers";
import { cache } from "react";
import { schema, unsafeGlobalDb, withContext } from "@clinicaos/db";
import type { Role } from "@clinicaos/core/permissions";

/**
 * Sessões opacas: o cookie carrega um token aleatório; o banco guarda apenas
 * sha256(token). Revogação é imediata (DELETE na linha).
 */
const COOKIE_NAME = "cos_session";
const SESSION_TTL_DAYS = 30;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface AuthContext {
  userId: string;
  userName: string;
  userEmail: string;
  isSuperadmin: boolean;
  sessionId: string;
  /** Clínica ativa + papel do usuário nela (null antes de selecionar/sem vínculo). */
  clinicId: string | null;
  clinicName: string | null;
  role: Role | null;
}

export async function createSession(
  userId: string,
  meta: { ip?: string; userAgent?: string },
): Promise<void> {
  const db = unsafeGlobalDb();
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 86_400_000);

  // Clínica ativa default: primeiro vínculo ativo do usuário.
  // clinic_members tem RLS — a consulta precisa do contexto de usuário.
  const memberships = await withContext({ userId }, (tx) =>
    tx
      .select({ clinicId: schema.clinicMembers.clinicId })
      .from(schema.clinicMembers)
      .where(
        and(eq(schema.clinicMembers.userId, userId), eq(schema.clinicMembers.active, true)),
      )
      .limit(1),
  );

  await db.insert(schema.authSessions).values({
    id: hashToken(token),
    userId,
    activeClinicId: memberships[0]?.clinicId ?? null,
    expiresAt,
    ip: meta.ip,
    userAgent: meta.userAgent,
  });

  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

/** Carrega a sessão do cookie (cacheada por request). null = não autenticado. */
export const getAuth = cache(async (): Promise<AuthContext | null> => {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;

  const db = unsafeGlobalDb();
  const rows = await db
    .select({
      sessionId: schema.authSessions.id,
      activeClinicId: schema.authSessions.activeClinicId,
      userId: schema.users.id,
      userName: schema.users.name,
      userEmail: schema.users.email,
      isSuperadmin: schema.users.isSuperadmin,
    })
    .from(schema.authSessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.authSessions.userId))
    .where(
      and(
        eq(schema.authSessions.id, hashToken(token)),
        gt(schema.authSessions.expiresAt, new Date()),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  let role: Role | null = null;
  let clinicName: string | null = null;
  const activeClinicId = row.activeClinicId;
  if (activeClinicId) {
    // clinic_members e clinics têm RLS — consulta com contexto de usuário + clínica.
    const member = await withContext(
      { userId: row.userId, clinicId: activeClinicId },
      (tx) =>
        tx
          .select({ role: schema.clinicMembers.role, clinicName: schema.clinics.name })
          .from(schema.clinicMembers)
          .innerJoin(schema.clinics, eq(schema.clinics.id, schema.clinicMembers.clinicId))
          .where(
            and(
              eq(schema.clinicMembers.userId, row.userId),
              eq(schema.clinicMembers.clinicId, activeClinicId),
              eq(schema.clinicMembers.active, true),
            ),
          )
          .limit(1),
    );
    role = (member[0]?.role as Role | undefined) ?? null;
    clinicName = member[0]?.clinicName ?? null;
  }

  return {
    userId: row.userId,
    userName: row.userName,
    userEmail: row.userEmail,
    isSuperadmin: row.isSuperadmin,
    sessionId: row.sessionId,
    clinicId: row.activeClinicId,
    clinicName,
    role,
  };
});

export async function destroySession(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (token) {
    await unsafeGlobalDb()
      .delete(schema.authSessions)
      .where(eq(schema.authSessions.id, hashToken(token)));
  }
  cookieStore.delete(COOKIE_NAME);
}
