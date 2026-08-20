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

  const db = unsafeGlobalDb();
  const users = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, parsed.data.email))
    .limit(1);

  const user = users[0];
  // Mensagem única para e-mail inexistente e senha errada (não vaza quem tem conta)
  const genericError = { error: "E-mail ou senha incorretos", email: typedEmail };
  if (!user?.passwordHash) return genericError;

  const valid = await argon2.verify(user.passwordHash, parsed.data.password);
  if (!valid) return genericError;

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
