import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runAgentTurn, type AgentToolExecutors, type AgentTurnInput } from "./agent";
import type { AiConfig } from "./provider";

/**
 * O modelo pode mandar responder_cliente JUNTO com outra ferramenta na mesma
 * resposta (chamada paralela). A ação nunca pode ser descartada:
 *  - escalar_para_humano + resposta → escala e a resposta sai;
 *  - agendar + resposta → agenda e a atendente reescreve com o resultado real.
 */

interface Req {
  messages: { role: string; content?: string | null; tool_call_id?: string }[];
}

let server: Server;
let baseURL: string;
const requests: Req[] = [];

function calls(list: { name: string; args: Record<string, unknown>; id: string }[]) {
  return {
    choices: [
      {
        message: {
          content: null,
          tool_calls: list.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: JSON.stringify(c.args) } })),
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
      const body = JSON.parse(raw) as Req;
      requests.push(body);
      res.setHeader("content-type", "application/json");
      const lastUser = [...body.messages].reverse().find((m) => m.role === "user")?.content ?? "";
      const hasToolResult = body.messages.some((m) => m.role === "tool");

      if (lastUser.includes("cenario-escalar")) {
        res.end(
          JSON.stringify(
            calls([
              { name: "escalar_para_humano", args: { motivo: "queixa de saúde", urgencia: "alta" }, id: "e1" },
              { name: "responder_cliente", args: { balloons: ["Vou chamar alguém da equipe agora 💛"] }, id: "r1" },
            ]),
          ),
        );
        return;
      }
      // Toque de silêncio: o último "user" é a instrução do sistema
      if (lastUser.includes("a cliente NÃO escreveu nada")) {
        if (body.messages.some((m) => m.role === "assistant" && (m.content ?? "").includes("cenario-toque-acao"))) {
          // Modelo desobediente tenta cancelar num toque: nada pode acontecer
          res.end(JSON.stringify(calls([{ name: "cancelar", args: { agendamento_id: "x" }, id: "c1" }])));
          return;
        }
        const silencio = body.messages.some((m) => m.role === "assistant" && (m.content ?? "").includes("cenario-toque-silencio"));
        res.end(
          JSON.stringify(
            calls([
              { name: "responder_cliente", args: { balloons: [silencio ? "[SEM_MENSAGEM]" : "Está por aí? 😊"] }, id: "n1" },
            ]),
          ),
        );
        return;
      }
      if (lastUser.includes("cenario-agendar")) {
        if (!hasToolResult) {
          res.end(
            JSON.stringify(
              calls([
                { name: "agendar", args: { slot_id: "H1", procedimentos: ["Consulta"] }, id: "a1" },
                { name: "responder_cliente", args: { balloons: ["Agendei!"] }, id: "r1" },
              ]),
            ),
          );
          return;
        }
        res.end(JSON.stringify(calls([{ name: "responder_cliente", args: { balloons: ["Não consegui esse horário, posso ver outro?"] }, id: "r2" }])));
        return;
      }
      res.end(JSON.stringify(calls([{ name: "responder_cliente", args: { balloons: ["Oi!"] }, id: "r0" }])));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  baseURL = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}/v1`;
});

afterAll(() => {
  server.close();
});

const config = (): AiConfig => ({
  provider: "openai",
  apiKey: "test-key",
  baseURL,
  agentModel: "modelo-teste",
  classifierModel: "modelo-teste",
});

function input(text: string): AgentTurnInput {
  return {
    persona: { assistantName: "Ana", tone: "elegante" },
    clinic: {
      name: "Clínica Teste",
      city: null,
      address: null,
      phone: null,
      businessHoursLabel: "seg-sex 8h-18h",
      catalog: [{ name: "Consulta", price: "0,00", priceMode: "on_request", durationMinutes: 30 }],
      facts: null,
      offersEnabled: false,
    },
    customer: {
      firstName: "Maria",
      nameConfirmed: true,
      isNew: false,
      visitsCount: 1,
      upcomingAppointment: null,
      activeGoal: null,
      packageSummary: null,
    },
    nowLabel: "sábado, 07/11/2026, 10:00",
    history: [
      { role: "assistant", text: "Olá, Maria!" },
      { role: "customer", text },
    ],
  };
}

function executors(log: string[]): AgentToolExecutors {
  return {
    consultarHorarios: async () => "nada",
    agendar: async () => {
      log.push("agendar");
      return "NÃO AGENDADO: horário ocupado";
    },
    reagendar: async () => "ok",
    cancelar: async () => "ok",
    confirmarPresenca: async () => "ok",
    consultarPacote: async () => "ok",
    consultarInformacoes: async () => "ok",
    escalarParaHumano: async (motivo, urgencia) => {
      log.push(`escalar:${motivo}:${urgencia}`);
      return "ok";
    },
    registrarOptOut: async () => "ok",
    atualizarCadastro: async () => "ok",
    sugerirComplementos: async () => "nenhuma",
  };
}

describe("toque de silêncio", () => {
  const nudgeInput = (lastAssistant: string): AgentTurnInput => ({
    ...input("oi"),
    history: [
      { role: "customer", text: "quero marcar uma consulta" },
      { role: "assistant", text: lastAssistant },
    ],
    nudge: { minutes: 12 },
  });

  it("cutuca com UM balão curto quando a pergunta ficou sem resposta", async () => {
    const reply = await runAgentTurn(nudgeInput("Tenho quinta às 10h, pode ser?"), executors([]), { config: config() });
    expect(reply.balloons).toEqual(["Está por aí? 😊"]);
  });

  it("[SEM_MENSAGEM] = nada sai para a cliente", async () => {
    const reply = await runAgentTurn(nudgeInput("cenario-toque-silencio: posso ajudar em algo mais?"), executors([]), {
      config: config(),
    });
    expect(reply.balloons).toEqual([]);
  });

  it("no toque só existe responder_cliente (forçado); qualquer outra coisa = silêncio, sem ação e sem escalar", async () => {
    const log: string[] = [];
    const before = requests.length;
    const reply = await runAgentTurn(nudgeInput("cenario-toque-acao: quer que eu cancele a de quinta?"), executors(log), {
      config: config(),
    });
    expect(reply.balloons).toEqual([]);
    expect(reply.escalated).toBe(false);
    expect(log).toEqual([]);
    expect(requests.length - before).toBe(1);
    const req = requests[requests.length - 1] as unknown as { tools?: { function?: { name?: string } }[]; tool_choice?: unknown };
    expect((req.tools ?? []).map((t) => t.function?.name)).toEqual(["responder_cliente"]);
    expect(JSON.stringify(req.tool_choice)).toContain("responder_cliente");
  });
});

describe("resposta junto com outra ferramenta na mesma vez", () => {
  it("escalar + responder: escala de verdade e a resposta sai", async () => {
    const log: string[] = [];
    const before = requests.length;
    const reply = await runAgentTurn(input("cenario-escalar"), executors(log), { config: config() });
    expect(log).toEqual(["escalar:queixa de saúde:alta"]);
    expect(reply.escalated).toBe(true);
    expect(reply.balloons).toEqual(["Vou chamar alguém da equipe agora 💛"]);
    expect(requests.length - before).toBe(1);
  });

  it("agendar + responder: agenda primeiro e a atendente reescreve com o resultado", async () => {
    const log: string[] = [];
    const before = requests.length;
    const reply = await runAgentTurn(input("cenario-agendar"), executors(log), { config: config() });
    expect(log).toEqual(["agendar"]);
    expect(reply.balloons).toEqual(["Não consegui esse horário, posso ver outro?"]);
    expect(requests.length - before).toBe(2);
    // A resposta retida volta para o modelo como "NÃO foi enviada"
    const second = requests[requests.length - 1]!;
    const toolMsgs = second.messages.filter((m) => m.role === "tool").map((m) => m.content ?? "");
    expect(toolMsgs.some((c) => c.includes("NÃO foi enviada"))).toBe(true);
    expect(toolMsgs.some((c) => c.includes("NÃO AGENDADO"))).toBe(true);
  });
});
