/**
 * Cria (ou promove) o administrador da plataforma.
 *   ADMIN_EMAIL=... ADMIN_PASSWORD=... ADMIN_NAME="..." tsx src/make-admin.ts
 * Idempotente: se o e-mail já existe, só marca is_superadmin (e troca a senha se ADMIN_PASSWORD vier).
 */
import argon2 from "argon2";
import { config as loadEnv } from "dotenv";
import { eq } from "drizzle-orm";
import { closeDb, unsafeGlobalDb } from "./client";
import * as schema from "./schema";

loadEnv({ path: "../../.env" });

async function main() {
  const email = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD ?? "";
  const name = (process.env.ADMIN_NAME ?? "Administrador").trim();
  if (!email) throw new Error("ADMIN_EMAIL obrigatório");
  const db = unsafeGlobalDb();
  const existing = (await db.select().from(schema.users).where(eq(schema.users.email, email)))[0];
  if (existing) {
    await db
      .update(schema.users)
      .set({ isSuperadmin: true, ...(password ? { passwordHash: await argon2.hash(password) } : {}) })
      .where(eq(schema.users.id, existing.id));
    console.log(`Promovido a superadmin: ${email}${password ? " (senha atualizada)" : ""}`);
  } else {
    if (!password) throw new Error("ADMIN_PASSWORD obrigatório para criar o usuário");
    await db.insert(schema.users).values({ name, email, passwordHash: await argon2.hash(password), isSuperadmin: true });
    console.log(`Superadmin criado: ${email}`);
  }
  await closeDb();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
