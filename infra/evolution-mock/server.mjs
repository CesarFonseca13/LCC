import { createServer } from "node:http";

/**
 * Mock da Evolution API para desenvolvimento e testes E2E.
 * Implementa os endpoints que o ClinicaOS usa e permite disparar webhooks
 * sob comando — fecha o loop completo sem WhatsApp real.
 *
 * Uso: node infra/evolution-mock/server.mjs  (porta 8099)
 *   POST /_mock/trigger {instanceName, event, data}  → dispara webhook no app
 *   GET  /_mock/sent                                 → mensagens "enviadas"
 *   POST /_mock/reset                                → limpa estado
 */
const PORT = Number(process.env.MOCK_PORT ?? 8099);

/** @type {Map<string, {webhookUrl: string, state: string}>} */
const instances = new Map();
/** @type {{instanceName: string, number: string, text: string, delay?: number, id: string}[]} */
const sent = [];
let seq = 0;

const TINY_QR_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAF0lEQVR4nGP8//8/AzGAiShVowoJAgB1LQMBkKA0TAAAAABJRU5ErkJggg==";

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const path = url.pathname;
  const method = req.method ?? "GET";

  // ── Controle do mock ─────────────────────────────────────────────
  if (method === "POST" && path === "/_mock/trigger") {
    const body = await readBody(req);
    const inst = instances.get(body.instanceName);
    if (!inst) return json(res, 404, { error: "instância desconhecida no mock" });
    if (body.event === "CONNECTION_UPDATE" && body.data?.state === "open") {
      inst.state = "open";
    }
    if (body.event === "CONNECTION_UPDATE" && ["close", "logout"].includes(body.data?.state)) {
      inst.state = "close";
    }
    try {
      const r = await fetch(inst.webhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          event: body.event,
          instance: body.instanceName,
          data: body.data,
        }),
      });
      return json(res, 200, { delivered: r.status });
    } catch (err) {
      return json(res, 502, { error: String(err) });
    }
  }
  if (method === "GET" && path === "/_mock/sent") {
    return json(res, 200, sent);
  }
  if (method === "POST" && path === "/_mock/reset") {
    instances.clear();
    sent.length = 0;
    return json(res, 200, { ok: true });
  }

  // ── API Evolution (subset usado) ─────────────────────────────────
  if (method === "POST" && path === "/instance/create") {
    const body = await readBody(req);
    instances.set(body.instanceName, {
      webhookUrl: body.webhook?.url ?? "",
      state: "close",
    });
    return json(res, 201, { instance: { instanceName: body.instanceName } });
  }

  const connectMatch = path.match(/^\/instance\/connect\/(.+)$/);
  if (method === "GET" && connectMatch) {
    const inst = instances.get(connectMatch[1]);
    if (!inst) return json(res, 404, { error: "instance not found" });
    if (inst.state === "open") return json(res, 200, {});
    return json(res, 200, { base64: TINY_QR_PNG, code: "mock-pairing-code" });
  }

  const stateMatch = path.match(/^\/instance\/connectionState\/(.+)$/);
  if (method === "GET" && stateMatch) {
    const inst = instances.get(stateMatch[1]);
    if (!inst) return json(res, 404, { error: "instance not found" });
    return json(res, 200, { instance: { state: inst.state === "open" ? "open" : "connecting" } });
  }

  const logoutMatch = path.match(/^\/instance\/logout\/(.+)$/);
  if (method === "DELETE" && logoutMatch) {
    const inst = instances.get(logoutMatch[1]);
    if (inst) inst.state = "close";
    return json(res, 200, { ok: true });
  }

  const sendMatch = path.match(/^\/message\/sendText\/(.+)$/);
  if (method === "POST" && sendMatch) {
    const inst = instances.get(sendMatch[1]);
    if (!inst) return json(res, 404, { error: "instance not found" });
    if (inst.state !== "open") return json(res, 400, { error: "instance not connected" });
    const body = await readBody(req);
    const id = `MOCK${String(++seq).padStart(6, "0")}`;
    sent.push({
      instanceName: sendMatch[1],
      number: body.number,
      text: body.text,
      delay: body.delay,
      id,
    });
    return json(res, 201, { key: { id, remoteJid: `${body.number}@s.whatsapp.net`, fromMe: true } });
  }

  const presenceMatch = path.match(/^\/chat\/sendPresence\/(.+)$/);
  if (method === "POST" && presenceMatch) {
    return json(res, 200, { ok: true });
  }

  return json(res, 404, { error: `mock: rota desconhecida ${method} ${path}` });
});

server.listen(PORT, () => {
  console.log(`evolution-mock ouvindo em http://localhost:${PORT}`);
});
