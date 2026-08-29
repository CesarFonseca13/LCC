/**
 * Cliente HTTP da Evolution API (v2).
 * O mock em infra/evolution-mock implementa exatamente estes endpoints —
 * testes fecham o loop completo sem WhatsApp real.
 */

export interface EvolutionConfig {
  baseUrl: string;
  apiKey: string;
}

export interface CreateInstanceInput {
  instanceName: string;
  webhookUrl: string;
}

export class EvolutionError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = "EvolutionError";
  }
}

/** Contato @lid (endereço anônimo do WhatsApp) precisa do JID inteiro no envio —
 *  cortar o sufixo viraria um "telefone" inexistente e a mensagem se perderia. */
function toSendNumber(remoteJid: string): string {
  return remoteJid.endsWith("@lid") ? remoteJid : remoteJid.replace(/@.*$/, "");
}

export const WEBHOOK_EVENTS = [
  "QRCODE_UPDATED",
  "CONNECTION_UPDATE",
  "MESSAGES_UPSERT",
  "MESSAGES_UPDATE",
  "SEND_MESSAGE",
] as const;

export class EvolutionClient {
  constructor(private readonly config: EvolutionConfig) {}

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const res = await fetch(`${this.config.baseUrl}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        apikey: this.config.apiKey,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = text;
    }
    if (!res.ok) {
      throw new EvolutionError(
        `Evolution ${method} ${path} → ${res.status}`,
        res.status,
        json,
      );
    }
    return json as T;
  }

  /** Cria a instância já com webhook configurado. */
  async createInstance(input: CreateInstanceInput): Promise<void> {
    await this.request("POST", "/instance/create", {
      instanceName: input.instanceName,
      qrcode: true,
      integration: "WHATSAPP-BAILEYS",
      // Anti-ruído / anti-fingerprint (design §1.1)
      groupsIgnore: true,
      readMessages: false,
      alwaysOnline: false,
      rejectCall: true,
      msgCall: "Oi! Não conseguimos atender ligação por aqui — me manda mensagem 😊",
      webhook: {
        url: input.webhookUrl,
        byEvents: false,
        base64: false,
        events: [...WEBHOOK_EVENTS],
      },
    });
  }

  /** Pede/renova o QR. Retorna base64 quando disponível. */
  async connect(instanceName: string): Promise<{ base64?: string; code?: string }> {
    return this.request("GET", `/instance/connect/${instanceName}`);
  }

  async connectionState(
    instanceName: string,
  ): Promise<{ instance?: { state?: string } }> {
    return this.request("GET", `/instance/connectionState/${instanceName}`);
  }

  async logout(instanceName: string): Promise<void> {
    await this.request("DELETE", `/instance/logout/${instanceName}`);
  }

  async deleteInstance(instanceName: string): Promise<void> {
    await this.request("DELETE", `/instance/delete/${instanceName}`);
  }

  /**
   * Envia texto. `delayMs` usa o delay nativo da Evolution: mostra
   * "digitando..." pelo período antes de soltar a mensagem (humanização).
   * Retorna o id da mensagem no WhatsApp.
   */
  async sendText(
    instanceName: string,
    remoteJid: string,
    text: string,
    delayMs?: number,
  ): Promise<{ waMessageId?: string }> {
    const res = await this.request<{ key?: { id?: string } }>(
      "POST",
      `/message/sendText/${instanceName}`,
      {
        number: toSendNumber(remoteJid),
        text,
        delay: delayMs,
      },
    );
    return { waMessageId: res.key?.id };
  }

  async sendPresence(
    instanceName: string,
    remoteJid: string,
    presence: "composing" | "paused" | "available",
    delayMs?: number,
  ): Promise<void> {
    await this.request("POST", `/chat/sendPresence/${instanceName}`, {
      number: toSendNumber(remoteJid),
      presence,
      delay: delayMs,
    });
  }
}

export function evolutionFromEnv(env: NodeJS.ProcessEnv = process.env): EvolutionClient {
  const baseUrl = env.EVOLUTION_BASE_URL;
  const apiKey = env.EVOLUTION_API_KEY;
  if (!baseUrl || !apiKey) {
    throw new Error("EVOLUTION_BASE_URL/EVOLUTION_API_KEY não configuradas.");
  }
  return new EvolutionClient({ baseUrl, apiKey });
}
