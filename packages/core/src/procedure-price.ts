/**
 * Como o preço de um serviço aparece para a cliente (atendente, página de
 * agendamento) e para a equipe. Fonte única para não haver "R$ 0,00" solto.
 *  - fixed:      "a partir de R$ 180,00"
 *  - on_request: valor sob avaliação (varia por caso, definido na avaliação)
 *  - free:       gratuito (preço 0 cadastrado de propósito)
 */
export type PriceMode = "fixed" | "on_request" | "free";

export interface PricedProcedure {
  price: string | number;
  priceOnRequest: boolean;
}

export function priceMode(p: PricedProcedure): PriceMode {
  if (p.priceOnRequest) return "on_request";
  return Number(p.price) > 0 ? "fixed" : "free";
}

/** "180,00" (sem o "R$"). */
export function formatPriceNumber(price: string | number): string {
  return Number(price).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Texto curto para a cliente: "a partir de R$ 180,00" | "valor definido na avaliação" | "gratuito".
 *  Com o nome, a própria avaliação/consulta sob avaliação vira "valor informado pela clínica"
 *  (o valor dela não "é definido na avaliação"). */
export function customerPriceLabel(p: PricedProcedure & { name?: string }): string {
  switch (priceMode(p)) {
    case "fixed":
      return `a partir de R$ ${formatPriceNumber(p.price)}`;
    case "on_request":
      return p.name && /avalia|consulta/i.test(p.name) ? "valor informado pela clínica" : "valor definido na avaliação";
    case "free":
      return "gratuito";
  }
}

/** Texto para a equipe (lista de Serviços): "R$ 180,00" | "Sob avaliação" | "Gratuito". */
export function staffPriceLabel(p: PricedProcedure): string {
  switch (priceMode(p)) {
    case "fixed":
      return `R$ ${formatPriceNumber(p.price)}`;
    case "on_request":
      return "Sob avaliação";
    case "free":
      return "Gratuito";
  }
}

/** Preço sugerido em formulários internos (orçamento, termo): vazio quando não há valor fixo. */
export function suggestedPriceInput(p: PricedProcedure): string {
  return p.priceOnRequest ? "" : Number(p.price).toFixed(2).replace(".", ",");
}
