/**
 * Anamnese: tipos do schema versionado e o modelo seed de estética.
 * Campos com `risk: true` e valor preenchido/verdadeiro viram o alerta
 * clínico vermelho no topo da ficha (visível em todas as abas).
 */
export interface AnamnesisField {
  key: string;
  label: string;
  type: "text" | "boolean";
  risk?: boolean;
  placeholder?: string;
}

export interface AnamnesisSection {
  section: string;
  fields: AnamnesisField[];
}

export type AnamnesisSchema = AnamnesisSection[];
export type AnamnesisAnswers = Record<string, string | boolean>;

export const AESTHETIC_ANAMNESIS_V1: AnamnesisSchema = [
  {
    section: "Alergias e medicamentos",
    fields: [
      {
        key: "alergias",
        label: "Alergias",
        type: "text",
        risk: true,
        placeholder: "Descreva alergias conhecidas (medicamentos, cosméticos...)",
      },
      {
        key: "medicamentos",
        label: "Medicamentos em uso",
        type: "text",
        placeholder: "Liste os medicamentos atuais",
      },
    ],
  },
  {
    section: "Saúde",
    fields: [
      {
        key: "doencas_cronicas",
        label: "Doenças crônicas",
        type: "text",
        risk: true,
        placeholder: "Diabetes, hipertensão, etc.",
      },
      { key: "gestante", label: "Gestante", type: "boolean", risk: true },
      { key: "lactante", label: "Lactante", type: "boolean", risk: true },
      { key: "marcapasso", label: "Marca-passo", type: "boolean", risk: true },
      { key: "tabagismo", label: "Tabagismo", type: "boolean" },
      { key: "etilismo", label: "Etilismo", type: "boolean" },
    ],
  },
  {
    section: "Pele e hábitos",
    fields: [
      { key: "exposicao_solar", label: "Exposição solar frequente", type: "boolean" },
      { key: "protetor_solar", label: "Usa protetor solar", type: "boolean" },
      { key: "uso_acidos", label: "Uso de ácidos", type: "boolean" },
      {
        key: "problemas_pele",
        label: "Problemas de pele",
        type: "text",
        placeholder: "Acne, manchas, rosácea...",
      },
      {
        key: "historico_cirurgico",
        label: "Histórico cirúrgico",
        type: "text",
        placeholder: "Cirurgias anteriores",
      },
    ],
  },
];

/** Rótulos de risco a partir das respostas (guardados em claro p/ alerta da ficha). */
export function computeRiskSummary(
  schema: AnamnesisSchema,
  answers: AnamnesisAnswers,
): string | null {
  const risks: string[] = [];
  for (const section of schema) {
    for (const field of section.fields) {
      if (!field.risk) continue;
      const value = answers[field.key];
      if (field.type === "boolean" && value === true) risks.push(field.label);
      if (field.type === "text" && typeof value === "string" && value.trim()) {
        risks.push(`${field.label}: ${value.trim()}`);
      }
    }
  }
  return risks.length > 0 ? risks.join(" · ") : null;
}
