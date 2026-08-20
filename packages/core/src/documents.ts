import { createHash } from "node:crypto";
import { renderTemplate } from "./template-render";

/**
 * Termos de consentimento: o modelo é TEXTO SIMPLES com {{variáveis}}
 * (a dona nunca edita HTML). Aqui ele vira HTML seguro e congelável.
 */

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Texto com {{vars}} → HTML (parágrafos por linha em branco) com valores preenchidos. */
export function renderTermHtml(
  bodyText: string,
  values: Partial<Record<string, string>>,
): string {
  const escaped = escapeHtml(bodyText);
  const filled = renderTemplate(escaped, values, { html: true });
  const paragraphs = filled
    .split(/\r?\n\s*\r?\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${p.replace(/\r?\n/g, "<br/>")}</p>`);
  return paragraphs.join("\n");
}

export function sha256Hex(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/** Modelo seed de termo de consentimento (estética) — revisar com o responsável técnico. */
export const DEFAULT_CONSENT_TEMPLATE = {
  name: "Termo de Consentimento — Procedimento Estético",
  bodyText: `TERMO DE CONSENTIMENTO LIVRE E ESCLARECIDO

Eu, {{nome}}, portador(a) do CPF {{cpf}}, telefone {{telefone}}, residente em {{endereco}}, declaro que fui devidamente informado(a) pela equipe da {{clinica}} sobre o procedimento {{procedimento}}, no valor de R$ {{valor}}, seus objetivos, benefícios esperados, possíveis desconfortos, riscos e cuidados necessários antes e após a sessão.

Declaro que tive a oportunidade de esclarecer todas as minhas dúvidas, que respondi com veracidade à avaliação e à ficha de anamnese, e que estou ciente de que os resultados podem variar de pessoa para pessoa.

Autorizo a realização do procedimento e o registro fotográfico para acompanhamento clínico da minha evolução, ciente de que as imagens integram meu prontuário e não serão divulgadas sem minha autorização expressa.

Li e compreendi este termo na íntegra e o assino eletronicamente em {{data}}.`,
};
