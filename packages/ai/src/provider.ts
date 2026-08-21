import Anthropic from "@anthropic-ai/sdk";

/**
 * Camada de provedores de IA — um contrato neutro de "chat com ferramentas"
 * com duas implementações:
 *
 *  - "anthropic": SDK oficial (Claude), com prompt caching no bloco estável.
 *  - "openai": qualquer endpoint compatível com a API da OpenAI
 *    (/v1/chat/completions): OpenAI, Groq, Together, OpenRouter, Fireworks,
 *    e modelos open-source auto-hospedados via vLLM ou Ollama.
 *
 * As regras duras do produto (fatos só de ferramenta, escalação, aprovação)
 * moram no prompt e no pipeline — valem igual para qualquer provedor.
 */

export type AiProviderKind = "anthropic" | "openai";

export interface AiConfig {
  provider: AiProviderKind;
  apiKey: string;
  /** Obrigatório para provedores compatíveis fora da OpenAI (Groq, Ollama...). */
  baseURL?: string;
  /** Modelo do agente conversacional. */
  agentModel: string;
  /** Modelo barato do classificador de respostas. */
  classifierModel: string;
}

/**
 * Resolve a configuração de IA a partir do ambiente. null = IA desligada.
 *
 *   AI_PROVIDER=anthropic (default) | openai
 *   Anthropic: ANTHROPIC_API_KEY [+ ANTHROPIC_BASE_URL]
 *   OpenAI-compatível: OPENAI_API_KEY [+ AI_BASE_URL + AI_AGENT_MODEL]
 *   Comum: AI_AGENT_MODEL, AI_CLASSIFIER_MODEL
 */
export function resolveAiConfig(
  env: Record<string, string | undefined>,
): AiConfig | null {
  const provider: AiProviderKind = env.AI_PROVIDER === "openai" ? "openai" : "anthropic";

  if (provider === "anthropic") {
    if (!env.ANTHROPIC_API_KEY) return null;
    return {
      provider,
      apiKey: env.ANTHROPIC_API_KEY,
      baseURL: env.ANTHROPIC_BASE_URL || undefined,
      agentModel: env.AI_AGENT_MODEL || "claude-sonnet-5",
      classifierModel: env.AI_CLASSIFIER_MODEL || "claude-haiku-4-5",
    };
  }

  const apiKey = env.OPENAI_API_KEY || env.AI_API_KEY;
  if (!apiKey) return null;
  return {
    provider,
    apiKey,
    baseURL: env.AI_BASE_URL || "https://api.openai.com/v1",
    agentModel: env.AI_AGENT_MODEL || "gpt-4o",
    classifierModel: env.AI_CLASSIFIER_MODEL || env.AI_AGENT_MODEL || "gpt-4o-mini",
  };
}

// ── Contrato neutro ──────────────────────────────────────────────────

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultMsg {
  toolCallId: string;
  content: string;
  isError?: boolean;
}

export type ChatMessage =
  | { role: "user" | "assistant"; text: string }
  | { role: "assistant_tools"; text: string | null; calls: ToolCall[] }
  | { role: "tool_results"; results: ToolResultMsg[] };

export interface ChatRequest {
  model: string;
  /** Blocos de system: o primeiro é o estável (cacheável na Anthropic). */
  system: string[];
  messages: ChatMessage[];
  tools?: ToolDef[];
  /** Força a chamada de uma ferramenta específica (classificador). */
  forceTool?: string;
  maxTokens: number;
}

export interface ChatResponse {
  text: string;
  toolCalls: ToolCall[];
  usage: { inputTokens: number; outputTokens: number };
}

export interface LlmClient {
  chat(req: ChatRequest): Promise<ChatResponse>;
}

export function createLlmClient(config: AiConfig): LlmClient {
  return config.provider === "anthropic"
    ? new AnthropicClient(config)
    : new OpenAiCompatClient(config);
}

// ── Anthropic ────────────────────────────────────────────────────────

class AnthropicClient implements LlmClient {
  private client: Anthropic;

  constructor(config: AiConfig) {
    this.client = new Anthropic({ apiKey: config.apiKey, baseURL: config.baseURL });
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const system: Anthropic.TextBlockParam[] = req.system.map((text, i) => ({
      type: "text",
      text,
      ...(i === 0 ? { cache_control: { type: "ephemeral" as const } } : {}),
    }));

    const messages: Anthropic.MessageParam[] = req.messages.map((m) => {
      if (m.role === "assistant_tools") {
        const content: Anthropic.ContentBlockParam[] = [];
        if (m.text) content.push({ type: "text", text: m.text });
        for (const c of m.calls) {
          content.push({ type: "tool_use", id: c.id, name: c.name, input: c.input });
        }
        return { role: "assistant" as const, content };
      }
      if (m.role === "tool_results") {
        return {
          role: "user" as const,
          content: m.results.map(
            (r): Anthropic.ToolResultBlockParam => ({
              type: "tool_result",
              tool_use_id: r.toolCallId,
              content: r.content,
              ...(r.isError ? { is_error: true } : {}),
            }),
          ),
        };
      }
      return { role: m.role, content: m.text };
    });

    const response = await this.client.messages.create({
      model: req.model,
      max_tokens: req.maxTokens,
      system,
      messages,
      ...(req.tools?.length
        ? {
            tools: req.tools.map(
              (t): Anthropic.Tool => ({
                name: t.name,
                description: t.description,
                input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
              }),
            ),
          }
        : {}),
      ...(req.forceTool ? { tool_choice: { type: "tool" as const, name: req.forceTool } } : {}),
    });

    return {
      text: response.content
        .filter((c): c is Anthropic.TextBlock => c.type === "text")
        .map((c) => c.text)
        .join(" ")
        .trim(),
      toolCalls: response.content
        .filter((c): c is Anthropic.ToolUseBlock => c.type === "tool_use")
        .map((c) => ({
          id: c.id,
          name: c.name,
          input: (c.input ?? {}) as Record<string, unknown>,
        })),
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    };
  }
}

// ── OpenAI-compatível (fetch puro — sem dependência nova) ───────────

interface OpenAiToolCall {
  id?: string;
  function?: { name?: string; arguments?: string };
}

interface OpenAiResponse {
  choices?: {
    message?: { content?: string | null; tool_calls?: OpenAiToolCall[] };
  }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string };
}

class OpenAiCompatClient implements LlmClient {
  constructor(private config: AiConfig) {}

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const baseURL = (this.config.baseURL ?? "https://api.openai.com/v1").replace(/\/$/, "");
    const messages: Record<string, unknown>[] = [
      { role: "system", content: req.system.join("\n\n") },
    ];
    for (const m of req.messages) {
      if (m.role === "assistant_tools") {
        messages.push({
          role: "assistant",
          content: m.text ?? null,
          tool_calls: m.calls.map((c) => ({
            id: c.id,
            type: "function",
            function: { name: c.name, arguments: JSON.stringify(c.input) },
          })),
        });
      } else if (m.role === "tool_results") {
        for (const r of m.results) {
          messages.push({
            role: "tool",
            tool_call_id: r.toolCallId,
            content: r.isError ? `ERRO: ${r.content}` : r.content,
          });
        }
      } else {
        messages.push({ role: m.role, content: m.text });
      }
    }

    // A OpenAI oficial exige max_completion_tokens nos modelos novos;
    // servidores compatíveis (Groq, Ollama, vLLM...) usam max_tokens
    const isOfficialOpenAi = baseURL.includes("api.openai.com");
    const body: Record<string, unknown> = {
      model: req.model,
      messages,
      ...(isOfficialOpenAi
        ? { max_completion_tokens: req.maxTokens }
        : { max_tokens: req.maxTokens }),
      ...(req.tools?.length
        ? {
            tools: req.tools.map((t) => ({
              type: "function",
              function: {
                name: t.name,
                description: t.description,
                parameters: t.inputSchema,
              },
            })),
            tool_choice: req.forceTool
              ? { type: "function", function: { name: req.forceTool } }
              : "auto",
          }
        : {}),
    };

    const res = await fetch(`${baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as OpenAiResponse;
    if (!res.ok) {
      throw new Error(
        `IA (${this.config.provider}/${req.model}): HTTP ${res.status} — ${data.error?.message ?? "sem detalhe"}`,
      );
    }

    const message = data.choices?.[0]?.message;
    const toolCalls: ToolCall[] = (message?.tool_calls ?? []).flatMap((c, i) => {
      if (!c.function?.name) return [];
      let input: Record<string, unknown> = {};
      try {
        const parsed: unknown = JSON.parse(c.function.arguments || "{}");
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          input = parsed as Record<string, unknown>;
        }
      } catch {
        // argumentos malformados (modelo fraco) → ferramenta recebe {} e
        // devolve erro orientando; o loop trata como falha normal
      }
      return [{ id: c.id ?? `call_${i}`, name: c.function.name, input }];
    });

    return {
      text: (message?.content ?? "").trim(),
      toolCalls,
      usage: {
        inputTokens: data.usage?.prompt_tokens ?? 0,
        outputTokens: data.usage?.completion_tokens ?? 0,
      },
    };
  }
}
