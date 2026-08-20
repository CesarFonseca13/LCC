/**
 * Normalização de telefone brasileiro para E.164 (+55DDDNÚMERO).
 * Aceita: "(11) 98862-1152", "11 98862 1152", "11988621152", "5511988621152",
 * "+55 11 98862-1152". Celular BR: DDD (2) + 9 dígitos; fixo: DDD (2) + 8.
 */
export function normalizePhoneBR(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return null;

  let national = digits;
  if (national.startsWith("0055")) national = national.slice(4);
  else if (national.startsWith("55") && national.length >= 12) national = national.slice(2);
  // remove zero de operadora ("011 98862-1152")
  if (national.length === 11 + 1 && national.startsWith("0")) national = national.slice(1);

  if (national.length !== 10 && national.length !== 11) return null;

  const ddd = Number(national.slice(0, 2));
  if (ddd < 11 || ddd > 99) return null;

  // celular de 11 dígitos precisa começar com 9; fixo de 10 começa com 2-5
  const first = national[2];
  if (national.length === 11 && first !== "9") return null;
  if (national.length === 10 && !"2345".includes(first ?? "")) return null;

  return `+55${national}`;
}

/** Exibição amigável: +5511988621152 → (11) 98862-1152 */
export function formatPhoneBR(e164: string): string {
  const m = e164.match(/^\+55(\d{2})(\d{4,5})(\d{4})$/);
  if (!m) return e164;
  return `(${m[1]}) ${m[2]}-${m[3]}`;
}
