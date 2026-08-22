import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { encryptSensitive } from "@clinicaos/core/crypto";
import { runAgentTurn, type AgentToolExecutors } from "./agent";
import { classifyReply } from "./classify";
import { resolveAiConfig, resolveClinicAiConfig, type AiConfig } from "./provider";

/**
 * Provedor OpenAI-compatível de mentira: roteiro fixo de respostas por
 * conversa, no formato exato de /v1/chat/completions. Prova que o loop do
 * agente (tool call → resultado → resposta final) e o classificador
 * funcionam de ponta a ponta fora da Anthropic.
 */

interface RecordedRequest {
  model: string;
  messages: { role: string; content?: string | null; tool_call_id?: string }[];
  tools?: unknown[];
  tool_choice?: unknown;
}

let server: Server;
let baseURL: string;
const recorded: RecordedRequest[] = [];

function toolCallResponse(name: string, args: Record<string, unknown>, id: string) {
  return {
    choices: [
      {
        message: {
          content: null,
          tool_calls: [
            { id, type: "function", function: { name, arguments: JSON.stringify(args) } },
          ],
        },
      },
    ],
    usage: { prompt_tokens: 100, completion_tokens: 20 },
  };
}

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c: Buffer) => (raw += c.toString()));
    req.on("end", () => {
      const body = JSON.parse(raw) as RecordedRequest;
      recorded.push(body);
      res.setHeader("content-type", "application/json");

      // Classificador: ferramenta forçada → devolve o intent
      const forced = body.tool_choice as { function?: { name?: string } } | string | undefined;
      if (typeof forced === "object" && forced?.function?.name === "classificar") {
        res.end(JSON.stringify(toolCallResponse("classificar", { intent: "cancel" }, "c1")));
        return;
      }

      // Agente: 1ª chamada consulta horários; 2ª responde à cliente
      const hasToolResult = body.messages.some((m) => m.role === "tool");
      if (!hasToolResult) {
        res.end(
          JSON.stringify(
            toolCallResponse("consultar_horarios", { procedimento_nome: "Botox" }, "t1"),
          ),
        );
        return;
      }
      res.end(
        JSON.stringify(
          toolCallResponse(
            "responder_cliente",
            {
              balloons: ["Tenho quinta às 14h ou sexta às 10h 💛", "Qual fica melhor pra você?"],
              confianca: "alta",
            },
            "t2",
          ),
        ),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  baseURL = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}/v1`;
});

afterAll(() => {
  server.close();
});

function testConfig(): AiConfig {
  return {
    provider: "openai",
    apiKey: "test-key",
    baseURL,
    agentModel: "llama-3.3-70b-versatile",
    classifierModel: "llama-3.1-8b-instant",
  };
}

const executors: AgentToolExecutors = {
  consultarHorarios: async () => "qui 14:00 (slot qui-14) · sex 10:00 (slot sex-10)",
  agendar: async () => "agendado",
  reagendar: async () => "remarcado",
  cancelar: async () => "cancelado",
  confirmarPresenca: async () => "confirmado",
  consultarPacote: async () => "sem pacotes",
  escalarParaHumano: async () => "escalado",
  registrarOptOut: async () => "opt-out",
  atualizarCadastro: async () => "guardado",
};

describe("provedor OpenAI-compatível", () => {
  it("roda o loop completo do agente (tool call → resultado → balões)", async () => {
    const reply = await runAgentTurn(
      {
        persona: { assistantName: "Ana", tone: "acolhedora" },
        clinic: {
          name: "Clínica Teste",
          city: "São Paulo",
          businessHoursLabel: "seg-sex 9h-18h",
          catalog: [{ name: "Botox", price: "800,00", durationMinutes: 30 }],
        },
        customer: {
          firstName: "Maria",
          isNew: false,
          visitsCount: 3,
          upcomingAppointment: null,
          activeGoal: null,
          packageSummary: null,
        },
        nowLabel: "quinta, 21/08/2026, 15:00",
        history: [{ role: "customer", text: "Oi! Queria marcar um botox" }],
      },
      executors,
      { config: testConfig() },
    );

    expect(reply.balloons).toHaveLength(2);
    expect(reply.balloons[0]).toContain("quinta às 14h");
    expect(reply.confidence).toBe("alta");
    expect(reply.escalated).toBe(false);
    expect(reply.usage.calls).toBe(2);
    expect(reply.usage.inputTokens).toBe(200);

    // A 2ª chamada tem que devolver o resultado da ferramenta como role:"tool"
    const second = recorded[recorded.length - 1]!;
    const toolMsg = second.messages.find((m) => m.role === "tool");
    expect(toolMsg?.tool_call_id).toBe("t1");
    expect(toolMsg?.content).toContain("qui 14:00");
  });

  it("classifica com ferramenta forçada", async () => {
    const result = await classifyReply(
      "poxa nao vou conseguir mais 😢🙏",
      { procedureName: "Botox", appointmentWhen: "22/08 às 14:00" },
      testConfig(),
    );
    // "nao vou conseguir" já cai nas keywords — força um texto ambíguo:
    const ambiguous = await classifyReply(
      "eita, complicou tudo aqui",
      { procedureName: "Botox", appointmentWhen: "22/08 às 14:00" },
      testConfig(),
    );
    expect(result.intent).toBe("cancel");
    expect(ambiguous).toEqual({ intent: "cancel", via: "llm" });
  });

  it("resolveAiConfig monta a configuração certa por provedor", () => {
    expect(resolveAiConfig({ ANTHROPIC_API_KEY: "k" })).toMatchObject({
      provider: "anthropic",
      agentModel: "claude-sonnet-5",
      classifierModel: "claude-haiku-4-5",
    });
    expect(
      resolveAiConfig({
        AI_PROVIDER: "openai",
        OPENAI_API_KEY: "k",
        AI_BASE_URL: "https://api.groq.com/openai/v1",
        AI_AGENT_MODEL: "llama-3.3-70b-versatile",
      }),
    ).toMatchObject({
      provider: "openai",
      baseURL: "https://api.groq.com/openai/v1",
      agentModel: "llama-3.3-70b-versatile",
      classifierModel: "llama-3.3-70b-versatile",
    });
    // Sem chave = IA desligada (nunca explode)
    expect(resolveAiConfig({})).toBeNull();
    expect(resolveAiConfig({ AI_PROVIDER: "openai" })).toBeNull();
  });

  it("resolveClinicAiConfig: chave própria cifrada, Ollama sem chave e fallbacks", () => {
    const dataKey = Buffer.alloc(32, 7).toString("base64");
    const env = { SENSITIVE_DATA_KEY: dataKey, ANTHROPIC_API_KEY: "chave-do-sistema" };

    // Clínica com chave própria da Groq (cifrada no banco)
    const groq = resolveClinicAiConfig(
      {
        aiProvider: {
          mode: "custom",
          provider: "openai",
          apiKeyEnc: encryptSensitive("gsk_chave_da_clinica", dataKey),
          baseURL: "https://api.groq.com/openai/v1",
          agentModel: "llama-3.3-70b-versatile",
        },
      },
      env,
    );
    expect(groq).toMatchObject({
      provider: "openai",
      apiKey: "gsk_chave_da_clinica",
      baseURL: "https://api.groq.com/openai/v1",
      agentModel: "llama-3.3-70b-versatile",
      classifierModel: "llama-3.3-70b-versatile",
    });

    // Ollama próprio: sem chave, mas modelo obrigatório
    expect(
      resolveClinicAiConfig(
        {
          aiProvider: {
            mode: "custom",
            provider: "openai",
            baseURL: "http://localhost:11434/v1",
            agentModel: "qwen3:32b",
          },
        },
        env,
      ),
    ).toMatchObject({ apiKey: "sem-chave", agentModel: "qwen3:32b" });

    // Custom incompleto (servidor próprio SEM modelo) → cai no padrão do sistema
    expect(
      resolveClinicAiConfig(
        {
          aiProvider: {
            mode: "custom",
            provider: "openai",
            baseURL: "http://localhost:11434/v1",
          },
        },
        env,
      ),
    ).toMatchObject({ provider: "anthropic", apiKey: "chave-do-sistema" });

    // Sem configuração da clínica → padrão do sistema; sem nada → null
    expect(resolveClinicAiConfig({}, env)).toMatchObject({ provider: "anthropic" });
    expect(resolveClinicAiConfig({}, {})).toBeNull();
  });
});
