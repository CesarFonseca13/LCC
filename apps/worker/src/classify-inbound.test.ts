import { describe, expect, it } from "vitest";
import { isCourtesyQuestion, withinNudgeHours } from "./ai-agent";
import { asksToChangeAppointment, noticeIsAboutChangingAppointment, reminderReplyConfirms } from "./classify-inbound";

/** Sem fala da clínica depois do lembrete: todas as mensagens são candidatas. */
const direto = (texts: string[]) => reminderReplyConfirms(texts, texts, false);

describe("resposta ao lembrete com a conversa na equipe", () => {
  it("resposta direta ao lembrete: 'sim', 'ok', 👍 e 'confirmo' confirmam", () => {
    for (const t of ["sim", "Sim!", "Siiim", "ok", "Ok, obrigada", "Sim 👍", "👍", "confirmo", "Pode confirmar", "vou sim", "estarei aí", "Sim, confirmo!", "Confirmo minha presença 👍"]) {
      expect(direto([t]), t).toBe(true);
    }
  });

  it("negação, adiamento ou dúvida NUNCA confirmam", () => {
    for (const t of [
      "Depois te confirmo",
      "Vou ver com meu marido e te confirmo",
      "Ainda não sei se confirmo",
      "Não confirmo ainda",
      "Não estarei aí amanhã",
      "Confirmo amanhã cedo",
      "Pode ser na quinta",
      "Pode ser às 15h em vez das 10h",
      "Claro que não",
      "Com certeza está pior que ontem",
      "pode confirmar?",
    ]) {
      expect(direto([t]), t).toBe(false);
    }
  });

  it("recusa sem palavra-chave seguida de 'ok'/'👍'/'combinado' não confirma o horário recusado", () => {
    expect(direto(["Esse horário não vai dar pra mim", "Combinado 👍"])).toBe(false);
    expect(direto(["Não dá pra mim amanhã", "👍"])).toBe(false);
    expect(direto(["Vou faltar", "ok"])).toBe(false);
    expect(direto(["Ok", "na verdade não sei se vou conseguir"])).toBe(false);
    expect(direto(["sim", "mas estou com muita dor e inchaço desde ontem"])).toBe(false);
  });

  it("se a clínica falou depois do lembrete, só 'confirmo' explícito DEPOIS dessa fala confirma", () => {
    expect(reminderReplyConfirms(["ok"], ["ok"], true)).toBe(false); // pode ser resposta à atendente
    expect(reminderReplyConfirms(["sim"], ["sim"], true)).toBe(false);
    expect(reminderReplyConfirms(["confirmo"], ["confirmo"], true)).toBe(true);
    // 'Pode confirmar' dito ANTES (sobre outro assunto, já tratado pela atendente) não conta
    expect(reminderReplyConfirms(["quero marcar pro meu filho", "Pode confirmar", "oi"], ["oi"], true)).toBe(false);
    expect(reminderReplyConfirms(["Pode confirmar", "oi"], ["oi"], true)).toBe(false);
  });

  it("anexo desde o lembrete (áudio, foto com legenda) bloqueia: a recusa pode estar nele", () => {
    expect(reminderReplyConfirms(["[anexo]", "Ok, obrigada"], ["Ok, obrigada"], false)).toBe(false);
    expect(reminderReplyConfirms(["[anexo]", "confirmo"], ["confirmo"], false)).toBe(false);
  });

  it("motivo da espera é trocar/cancelar (palavra-chave ou texto livre da atendente)", () => {
    for (const body of [
      "quer cancelar: \"não vou poder ir\"",
      "quer remarcar: \"pode ser outro dia?\"",
      "Cliente quer trocar o horário de quinta para a semana que vem; não há vagas",
      "Cliente pediu para adiar a consulta",
      "Cliente não poderá comparecer na quinta",
      "Mandou uma foto: \"Não vou poder ir, estou de atestado\"",
    ]) {
      expect(noticeIsAboutChangingAppointment(body), body).toBe(true);
    }
    for (const body of ["fez uma pergunta: \"vocês aceitam cartão?\"", "Mandou um áudio (ouça no WhatsApp do celular da clínica).", "Responda esta conversa pela equipe. Depois de ajustar o limite em Configurações → Gastos com API, clique em “Devolver para o automático” nesta conversa."]) {
      expect(noticeIsAboutChangingAppointment(body), body).toBe(false);
    }
  });

  it("pedido de troca/cancelamento antes do lembrete é reconhecido", () => {
    expect(asksToChangeAppointment("quarta não vou conseguir ir, pode desmarcar")).toBe(true);
    expect(asksToChangeAppointment("tem outro horário?")).toBe(true);
    expect(asksToChangeAppointment("vocês aceitam cartão?")).toBe(false);
  });

  it("cumprimento e 'obrigada' não atrapalham; sem candidata não confirma", () => {
    expect(direto(["bom dia", "confirmo", "obrigada"])).toBe(true);
    expect(direto(["oi", "obrigada"])).toBe(false);
    expect(reminderReplyConfirms([], [], false)).toBe(false);
  });
});

describe("toque de silêncio", () => {
  const sp = (hhmm: string) => new Date(`2026-11-09T${hhmm}:00-03:00`);
  it("só em horário comercial (8h às 21h no fuso da clínica)", () => {
    expect(withinNudgeHours("America/Sao_Paulo", sp("07:59"))).toBe(false);
    expect(withinNudgeHours("America/Sao_Paulo", sp("08:00"))).toBe(true);
    expect(withinNudgeHours("America/Sao_Paulo", sp("20:59"))).toBe(true);
    expect(withinNudgeHours("America/Sao_Paulo", sp("21:00"))).toBe(false);
    expect(withinNudgeHours("America/Sao_Paulo", sp("23:30"))).toBe(false);
  });

  it("pergunta de cortesia no fim não pede cutucada; pergunta de verdade pede", () => {
    for (const t of ["Posso ajudar em algo mais?", "Mais alguma dúvida? 😊", "Qualquer coisa me chama, tá?", "Te espero quinta, ok?"]) {
      expect(isCourtesyQuestion(t), t).toBe(true);
    }
    for (const t of ["Tenho quinta às 10h ou 14h, qual prefere?", "Qual seu nome completo?", "Posso confirmar para quinta?"]) {
      expect(isCourtesyQuestion(t), t).toBe(false);
    }
  });
});
