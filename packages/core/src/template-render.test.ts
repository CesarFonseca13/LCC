import { describe, expect, it } from "vitest";
import {
  extractVariables,
  renderTemplate,
  TemplateRenderError,
  unknownVariables,
} from "./template-render";

describe("template render", () => {
  it("substitui variáveis conhecidas", () => {
    const out = renderTemplate(
      "Oi {{nome}}! Seu {{procedimento}} é {{data}} às {{hora}}.",
      { nome: "Maria", procedimento: "Limpeza de Pele", data: "sexta", hora: "14h" },
      { html: false },
    );
    expect(out).toBe("Oi Maria! Seu Limpeza de Pele é sexta às 14h.");
  });

  it("escapa HTML quando html=true (termos)", () => {
    const out = renderTemplate("<p>{{nome}}</p>", { nome: "<b>x</b>" }, { html: true });
    expect(out).toBe("<p>&lt;b&gt;x&lt;/b&gt;</p>");
  });

  it("erro explícito para variável sem valor — termo nunca sai com campo vazio", () => {
    expect(() =>
      renderTemplate("CPF: {{cpf}}", {}, { html: true }),
    ).toThrow(TemplateRenderError);
  });

  it("erro para variável desconhecida", () => {
    expect(() =>
      renderTemplate("{{hacker}}", { nome: "x" }, { html: false }),
    ).toThrow(TemplateRenderError);
  });

  it("extrai e valida variáveis de um modelo", () => {
    expect(extractVariables("{{nome}} {{ cpf }} {{nome}}")).toEqual(["nome", "cpf"]);
    expect(unknownVariables("{{nome}} {{foo}}")).toEqual(["foo"]);
  });
});
