/** Formatação pt-BR usada em todo o painel. */

export function formatBRL(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = typeof value === "string" ? Number(value) : value;
  if (Number.isNaN(n)) return "—";
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** Aceita "1.200,50", "1200.50" ou "1200" e devolve string decimal p/ numeric. */
export function parseBRLDecimal(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const normalized = trimmed
    .replace(/\s|R\$/g, "")
    .replace(/\.(?=\d{3}(\D|$))/g, "") // separador de milhar
    .replace(",", ".");
  const n = Number(normalized);
  if (Number.isNaN(n) || n < 0) return null;
  return n.toFixed(2);
}

/** Formata um decimal ("1500.00") como "1.500,00" — sem o "R$" (o modelo já escreve). */
export function formatDecimalBR(decimal: string): string {
  const n = Number(decimal);
  if (!Number.isFinite(n)) return "";
  return n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Devolve os 11 dígitos do CPF (aceita com ou sem máscara) ou null. Não valida DV:
 *  clínicas recebem CPFs de cadastros antigos e o bloqueio por dígito verificador
 *  só travaria o envio de um termo por erro de digitação de terceiros. */
export function normalizeCPF(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  return digits.length === 11 ? digits : null;
}

export function formatCPF(digits: string): string {
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
}

/** 14 dígitos com os dois dígitos verificadores conferidos, ou null. */
export function normalizeCNPJ(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length !== 14 || /^(\d)\1{13}$/.test(digits)) return null;
  const dv = (base: string, weights: number[]) => {
    const sum = base.split("").reduce((acc, ch, i) => acc + Number(ch) * (weights[i] ?? 0), 0);
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  const dv1 = dv(digits.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const dv2 = dv(digits.slice(0, 13), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return dv1 === Number(digits[12]) && dv2 === Number(digits[13]) ? digits : null;
}

export function formatCNPJ(digits: string): string {
  return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
}

export function normalizeCEP(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  return digits.length === 8 ? digits : null;
}

export function formatCEP(digits: string): string {
  return `${digits.slice(0, 5)}-${digits.slice(5)}`;
}

export function isValidEmail(raw: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(raw.trim());
}

export function formatDurationMin(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, "0")}`;
}
