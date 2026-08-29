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
  status: "delivered" | "read" | null;
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

export function normalizeEvent(eventType: string, data: unknown): NormalizedEvent {
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
