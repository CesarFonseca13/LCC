import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

/**
 * Migrador simples e determinístico: aplica migrations/*.sql em ordem lexicográfica,
 * cada uma em transação própria, registrando em schema_migrations.
 * Roda com DATABASE_URL_MIGRATOR (owner do schema) — a aplicação NUNCA usa esse usuário.
 */
const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

async function main() {
  const url = process.env.DATABASE_URL_MIGRATOR;
  if (!url) throw new Error("DATABASE_URL_MIGRATOR não definida.");

  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
    const { rows } = await client.query<{ name: string }>("SELECT name FROM schema_migrations");
    const applied = new Set(rows.map((r) => r.name));

    let count = 0;
    for (const file of files) {
      if (applied.has(file)) continue;
      const sqlText = await readFile(join(MIGRATIONS_DIR, file), "utf8");
      console.log(`Aplicando ${file}...`);
      await client.query("BEGIN");
      try {
        await client.query(sqlText);
        await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
        await client.query("COMMIT");
        count++;
      } catch (err) {
        await client.query("ROLLBACK");
        throw new Error(`Falha na migração ${file}: ${(err as Error).message}`);
      }
    }
    console.log(count === 0 ? "Nada a migrar — banco em dia." : `${count} migração(ões) aplicada(s).`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
