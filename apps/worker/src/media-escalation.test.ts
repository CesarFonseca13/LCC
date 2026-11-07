import { describe, expect, it } from "vitest";
import {
  normalizeEvent,
  PHONE_ONLY_MESSAGE_BODY,
  UNAVAILABLE_MESSAGE_BODY,
  type NormalizedEvent,
  type NormalizedInbound,
} from "@clinicaos/whatsapp";
import {
  HUMAN_ONLY_MEDIA,
  isCourtesyOnly,
  looksLikeHealthComplaint,
  mediaEscalationReason,
  storedHumanOnlyReason,
  storedMessageTriggersTurn,
} from "./media-escalation";

/** Mensagem da API oficial no formato que o webhook grava (META_MESSAGE). */
function metaEvent(message: Record<string, unknown>): NormalizedEvent {
  return normalizeEvent("META_MESSAGE", {
    message: { id: "wamid.X", from: "5511999990000", timestamp: "1762500000", ...message },
    contact: { profile: { name: "Maria" } },
  });
}
function meta(message: Record<string, unknown>): NormalizedInbound {
  const ev = metaEvent(message);
  if (ev.kind !== "message") throw new Error(`esperava message, veio ${ev.kind}`);
  return ev;
}
function evolution(message: Record<string, unknown>): NormalizedInbound {
  const ev = normalizeEvent("MESSAGES_UPSERT", {
    key: { id: "A1", remoteJid: "5511999990000@s.whatsapp.net", fromMe: false },
    message,
  });
  if (ev.kind !== "message") throw new Error(`esperava message, veio ${ev.kind}`);
  return ev;
}

const reasonOf = (m: NormalizedInbound) => mediaEscalationReason(m.messageType, m.rawType, m.body);

describe("mediaEscalationReason", () => {
  it("áudio, foto, vídeo, documento e localização pedem pessoa", () => {
    expect(mediaEscalationReason("audio", "audio", null)).toMatch(/^mandou um áudio/);
    expect(mediaEscalationReason("image", "image", null)).toBe("mandou uma foto");
    expect(mediaEscalationReason("video", "video", null)).toBe("mandou um vídeo");
    expect(mediaEscalationReason("document", "document", "exame.pdf")).toBe('mandou um documento: "exame.pdf"');
    expect(mediaEscalationReason("location", "location", null)).toBe("mandou uma localização");
  });

  it("legenda da foto entra no motivo (cortada em 120 caracteres)", () => {
    expect(mediaEscalationReason("image", "image", "  antes e depois  ")).toBe('mandou uma foto: "antes e depois"');
    const longa = "a".repeat(300);
    expect(mediaEscalationReason("image", "image", longa)).toBe(`mandou uma foto: "${"a".repeat(120)}"`);
  });

  it("texto, figurinha, GIF, reação e desconhecidos não pedem pessoa", () => {
    expect(mediaEscalationReason("text", "text", "oi")).toBeNull();
    expect(mediaEscalationReason("sticker", "sticker", null)).toBeNull();
    expect(mediaEscalationReason("sticker", "gif", null)).toBeNull();
    expect(mediaEscalationReason("other", "reaction", "Reagiu com 👍")).toBeNull();
    expect(mediaEscalationReason("other", undefined, null)).toBeNull();
    expect(mediaEscalationReason("other", "system", null)).toBeNull();
  });

  it("rede de segurança só para o que a atendente nunca resolve sozinha", () => {
    expect([...HUMAN_ONLY_MEDIA].sort()).toEqual(["audio", "document", "image", "video"]);
    expect(storedHumanOnlyReason("image", "meu rosto")).toBe('mandou uma foto: "meu rosto"');
    expect(storedHumanOnlyReason("other", PHONE_ONLY_MESSAGE_BODY)).toMatch(/só aparece no WhatsApp do celular/);
    expect(storedHumanOnlyReason("other", UNAVAILABLE_MESSAGE_BODY)).toBeNull(); // a atendente cumprimenta/pede de novo
    expect(storedHumanOnlyReason("location", "Casa")).toBeNull();
    expect(storedHumanOnlyReason("text", "oi")).toBeNull();
  });
});

describe("mensagens da API oficial (normalização + motivo)", () => {
  it("1ª mensagem de contato novo na coexistência (131060): indisponível, vai para a atendente", () => {
    const m = meta({
      type: "unsupported",
      unsupported: { type: "errors" },
      errors: [{ code: 131060, title: "This message is currently unavailable" }],
    });
    expect(m.messageType).toBe("other");
    expect(m.body).toBe(UNAVAILABLE_MESSAGE_BODY);
    expect(m.errorCode).toBe(131060);
    expect(reasonOf(m)).toMatch(/não chegou ao sistema/);
    expect(storedHumanOnlyReason(m.messageType, m.body)).toBeNull();
  });

  it("o que a API nunca entrega (enquete, visualização única...) só aparece no celular", () => {
    const m = meta({ type: "unsupported", unsupported: { type: "poll_creation" }, errors: [{ code: 131051 }] });
    expect(m.body).toBe(PHONE_ONLY_MESSAGE_BODY);
    expect(reasonOf(m)).toMatch(/só aparece no WhatsApp do celular/);
    expect(storedHumanOnlyReason(m.messageType, m.body)).not.toBeNull();
  });

  it("edição, fixar, guardar na conversa e voto nem viram mensagem", () => {
    for (const sub of ["edit", "pin", "keep_in_chat", "poll_update"]) {
      expect(metaEvent({ type: "unsupported", unsupported: { type: sub }, errors: [{ code: 131051 }] }).kind, sub).toBe("ignored");
    }
  });

  it("GIF e reação 'não suportados' viram balão (contam como resposta) sem pedir pessoa nem turno", () => {
    const gif = meta({ type: "unsupported", unsupported: { type: "gif" }, errors: [{ code: 131051 }] });
    expect(gif).toMatchObject({ messageType: "sticker", body: null });
    expect(reasonOf(gif)).toBeNull();
    expect(storedMessageTriggersTurn(gif.messageType, gif.body)).toBe(false);
    const reac = meta({ type: "unsupported", unsupported: { type: "reaction" }, errors: [{ code: 131051 }] });
    expect(reac).toMatchObject({ messageType: "other", body: "Reagiu a uma mensagem" });
    expect(reasonOf(reac)).toBeNull();
    expect(storedMessageTriggersTurn(reac.messageType, reac.body)).toBe(false);
  });

  it("contato compartilhado: fica 'other' (nunca vira texto para a atendente responder como fala)", () => {
    const m = meta({
      type: "contacts",
      contacts: [{ name: { formatted_name: "Ana Souza" }, phones: [{ phone: "+55 11 98888-7777" }] }],
    });
    expect(m.messageType).toBe("other");
    expect(m.body).toBe("[contato: Ana Souza +55 11 98888-7777]");
    expect(reasonOf(m)).toBe("mandou um contato: Ana Souza +55 11 98888-7777");
  });

  it("reação vira 'Reagiu com 👍' (sem motivo); reação removida não vira nada", () => {
    const m = meta({ type: "reaction", reaction: { emoji: "👍", message_id: "wamid.Y" } });
    expect(m.messageType).toBe("other");
    expect(m.body).toBe("Reagiu com 👍");
    expect(reasonOf(m)).toBeNull();
    expect(metaEvent({ type: "reaction", reaction: { emoji: "", message_id: "wamid.Y" } }).kind).toBe("ignored");
  });

  it("localização traz nome e endereço; documento sem legenda traz o nome do arquivo", () => {
    const loc = meta({ type: "location", location: { latitude: 1, longitude: 2, name: "Casa", address: "Rua X, 10" } });
    expect(loc.messageType).toBe("location");
    expect(loc.body).toBe("Casa — Rua X, 10");
    const doc = meta({ type: "document", document: { filename: "exame.pdf", id: "m1" } });
    expect(doc.messageType).toBe("document");
    expect(doc.body).toBe("exame.pdf");
  });

  it("resposta de botão e de lista continua virando texto", () => {
    expect(meta({ type: "button", button: { text: "Confirmar" } })).toMatchObject({ messageType: "text", body: "Confirmar" });
    expect(
      meta({ type: "interactive", interactive: { type: "list_reply", list_reply: { id: "1", title: "Manhã" } } }),
    ).toMatchObject({ messageType: "text", body: "Manhã" });
  });

  it("texto e foto com legenda continuam como antes", () => {
    expect(meta({ type: "text", text: { body: "oi" } })).toMatchObject({ messageType: "text", body: "oi" });
    const foto = meta({ type: "image", image: { caption: "meu rosto", id: "m2" } });
    expect(foto).toMatchObject({ messageType: "image", body: "meu rosto" });
    expect(reasonOf(foto)).toBe('mandou uma foto: "meu rosto"');
  });
});

describe("Evolution", () => {
  it("GIF (vídeo com gifPlayback) vira figurinha e não pede pessoa; vídeo comum pede", () => {
    const gif = evolution({ videoMessage: { gifPlayback: true, caption: "kkk" } });
    expect(gif.messageType).toBe("sticker");
    expect(gif.body).toBeNull();
    expect(reasonOf(gif)).toBeNull();
    expect(reasonOf(evolution({ videoMessage: {} }))).toBe("mandou um vídeo");
  });

  it("legenda da foto e do documento vai para o corpo (sem virar texto)", () => {
    const foto = evolution({ imageMessage: { caption: "está doendo e inchado" } });
    expect(foto).toMatchObject({ messageType: "image", body: "está doendo e inchado" });
    const doc = evolution({ documentWithCaptionMessage: { message: { documentMessage: { caption: "meu exame", fileName: "x.pdf" } } } });
    expect(doc).toMatchObject({ messageType: "document", body: "meu exame" });
    expect(evolution({ documentMessage: { fileName: "receita.pdf" } })).toMatchObject({ messageType: "document", body: "receita.pdf" });
    expect(evolution({ conversation: "oi" })).toMatchObject({ messageType: "text", body: "oi" });
  });
});

describe("o que agenda turno (e por isso pode descartar um turno em andamento)", () => {
  it("texto, anexo, contato e mensagem indisponível agendam; figurinha e reação não", () => {
    expect(storedMessageTriggersTurn("text", "oi")).toBe(true);
    expect(storedMessageTriggersTurn("text", "  ")).toBe(false);
    expect(storedMessageTriggersTurn("image", null)).toBe(true);
    expect(storedMessageTriggersTurn("location", null)).toBe(true);
    expect(storedMessageTriggersTurn("other", "[contato: Ana]")).toBe(true);
    expect(storedMessageTriggersTurn("other", UNAVAILABLE_MESSAGE_BODY)).toBe(true);
    expect(storedMessageTriggersTurn("other", PHONE_ONLY_MESSAGE_BODY)).toBe(true);
    expect(storedMessageTriggersTurn("sticker", null)).toBe(false);
    expect(storedMessageTriggersTurn("other", "Reagiu com ❤️")).toBe(false);
    expect(storedMessageTriggersTurn("other", null)).toBe(false);
  });
});

describe("queixa de saúde (vira urgente em conversa que já espera a equipe)", () => {
  it("reconhece as formas reais de relatar efeito adverso", () => {
    for (const t of [
      "meu rosto ficou inchado depois da aplicação",
      "está doendo muito",
      "estou com falta de ar",
      "VÔMITO sem parar desde ontem",
      "deu uma reação alérgica",
      "tá sangrando um pouco",
      "febre de 39",
      "estou com muito enjoo",
      "estou enjoada",
      "é urgente!!",
      "passei mal a noite toda depois da aplicação",
      "estou me sentindo muito mal",
      "tá começando a doer o local",
      "a barriga tá inchando",
      "saiu sangue no lugar da injeção",
      "ficou um caroço onde apliquei",
      "tá dolorido",
      "apliquei a dose duas vezes sem querer",
      "descobri que estou grávida",
      "coração disparado desde ontem",
      "está saindo pus",
      "fiquei tonta",
      "ficou roxo",
      "está doendo, é normal?",
    ]) {
      expect(looksLikeHealthComplaint(t), t).toBe(true);
    }
  });

  it("não marca conversa comum nem pergunta de venda", () => {
    for (const t of [
      "quero remarcar para quinta",
      "qual o valor da consulta?",
      "obrigada, doutor!",
      "pode ser às 10h",
      "Reagiu com 👍",
      "pronto, já pus o comprovante aí",
      "que tonta, esqueci o documento",
      "a fatura veio roxa",
      "batom vermelho",
      "eu me enjoei do horário",
      "estou sem ar condicionado",
      "pode responder quando puder, não é urgente",
      "sem urgência",
      "a aplicação dói?",
      "esse remédio dá enjoo?",
      "quais as reações da tirzepatida?",
      "preciso levar o exame de sangue?",
      "é a do portão vermelho?",
    ]) {
      expect(looksLikeHealthComplaint(t), t).toBe(false);
    }
  });
});

describe("cortesia depois do opt-out (não chama a equipe)", () => {
  it("agradecimento curto, ok, emoji e figurinha", () => {
    for (const t of ["obrigada", "Obrigada!!", "muito obrigada", "ok", "valeu", "tá bom", "🙏", "obrigada, doutora", null]) {
      expect(isCourtesyOnly(t), String(t)).toBe(true);
    }
  });

  it("qualquer coisa além disso chama a equipe", () => {
    for (const t of ["obrigada, mas quero remarcar", "ok?", "quero voltar a receber", "ok cancela minha consulta", "obrigada, estou com muita dor"]) {
      expect(isCourtesyOnly(t), t).toBe(false);
    }
  });
});
