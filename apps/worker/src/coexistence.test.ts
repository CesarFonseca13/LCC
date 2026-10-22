import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { brPhoneVariants, jidToPhone, phoneToJids, waDigitsToE164 } from "@clinicaos/whatsapp";
import { describeMessage, mapStatus } from "./coexistence";

describe("consulta por lista de telefones (drizzle expande array como lista)", () => {
  it("IN ${forms} vira IN ($1, $2), nunca ANY((...))", () => {
    const forms = brPhoneVariants("+5561984409779");
    const q = new PgDialect().sqlToQuery(sql`cp.phone_e164 IN ${forms}`);
    expect(q.sql).toBe("cp.phone_e164 IN ($1, $2)");
    expect(q.params).toEqual(["+5561984409779", "+556184409779"]);
    const one = new PgDialect().sqlToQuery(sql`cp.phone_e164 IN ${brPhoneVariants("+556133334444")}`);
    expect(one.sql).toBe("cp.phone_e164 IN ($1)");
  });
  it("jids equivalentes para achar a conversa", () => {
    expect(phoneToJids("+5561984409779")).toEqual(["5561984409779@s.whatsapp.net", "556184409779@s.whatsapp.net"]);
    expect(phoneToJids("+15551575741")).toEqual(["15551575741@s.whatsapp.net"]);
  });
});

describe("telefone do WhatsApp → E.164", () => {
  it("celular BR sem o nono dígito ganha o 9", () => {
    expect(waDigitsToE164("556184409779")).toBe("+5561984409779");
    expect(jidToPhone("556184409779@s.whatsapp.net")).toBe("+5561984409779");
  });
  it("celular BR já com o 9 e fixo ficam como estão", () => {
    expect(waDigitsToE164("5561984409779")).toBe("+5561984409779");
    expect(waDigitsToE164("556133334444")).toBe("+556133334444");
  });
  it("outros países só ganham o +", () => {
    expect(waDigitsToE164("15551575741")).toBe("+15551575741");
    expect(waDigitsToE164("123")).toBeNull();
  });
  it("variantes com e sem o nono dígito", () => {
    expect(brPhoneVariants("+5561984409779")).toEqual(["+5561984409779", "+556184409779"]);
    expect(brPhoneVariants("+556184409779")).toEqual(["+5561984409779", "+556184409779"]);
    expect(brPhoneVariants("+556133334444")).toEqual(["+556133334444"]);
    expect(brPhoneVariants("+15551575741")).toEqual(["+15551575741"]);
  });
});

describe("mensagem do histórico", () => {
  it("texto, legenda e placeholder de mídia", () => {
    expect(describeMessage({ type: "text", text: { body: "oi" } })).toEqual({ type: "text", body: "oi" });
    expect(describeMessage({ type: "image", image: { caption: "antes" } })).toEqual({ type: "image", body: "antes" });
    expect(describeMessage({ type: "media_placeholder" })).toEqual({ type: "other", body: null });
    expect(describeMessage({ type: "reaction", reaction: { emoji: "❤️" } })).toEqual({ type: "other", body: "Reagiu com ❤️" });
  });
  it("documento, localização, contatos, botões e desconhecidos", () => {
    expect(describeMessage({ type: "document", document: { filename: "exame.pdf" } })).toEqual({ type: "document", body: "exame.pdf" });
    expect(describeMessage({ type: "location", location: { name: "Clínica", address: "Rua X" } })).toEqual({ type: "location", body: "Clínica — Rua X" });
    expect(describeMessage({ type: "location", location: {} })).toEqual({ type: "location", body: null });
    expect(describeMessage({ type: "contacts", contacts: [{ name: { formatted_name: "Ana" } }] })).toEqual({ type: "other", body: "Contato: Ana" });
    expect(describeMessage({ type: "contacts", contacts: [] })).toEqual({ type: "other", body: "Contato compartilhado" });
    expect(describeMessage({ type: "button", button: { text: "Sim" } })).toEqual({ type: "text", body: "Sim" });
    expect(describeMessage({ type: "interactive", interactive: { list_reply: { title: "Limpeza" } } })).toEqual({ type: "text", body: "Limpeza" });
    expect(describeMessage({ type: "video" })).toEqual({ type: "video", body: null });
    expect(describeMessage({ type: "audio" })).toEqual({ type: "audio", body: null });
    expect(describeMessage({})).toEqual({ type: "other", body: null });
    expect(describeMessage({ type: "unsupported" })).toEqual({ type: "other", body: null });
  });
  it("status da Meta → status do sistema", () => {
    expect(mapStatus("READ")).toBe("read");
    expect(mapStatus("PLAYED")).toBe("read");
    expect(mapStatus("DELIVERED")).toBe("delivered");
    expect(mapStatus("ERROR")).toBe("failed");
    expect(mapStatus("PENDING")).toBe("sent");
    expect(mapStatus("SENT")).toBe("sent");
    expect(mapStatus("read")).toBe("read");
    expect(mapStatus(undefined)).toBe("sent");
  });
});
