import { createLlmClient, type AiConfig, type TokenUsage } from "./provider";
import { REPLY_INTENTS, type ReplyIntent } from "./index";

/**
 * Classificação da resposta da cliente a um lembrete de consulta.
 *
 * Duas camadas:
 *  1. Palavras-chave (grátis, instantânea) — cobre a maioria dos "sim/pode confirmar".
 *  2. Modelo barato do provedor configurado (Claude Haiku por default) — pega
 *     o pt-BR coloquial ("blz", "n vou pd ir 😢").
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
  // Fracas só valem como mensagem inteira (com "sim"/"obrigada"/emoji em volta):
  // "pode ser na quinta" é pedido de troca, "claro que não" é recusa
  /^((sim|claro|ok) )?(pode ser|com certeza|claro|combinado|claro que sim)( (sim|obrigad[ao]|entao|ate amanha))*[\s!.👍✅❤️💛]*$/u,
  /^(sim|siim+|s)[\s!.]*$/,
  /^(ok|okay|blz|beleza|show|perfeito|otimo|top|fechado|fechou)[\s!.]*$/,
  /^👍|^✅/,
];

const CANCEL_PATTERNS = [
  // "não vou faltar/perder/esquecer" é o contrário de cancelar
  /\b(nao|n) vou (?!faltar|perder|esquecer)(conseguir|poder|dar)?/,
  /\b(nao|n) (vou|irei|posso|poderei|consigo|estarei)\b(?! (faltar|perder|esquecer))/,
  /\b(nao|n) (vai|vou) dar\b(?! (problema|pra perder|para perder|pra faltar|para faltar|pra chegar antes))/,
  /\b(nao|n) da (pra|para)\b(?! (perder|faltar|esquecer))/,
  /\b(nao|n) vai rolar\b/,
  /(?<!\b(nao|n) )\bvou faltar\b(?! nao)/,
  /\bcancelar?\b/,
  /\bcancela\b/,
  /\bdesmarcar?\b/,
  /\bdesmarca\b/,
  /\bimprevisto\b/,
];

/** Adiamento ou dúvida ("depois te confirmo", "ainda não sei", "vou ver com meu
 *  marido") não é confirmação: sem certeza, vai para a próxima camada / pessoa.
 *  "Confirmo, depois mando o comprovante" continua sendo confirmação. */
const POSTPONE_PATTERNS = [
  /\bdepois (eu )?(te )?(confirmo|falo|aviso|vejo|respondo|retorno)\b/,
  /\b(te )?(falo|aviso|respondo|retorno) depois\b/,
  /\bte confirmo (depois|mais tarde|amanha|ja ja|em breve)\b/,
  /\bconfirmo depois([\s!.]*$| (que|de|do|da)\b)/,
  /\b(nao|n) confirmo\b/,
  /\bainda (nao|n) sei\b/,
  /\bsei se\b/,
  /\bvou ver\b/,
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
  if (POSTPONE_PATTERNS.some((p) => p.test(t))) return null;
  if (CONFIRM_PATTERNS.some((p) => p.test(t))) return "confirm";
  if (/\?\s*$/.test(text.trim())) return "question";
  return null;
}

export interface ClassifyContext {
  procedureName: string | null;
  appointmentWhen: string; // "21/08 às 14:00"
}

/** Camada 2 — modelo barato do provedor configurado, com saída estruturada. */
export async function classifyByLlm(
  text: string,
  context: ClassifyContext,
  config: AiConfig,
  onUsage?: (usage: { model: string } & TokenUsage) => void,
): Promise<ReplyIntent> {
  const client = createLlmClient(config);
  const response = await client.chat({
    model: config.classifierModel,
    maxTokens: 60,
    system: [
      "Você classifica respostas de clientes de uma clínica estética a um lembrete de consulta no WhatsApp (pt-BR coloquial, com abreviações e emojis). Responda APENAS com a ferramenta.",
    ],
    messages: [
      {
        role: "user",
        text: `Lembrete enviado: consulta de ${context.procedureName ?? "procedimento"} em ${context.appointmentWhen}.\nResposta da cliente: "${text}"\n\nClassifique a intenção.`,
      },
    ],
    tools: [
      {
        name: "classificar",
        description: "Classifica a intenção da resposta da cliente",
        inputSchema: {
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
    forceTool: "classificar",
  });

  onUsage?.({ model: config.classifierModel, ...response.usage });
  const toolUse = response.toolCalls.find((c) => c.name === "classificar");
  const intent = (toolUse?.input as { intent?: string } | undefined)?.intent;
  return REPLY_INTENTS.includes(intent as ReplyIntent) ? (intent as ReplyIntent) : "other";
}

/** Pipeline completo: keywords → modelo (se configurado) → "other". */
export async function classifyReply(
  text: string,
  context: ClassifyContext,
  config: AiConfig | null | undefined,
  onUsage?: (usage: { model: string } & TokenUsage) => void,
): Promise<{ intent: ReplyIntent; via: "keywords" | "llm" | "fallback" }> {
  const byKeywords = classifyByKeywords(text);
  if (byKeywords) return { intent: byKeywords, via: "keywords" };
  if (config) {
    try {
      return { intent: await classifyByLlm(text, context, config, onUsage), via: "llm" };
    } catch {
      return { intent: "other", via: "fallback" };
    }
  }
  return { intent: "other", via: "fallback" };
}
