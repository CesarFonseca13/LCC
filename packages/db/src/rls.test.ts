import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { closeDb, withContext, withTenant } from "./client";
import { clinics, professionals } from "./schema";

/**
 * Teste de integração do isolamento multi-tenant (RLS FORÇADO).
 * Requer banco migrado e DATABASE_URL apontando para o usuário da APLICAÇÃO
 * (clinicaos_app, sem BYPASSRLS) — é exatamente o caminho de produção.
 *
 * Roda apenas quando DATABASE_URL está definida (dev local / CI com serviço de banco).
 */
const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("isolamento RLS entre clínicas", () => {
  const clinicA = randomUUID();
  const clinicB = randomUUID();

  afterAll(async () => {
    if (!hasDb) return;
    await withTenant(clinicA, async (tx) => {
      await tx.execute(sql`DELETE FROM professionals WHERE clinic_id = ${clinicA}`);
      await tx.execute(sql`DELETE FROM clinics WHERE id = ${clinicA}`);
    });
    await withTenant(clinicB, async (tx) => {
      await tx.execute(sql`DELETE FROM clinics WHERE id = ${clinicB}`);
    });
    await closeDb();
  });

  it("cria clínicas com o próprio id no contexto (fluxo de signup)", async () => {
    await withTenant(clinicA, async (tx) => {
      await tx.insert(clinics).values({ id: clinicA, name: "Clínica A" });
    });
    await withTenant(clinicB, async (tx) => {
      await tx.insert(clinics).values({ id: clinicB, name: "Clínica B" });
    });
  });

  it("clínica B não lê dados da clínica A", async () => {
    await withTenant(clinicA, async (tx) => {
      await tx.insert(professionals).values({ clinicId: clinicA, name: "Dra. Ana" });
    });

    const fromB = await withTenant(clinicB, (tx) => tx.select().from(professionals));
    expect(fromB).toHaveLength(0);

    const fromA = await withTenant(clinicA, (tx) => tx.select().from(professionals));
    expect(fromA.map((p) => p.name)).toContain("Dra. Ana");
  });

  it("clínica B não consegue INSERIR dados na clínica A (WITH CHECK)", async () => {
    await expect(
      withTenant(clinicB, (tx) =>
        tx.insert(professionals).values({ clinicId: clinicA, name: "Invasora" }),
      ),
    ).rejects.toThrow();
  });

  it("clínica B não consegue UPDATE/DELETE cross-tenant (linhas invisíveis)", async () => {
    await withTenant(clinicB, async (tx) => {
      const updated = await tx.execute(
        sql`UPDATE professionals SET name = 'hack' WHERE clinic_id = ${clinicA}`,
      );
      expect(updated.rowCount).toBe(0);
      const deleted = await tx.execute(
        sql`DELETE FROM professionals WHERE clinic_id = ${clinicA}`,
      );
      expect(deleted.rowCount).toBe(0);
    });
  });

  it("sem contexto de clínica, nada de tenant é visível", async () => {
    const rows = await withContext({ userId: randomUUID() }, (tx) =>
      tx.select().from(clinics),
    );
    expect(rows).toHaveLength(0);
  });

  it("withContext sem clinicId nem userId é rejeitado", async () => {
    await expect(withContext({}, async () => undefined)).rejects.toThrow();
  });
});
