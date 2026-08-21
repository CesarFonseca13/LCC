/**
 * Render de templates {{variavel}} com whitelist — sem eval, sem engine completa
 * (superfície de injeção desnecessária). Variável desconhecida ou não fornecida
 * é erro explícito: termo de consentimento com "{{cpf}}" vazando é inaceitável.
 */
export const KNOWN_VARIABLES = [
  "nome",
  "cpf",
  "telefone",
  "email",
  "endereco",
  "valor",
  "procedimento",
  "clinica",
  "data",
  "hora",
  "profissional",
  "link",
  "link_agendamento",
  "cuidados",
  "dias",
  "pacote",
  "sessoes",
  "horario",
] as const;

export type TemplateVariable = (typeof KNOWN_VARIABLES)[number];

const VAR_PATTERN = /\{\{\s*([a-z_]+)\s*\}\}/g;

export class TemplateRenderError extends Error {
  constructor(message: string, public readonly variable: string) {
    super(message);
    this.name = "TemplateRenderError";
  }
}

/** Extrai as variáveis usadas num template (para validação no save do modelo). */
export function extractVariables(template: string): string[] {
  const found = new Set<string>();
  for (const match of template.matchAll(VAR_PATTERN)) {
    found.add(match[1]!);
  }
  return [...found];
}

/** Valida que o template só usa variáveis conhecidas. Retorna as desconhecidas. */
export function unknownVariables(template: string): string[] {
  return extractVariables(template).filter(
    (v) => !(KNOWN_VARIABLES as readonly string[]).includes(v),
  );
}

/**
 * Placeholders "tortos" que o render NÃO substituiria e sairiam literais na
 * mensagem ({{Nome}}, {{ NOME }}, {{nome cliente}}, {{clínica}} com acento...).
 * Todo save de template deve rejeitá-los — mensagem com {{...}} cru entrega
 * que é um sistema.
 */
export function strayPlaceholders(template: string): string[] {
  const anyBraces = /\{\{\s*([^{}]*?)\s*\}\}/g;
  const stray = new Set<string>();
  for (const match of template.matchAll(anyBraces)) {
    const inner = match[1]!;
    if (!/^[a-z_]+$/.test(inner)) stray.add(inner);
  }
  return [...stray];
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export interface RenderOptions {
  /** true para conteúdo HTML (termos); false para texto puro (mensagens WhatsApp). */
  html: boolean;
}

export function renderTemplate(
  template: string,
  values: Partial<Record<string, string>>,
  options: RenderOptions,
): string {
  return template.replace(VAR_PATTERN, (_, name: string) => {
    if (!(KNOWN_VARIABLES as readonly string[]).includes(name)) {
      throw new TemplateRenderError(`Variável desconhecida: {{${name}}}`, name);
    }
    const value = values[name];
    if (value === undefined || value === null || value === "") {
      throw new TemplateRenderError(`Variável sem valor: {{${name}}}`, name);
    }
    return options.html ? escapeHtml(value) : value;
  });
}
