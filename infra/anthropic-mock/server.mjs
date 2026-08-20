import { createServer } from "node:http";

/**
 * Mock da Anthropic Messages API para testes E2E do agente.
 * Roteiro determinístico que exercita o LOOP REAL de ferramentas do worker:
 * consultar_horarios → agendar → responder_cliente; assunto médico → escalar.
 *
 * Uso: node infra/anthropic-mock/server.mjs (porta 8098)
 * Worker: ANTHROPIC_API_KEY=mock ANTHROPIC_BASE_URL=http://localhost:8098
 */
const PORT = Number(process.env.MOCK_PORT ?? 8098);
let seq = 0;

function reply(content, stopReason) {
  return {
    id: `msg_mock_${++seq}`,
    type: "message",
    role: "assistant",
    model: "claude-mock",
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: { input_tokens: 400, output_tokens: 60 },
  };
}

function toolUse(name, input) {
  return { type: "tool_use", id: `toolu_mock_${++seq}`, name, input };
}

/** Extrai o último texto da cliente e os tool_results da conversa. */
function analyze(messages) {
  let lastCustomerText = "";
  const toolResults = [];
  for (const m of messages) {
    if (m.role === "user") {
      if (typeof m.content === "string") {
        lastCustomerText = m.content;
      } else if (Array.isArray(m.content)) {
        for (const block of m.content) {
          if (block.type === "tool_result") {
            const text =
              typeof block.content === "string"
                ? block.content
                : Array.isArray(block.content)
                  ? block.content.map((c) => c.text ?? "").join(" ")
                  : "";
            toolResults.push(text);
          }
        }
      }
    }
  }
  return { lastCustomerText: lastCustomerText.toLowerCase(), toolResults };
}

const server = createServer(async (req, res) => {
  if (req.method !== "POST" || !req.url?.includes("/messages")) {
    res.writeHead(404, { "content-type": "application/json" });
    return res.end(JSON.stringify({ error: "not found" }));
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  const { lastCustomerText, toolResults } = analyze(body.messages ?? []);
  const lastResult = toolResults[toolResults.length - 1] ?? "";

  let response;

  // Continuações de ferramentas (independem do texto)
  if (lastResult.includes("Horários livres")) {
    const slotId = lastResult.match(/\[slot_id: ([^\]]+)\]/)?.[1];
    response = reply(
      [toolUse("agendar", { slot_id: slotId, procedimento_nome: "Limpeza de Pele" })],
      "tool_use",
    );
  } else if (lastResult.includes("Agendado com sucesso")) {
    const when = lastResult.match(/em (\d{2}\/\d{2} às \d{2}:\d{2})/)?.[1] ?? "no horário combinado";
    response = reply(
      [
        toolUse("responder_cliente", {
          balloons: [
            "Consegui um horário ótimo pra você! 💛",
            `Ficou agendado para ${when}. Qualquer coisa antes disso, é só me chamar!`,
          ],
          confianca: "alta",
        }),
      ],
      "tool_use",
    );
  } else if (lastResult.includes("Conversa passada para a equipe")) {
    response = reply(
      [
        toolUse("responder_cliente", {
          balloons: [
            "Imagino a sua preocupação, querida. Já chamei nossa equipe aqui — a Dra. vai falar com você agorinha, tá?",
          ],
          confianca: "alta",
        }),
      ],
      "tool_use",
    );
  }
  // Novos assuntos
  else if (/ardendo|dor|inchad|reação|alergia|vermelho|sangr/.test(lastCustomerText)) {
    response = reply(
      [
        toolUse("escalar_para_humano", {
          motivo: "possível reação ao procedimento — assunto clínico",
          urgencia: "alta",
        }),
      ],
      "tool_use",
    );
  } else if (/rob[oô]|atendente de verdade|é uma ia/.test(lastCustomerText)) {
    response = reply(
      [toolUse("escalar_para_humano", { motivo: "perguntou se é robô", urgencia: "normal" })],
      "tool_use",
    );
  } else if (/agendar|hor[aá]rio|marcar|limpeza/.test(lastCustomerText)) {
    response = reply(
      [toolUse("consultar_horarios", { procedimento_nome: "Limpeza de Pele" })],
      "tool_use",
    );
  } else {
    response = reply(
      [
        toolUse("responder_cliente", {
          balloons: ["Oi! Me conta como posso te ajudar hoje? 💛"],
          confianca: "media",
        }),
      ],
      "tool_use",
    );
  }

  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(response));
});

server.listen(PORT, () => {
  console.log(`anthropic-mock ouvindo em http://localhost:${PORT}`);
});
