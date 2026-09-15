import { z } from "zod";

/**
 * Normalização dos webhooks da Evolution — tolerante a variações de payload
 * (a Evolution muda detalhes entre versões; campos desconhecidos são ignorados).
 */

export const webhookEnvelopeSchema = z.object({
  event: z.string(),
  instance: z.string().optional(),
  data: z.unknown(),
});

export type WebhookEnvelope = z.infer<typeof webhookEnvelopeSchema>;

export interface NormalizedInbound {
  kind: "message";
  waMessageId: string;
  remoteJid: string;
  fromMe: boolean;
  messageType:
    | "text"
    | "image"
    | "audio"
    | "video"
    | "document"
    | "sticker"
    | "location"
    | "other";
  body: string | null;
  pushName: string | null;
  timestamp: number | null;
}

export interface NormalizedStatusUpdate {
  kind: "status";
  waMessageId: string;
  remoteJid: string | null;
  status: "delivered" | "read" | "failed" | null;
  /** Só na API oficial: motivo da falha em pt-BR (janela de 24h, template etc.). */
  error?: string | null;
}

export interface NormalizedConnection {
  kind: "connection";
  state: "open" | "connecting" | "close" | "logout" | "unknown";
  phoneNumber: string | null;
}

export interface NormalizedQr {
  kind: "qr";
  base64: string | null;
}

export type NormalizedEvent =
  | NormalizedInbound
  | NormalizedStatusUpdate
  | NormalizedConnection
  | NormalizedQr
  | { kind: "ignored" };

function get(obj: unknown, path: string[]): unknown {
  let cur: unknown = obj;
  for (const key of path) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

export function extractWaMessageId(eventType: string, data: unknown): string | null {
  if (eventType === "MESSAGES_UPSERT" || eventType === "SEND_MESSAGE") {
    return str(get(data, ["key", "id"]));
  }
  if (eventType === "MESSAGES_UPDATE") {
    return str(get(data, ["keyId"])) ?? str(get(data, ["key", "id"]));
  }
  return null;
}

/** Mensagens de erro da Meta traduzidas para a equipe (as demais saem cruas). */
export function metaErrorToPortuguese(code: number | null, fallback: string): string {
  switch (code) {
    case 131047:
      return "A cliente não escreveu nas últimas 24h — na API oficial só é possível enviar um modelo aprovado pela Meta.";
    case 131026:
      return "Número não recebe mensagens (sem WhatsApp, app desatualizado ou bloqueou a clínica).";
    case 131056:
      return "Muitas mensagens para este número em pouco tempo — a Meta pediu para esperar.";
    case 132000:
      return "O modelo aprovado espera outra quantidade de campos — avise o suporte.";
    case 132001:
      return "O modelo desta mensagem ainda não foi aprovado pela Meta.";
    case 132015:
    case 132016:
      return "A Meta pausou este modelo por baixa qualidade — é preciso um modelo novo.";
    case 190:
      return "O token da API oficial expirou ou foi revogado — reconecte o número em Configurações.";
    case 131042:
      return "Problema no pagamento da conta do WhatsApp Business (Meta) — confira o método de pagamento.";
    case 133010:
      return "O número não está registrado na plataforma do WhatsApp Business.";
    default:
      return fallback;
  }
}

/** Evento bruto da Meta → mesmo formato dos eventos da Evolution.
 *  META_MESSAGE: { message, contact, metadata }; META_STATUS_*: { status }. */
function normalizeMetaEvent(eventType: string, data: unknown): NormalizedEvent {
  if (eventType === "META_MESSAGE") {
    const message = get(data, ["message"]);
    const waMessageId = str(get(message, ["id"]));
    const from = str(get(message, ["from"]));
    if (!waMessageId || !from) return { kind: "ignored" };
    const type = str(get(message, ["type"])) ?? "other";
    const known = ["text", "image", "audio", "video", "document", "sticker", "location"] as const;
    const messageType = (known as readonly string[]).includes(type)
      ? (type as NormalizedInbound["messageType"])
      : "other";
    const body =
      str(get(message, ["text", "body"])) ??
      str(get(message, [type, "caption"])) ??
      str(get(message, ["button", "text"])) ??
      str(get(message, ["interactive", "button_reply", "title"])) ??
      null;
    const ts = Number(get(message, ["timestamp"]));
    return {
      kind: "message",
      waMessageId,
      remoteJid: `${from.replace(/\D/g, "")}@s.whatsapp.net`,
      fromMe: false,
      messageType: body && messageType === "other" ? "text" : messageType,
      body,
      pushName: str(get(data, ["contact", "profile", "name"])),
      timestamp: Number.isFinite(ts) ? ts : null,
    };
  }
  if (eventType.startsWith("META_STATUS")) {
    const status = get(data, ["status"]);
    const waMessageId = str(get(status, ["id"]));
    if (!waMessageId) return { kind: "ignored" };
    const raw = str(get(status, ["status"])) ?? "";
    const mapped =
      raw === "read" ? ("read" as const) : raw === "delivered" ? ("delivered" as const) : raw === "failed" ? ("failed" as const) : null;
    const errors = get(status, ["errors"]) as { code?: number; title?: string; message?: string; error_data?: { details?: string } }[] | undefined;
    const first = Array.isArray(errors) ? errors[0] : undefined;
    const recipient = str(get(status, ["recipient_id"]));
    return {
      kind: "status",
      waMessageId,
      remoteJid: recipient ? `${recipient}@s.whatsapp.net` : null,
      status: mapped,
      error:
        mapped === "failed"
          ? metaErrorToPortuguese(
              typeof first?.code === "number" ? first.code : null,
              first?.error_data?.details ?? first?.message ?? first?.title ?? "falha no envio",
            )
          : null,
    };
  }
  return { kind: "ignored" };
}

export function normalizeEvent(eventType: string, data: unknown): NormalizedEvent {
  if (eventType.startsWith("META_")) return normalizeMetaEvent(eventType, data);
  switch (eventType) {
    case "MESSAGES_UPSERT":
    case "SEND_MESSAGE": {
      const waMessageId = str(get(data, ["key", "id"]));
      let remoteJid = str(get(data, ["key", "remoteJid"]));
      if (!waMessageId || !remoteJid) return { kind: "ignored" };
      // Grupos são ignorados por configuração da instância; segunda linha de defesa:
      if (remoteJid.endsWith("@g.us")) return { kind: "ignored" };
      // Contato @lid (endereço anônimo do WhatsApp): a Evolution ≥2.3 entrega o
      // telefone REAL ao lado — sem isso a ficha ganha um "+94..." que não existe.
      if (remoteJid.endsWith("@lid")) {
        const real =
          str(get(data, ["key", "senderPn"])) ??
          str(get(data, ["key", "remoteJidAlt"])) ??
          str(get(data, ["key", "participantPn"]));
        if (real?.endsWith("@s.whatsapp.net")) remoteJid = real;
      }

      const message = get(data, ["message"]);
      const text =
        str(get(message, ["conversation"])) ??
        str(get(message, ["extendedTextMessage", "text"]));
      let messageType: NormalizedInbound["messageType"] = "other";
      if (text !== null) messageType = "text";
      else if (get(message, ["imageMessage"])) messageType = "image";
      else if (get(message, ["audioMessage"])) messageType = "audio";
      else if (get(message, ["videoMessage"])) messageType = "video";
      else if (get(message, ["documentMessage"])) messageType = "document";
      else if (get(message, ["stickerMessage"])) messageType = "sticker";
      else if (get(message, ["locationMessage"])) messageType = "location";

      const ts = get(data, ["messageTimestamp"]);
      return {
        kind: "message",
        waMessageId,
        remoteJid,
        fromMe: get(data, ["key", "fromMe"]) === true,
        messageType,
        body: text,
        pushName: str(get(data, ["pushName"])),
        timestamp: typeof ts === "number" ? ts : null,
      };
    }

    case "MESSAGES_UPDATE": {
      const waMessageId =
        str(get(data, ["keyId"])) ?? str(get(data, ["key", "id"]));
      if (!waMessageId) return { kind: "ignored" };
      const rawStatus = (str(get(data, ["status"])) ?? "").toUpperCase();
      const status =
        rawStatus === "READ"
          ? ("read" as const)
          : rawStatus === "DELIVERY_ACK"
            ? ("delivered" as const)
            : null;
      return {
        kind: "status",
        waMessageId,
        remoteJid: str(get(data, ["remoteJid"])) ?? str(get(data, ["key", "remoteJid"])),
        status,
      };
    }

    case "CONNECTION_UPDATE": {
      const rawState = str(get(data, ["state"])) ?? "unknown";
      const state = (["open", "connecting", "close", "logout"] as const).includes(
        rawState as never,
      )
        ? (rawState as "open" | "connecting" | "close" | "logout")
        : "unknown";
      const owner = str(get(data, ["wuid"])) ?? str(get(data, ["number"]));
      return {
        kind: "connection",
        state,
        phoneNumber: owner ? `+${owner.replace(/@.*$/, "").replace(/\D/g, "")}` : null,
      };
    }

    case "QRCODE_UPDATED": {
      return {
        kind: "qr",
        base64:
          str(get(data, ["qrcode", "base64"])) ?? str(get(data, ["base64"])),
      };
    }

    default:
      return { kind: "ignored" };
  }
}

/** remoteJid → telefone E.164 (+5511... ). */
export function jidToPhone(remoteJid: string): string | null {
  const digits = remoteJid.replace(/@.*$/, "").replace(/\D/g, "");
  if (digits.length < 10) return null;
  return `+${digits}`;
}
