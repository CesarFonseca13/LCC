import type { Logger } from "pino";
import { recomputeScores, unsafeGlobalDb } from "@clinicaos/db";
import { sql } from "drizzle-orm";

/**
 * Varredura da Inteligência: recalcula o score das clínicas cujo snapshot
 * está velho (>24h) ou nunca foi calculado. O botão "Atualizar análise"
 * no painel cobre o sob-demanda; aqui é o pano de fundo diário.
 */
export async function processScoresSweep(logger: Logger): Promise<void> {
  const db = unsafeGlobalDb();
  const stale = await db.execute(sql`
    SELECT c.id, c.timezone FROM clinics c
    WHERE NOT EXISTS (
      SELECT 1 FROM customer_scores cs
      WHERE cs.clinic_id = c.id AND cs.computed_at > now() - interval '24 hours'
      LIMIT 1
    )
    AND EXISTS (SELECT 1 FROM customers cu WHERE cu.clinic_id = c.id LIMIT 1)
    LIMIT 10
  `);

  for (const row of stale.rows as { id: string; timezone: string | null }[]) {
    try {
      const n = await recomputeScores(db, row.id, row.timezone ?? "America/Sao_Paulo");
      logger.info({ clinicId: row.id, customers: n }, "scores recalculados");
    } catch (err) {
      logger.error({ clinicId: row.id, err: String(err) }, "falha ao recalcular scores");
    }
  }
}
