"use server";

import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import argon2 from "argon2";
import { z } from "zod";
import { schema, unsafeGlobalDb } from "@clinicaos/db";
import { createSession, destroySession } from "@/lib/session";

const loginSchema = z.object({
  email: z.string().email("Informe um e-mail válido"),
  password: z.string().min(1, "Informe a senha"),
});

export interface LoginState {
  error?: string;
  /** Preserva o e-mail digitado quando o login falha (o form é resetado pelo React). */
  email?: string;
}

/**
 * Anti força bruta simples (processo único da VPS): 10 tentativas por e-mail
 * a cada 15 minutos. Em memória — reinício do processo zera, o que é aceitável
 * para o formulário de login (a senha continua argon2id).
 */
const attempts = new Map<string, { count: number; resetAt: number }>();
const MAX_ATTEMPTS = 10;
const WINDOW_MS = 15 * 60_000;

function tooManyAttempts(key: string): boolean {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || entry.resetAt < now) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  entry.count++;
  if (attempts.size > 5_000) attempts.clear();
  return entry.count > MAX_ATTEMPTS;
}

/** Hash de referência: e-mail inexistente custa o MESMO tempo que senha errada. */
const DUMMY_HASH_PROMISE = argon2.hash("clinicaos-timing-shield");

export async function loginAction(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const typedEmail = String(formData.get("email") ?? "");
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? "Dados inválidos",
      email: typedEmail,
    };
  }

  if (tooManyAttempts(parsed.data.email.toLowerCase())) {
    return {
      error: "Muitas tentativas — aguarde alguns minutos e tente de novo.",
      email: typedEmail,
    };
  }

  const db = unsafeGlobalDb();
  const users = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, parsed.data.email))
    .limit(1);

  const user = users[0];
  // Mensagem única E custo de tempo único para e-mail inexistente e senha errada
  // (nem a mensagem nem o relógio entregam quem tem conta)
  const genericError = { error: "E-mail ou senha incorretos", email: typedEmail };
  const hashToCheck = user?.passwordHash ?? (await DUMMY_HASH_PROMISE);
  const valid = await argon2.verify(hashToCheck, parsed.data.password);
  if (!user?.passwordHash || !valid) return genericError;

  const headerStore = await headers();
  await createSession(user.id, {
    ip: headerStore.get("x-forwarded-for")?.split(",")[0]?.trim(),
    userAgent: headerStore.get("user-agent") ?? undefined,
  });

  redirect("/inicio");
}

export async function logoutAction(): Promise<void> {
  await destroySession();
  redirect("/login");
}
