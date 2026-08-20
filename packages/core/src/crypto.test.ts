import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptSensitive, encryptSensitive, isEncryptedPayload } from "./crypto";

const KEY = randomBytes(32).toString("base64");

describe("cifra de dados sensíveis (AES-256-GCM)", () => {
  it("roundtrip", () => {
    const plain = JSON.stringify({ alergias: "lidocaína", gestante: true });
    const payload = encryptSensitive(plain, KEY);
    expect(isEncryptedPayload(payload)).toBe(true);
    expect(payload).not.toContain("lidocaína");
    expect(decryptSensitive(payload, KEY)).toBe(plain);
  });

  it("dois ciphertexts do mesmo texto diferem (IV aleatório)", () => {
    expect(encryptSensitive("x", KEY)).not.toBe(encryptSensitive("x", KEY));
  });

  it("falha com chave errada (authTag)", () => {
    const payload = encryptSensitive("segredo", KEY);
    const otherKey = randomBytes(32).toString("base64");
    expect(() => decryptSensitive(payload, otherKey)).toThrow();
  });

  it("rejeita chave de tamanho errado", () => {
    expect(() => encryptSensitive("x", "curta")).toThrow();
  });
});
