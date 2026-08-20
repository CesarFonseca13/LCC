import { sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

/**
 * Acesso ao banco com escopo de tenant obrigatório.
 *
 * Defesa em duas camadas:
 *  1. Nenhum código de feature usa `db` cru — usa `withTenant`/`withUser`, que abrem
 *     transação e setam as variáveis de sessão que as políticas RLS leem.
 *  2. RLS FORÇADO no Postgres: mesmo um WHERE esquecido não vaza dados entre clínicas.
 */

let pool: Pool | undefined;
let database: NodePgDatabase<typeof schema> | undefined;

function getDb(): NodePgDatabase<typeof schema> {
  if (!database) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL não definida.");
    pool = new Pool({ connectionString, max: 10 });
    database = drizzle(pool, { schema });
  }
  return database;
}

export type Db = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export interface DbContext {
  /** Clínica ativa — obrigatória para qualquer dado de tenant. */
  clinicId?: string;
  /** Usuário autenticado — necessário para listar as clínicas do próprio usuário. */
  userId?: string;
}

/** Transação com contexto de tenant/usuário aplicado via set_config (lido pelas políticas RLS). */
export async function withContext<T>(
  ctx: DbContext,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  if (!ctx.clinicId && !ctx.userId) {
    throw new Error("withContext exige clinicId e/ou userId.");
  }
  return getDb().transaction(async (tx) => {
    if (ctx.clinicId) {
      await tx.execute(sql`SELECT set_config('app.clinic_id', ${ctx.clinicId}, true)`);
    }
    if (ctx.userId) {
      await tx.execute(sql`SELECT set_config('app.user_id', ${ctx.userId}, true)`);
    }
    return fn(tx);
  });
}

export async function withTenant<T>(
  clinicId: string,
  fn: (tx: Tx) => Promise<T>,
  userId?: string,
): Promise<T> {
  return withContext({ clinicId, userId }, fn);
}

/** Contexto só de usuário (pré-seleção de clínica: login, lista de clínicas). */
export async function withUser<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withContext({ userId }, fn);
}

/**
 * Acesso global SEM escopo de tenant — exclusivo para: auth (users/auth_sessions),
 * schedulers de varredura cross-tenant do worker e rotinas de plataforma.
 * Não importe isto em código de feature.
 */
export function unsafeGlobalDb(): Db {
  return getDb();
}

export async function closeDb(): Promise<void> {
  await pool?.end();
  pool = undefined;
  database = undefined;
}
