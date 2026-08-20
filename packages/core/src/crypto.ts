import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Cifra de dados sensíveis de saúde (LGPD art. 11) — AES-256-GCM em nível de aplicação.
 * Anamnese e evolução clínica são gravadas no banco APENAS cifradas.
 * Formato do payload: v1:<iv base64>:<authTag base64>:<ciphertext base64>
 */
const VERSION = "v1";

export function encryptSensitive(plaintext: string, keyBase64: string): string {
  const key = Buffer.from(keyBase64, "base64");
  if (key.length !== 32) throw new Error("Chave de cifra deve ter 32 bytes (base64).");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString("base64"),
    authTag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(":");
}

export function decryptSensitive(payload: string, keyBase64: string): string {
  const key = Buffer.from(keyBase64, "base64");
  const parts = payload.split(":");
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error("Payload cifrado em formato inválido.");
  }
  const [, ivB64, tagB64, dataB64] = parts;
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64!, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64!, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64!, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

export function isEncryptedPayload(value: string): boolean {
  return value.startsWith(`${VERSION}:`);
}
