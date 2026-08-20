import Anthropic from "@anthropic-ai/sdk";
import { REPLY_INTENTS, type ReplyIntent } from "./index";

/**
 * Classificação da resposta da cliente a um lembrete de consulta.
 *
 * Duas camadas:
 *  1. Palavras-chave (grátis, instantânea) — cobre a maioria dos "sim/pode confirmar".
 *  2. Claude Haiku (quando há ANTHROPIC_API_KEY) — pega o pt-BR coloquial
 *     ("blz", "n vou pd ir 😢").
 * Sem certeza → "other" (vai para atendimento humano; nunca age no escuro).
 */

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}\s!?👍✅❤️💛]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const CONFIRM_PATTERNS = [
  /\bpode confirmar\b/,
  /\bconfirmo\b/,
  /\bconfirmad[oa]\b/,
  /\bestarei (ai|la)\b/,
  /\bvou sim\b/,
  /\bpode ser\b/,
  /\bcom certeza\b/,
  /\bclaro\b/,
  /\bcombinado\b/,
  /^(sim|siim+|s)[\s!.]*$/,
  /^(ok|okay|blz|beleza|show|perfeito|otimo|top|fechado|fechou)[\s!.]*$/,
  /^👍|^✅/,
];

const CANCEL_PATTERNS = [
  /\b(nao|n) vou (conseguir|poder|dar)?/,
  /\b(nao|n) (vou|irei|posso|poderei|consigo)\b/,
  /\bcancelar?\b/,
  /\bcancela\b/,
  /\bdesmarcar?\b/,
  /\bdesmarca\b/,
  /\bimprevisto\b/,
];

const RESCHEDULE_PATTERNS = [
  /\bremarcar?\b/,
  /\breagendar?\b/,
  /\bremarca\b/,
  /\badiar\b/,
  /\boutro (horario|dia|momento)\b/,
  /\bmudar (o )?(horario|dia)\b/,
  /\btrocar (o )?(horario|dia)\b/,
  /\bmais tarde\b/,
  /\bsemana que vem\b/,
];

/** Camada 1 — determinística. null = sem certeza (vai para a camada 2 ou humano). */
export function classifyByKeywords(text: string): ReplyIntent | null {
  const t = normalize(text);
  if (!t) return null;
  // Cancelamento/remarcação primeiro: "não vou poder, pode remarcar?" nunca
  // pode virar confirmação por causa de um "pode" solto.
  if (RESCHEDULE_PATTERNS.some((p) => p.test(t))) return "reschedule";
  if (CANCEL_PATTERNS.some((p) => p.test(t))) return "cancel";
  if (CONFIRM_PATTERNS.some((p) => p.test(t))) return "confirm";
  if (/\?\s*$/.test(text.trim())) return "question";
  return null;
}

export interface ClassifyContext {
  procedureName: string | null;
  appointmentWhen: string; // "21/08 às 14:00"
}

/** Camada 2 — Claude Haiku com saída estruturada. */
export async function classifyByClaude(
  text: string,
  context: ClassifyContext,
  apiKey: string,
): Promise<ReplyIntent> {
  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 60,
    system:
      "Você classifica respostas de clientes de uma clínica estética a um lembrete de consulta no WhatsApp (pt-BR coloquial, com abreviações e emojis). Responda APENAS com a ferramenta.",
    messages: [
      {
        role: "user",
        content: `Lembrete enviado: consulta de ${context.procedureName ?? "procedimento"} em ${context.appointmentWhen}.\nResposta da cliente: "${text}"\n\nClassifique a intenção.`,
      },
    ],
    tools: [
      {
        name: "classificar",
        description: "Classifica a intenção da resposta da cliente",
        input_schema: {
          type: "object",
          properties: {
            intent: {
              type: "string",
              enum: [...REPLY_INTENTS],
              description:
                "confirm = ela confirma presença; cancel = não vai/quer cancelar; reschedule = quer outro horário; question = fez uma pergunta; other = qualquer outra coisa ou ambíguo",
            },
          },
          required: ["intent"],
        },
      },
    ],
    tool_choice: { type: "tool", name: "classificar" },
  });

  const toolUse = response.content.find((c) => c.type === "tool_use");
  const intent = (toolUse?.input as { intent?: string } | undefined)?.intent;
  return REPLY_INTENTS.includes(intent as ReplyIntent) ? (intent as ReplyIntent) : "other";
}

/** Pipeline completo: keywords → Claude (se houver chave) → "other". */
export async function classifyReply(
  text: string,
  context: ClassifyContext,
  apiKey: string | undefined,
): Promise<{ intent: ReplyIntent; via: "keywords" | "claude" | "fallback" }> {
  const byKeywords = classifyByKeywords(text);
  if (byKeywords) return { intent: byKeywords, via: "keywords" };
  if (apiKey) {
    try {
      return { intent: await classifyByClaude(text, context, apiKey), via: "claude" };
    } catch {
      return { intent: "other", via: "fallback" };
    }
  }
  return { intent: "other", via: "fallback" };
}
