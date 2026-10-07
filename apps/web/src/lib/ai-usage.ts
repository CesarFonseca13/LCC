import { type LlmUsage, llmCostBrl } from "@clinicaos/core/spend";
import { schema, type Tx } from "@clinicaos/db";

/**
 * Registra um uso de IA feito pelo painel (fora do worker) com o custo estimado.
 * ownKey = clínica com chave própria: tokens registrados, custo zero para a plataforma.
 */
export async function recordAiUsageTx(
  tx: Tx,
  input: { clinicId: string; purpose: string; model: string; usage: LlmUsage; ownKey: boolean },
): Promise<void> {
  const cost = input.ownKey ? 0 : llmCostBrl(input.model, input.usage);
  await tx.insert(schema.aiUsage).values({
    clinicId: input.clinicId,
    purpose: input.purpose,
    model: input.model,
    inputTokens:
      input.usage.inputTokens + (input.usage.cacheWriteTokens ?? 0) + (input.usage.cacheReadTokens ?? 0),
    outputTokens: input.usage.outputTokens,
    costBrl: cost.toFixed(6),
  });
}
