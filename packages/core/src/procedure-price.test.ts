import { describe, expect, it } from "vitest";
import { customerPriceLabel, priceMode, staffPriceLabel, suggestedPriceInput } from "./procedure-price";

describe("preço do serviço", () => {
  it("modo: sob avaliação vence o valor; 0 sem marca é gratuito", () => {
    expect(priceMode({ price: "180.00", priceOnRequest: false })).toBe("fixed");
    expect(priceMode({ price: "0", priceOnRequest: true })).toBe("on_request");
    expect(priceMode({ price: "350.00", priceOnRequest: true })).toBe("on_request");
    expect(priceMode({ price: "0.00", priceOnRequest: false })).toBe("free");
  });
  it("textos para a cliente nunca mostram R$ 0,00", () => {
    expect(customerPriceLabel({ price: "1200.00", priceOnRequest: false })).toBe("a partir de R$ 1.200,00");
    expect(customerPriceLabel({ price: "0", priceOnRequest: true })).toBe("valor definido na avaliação");
    expect(customerPriceLabel({ price: 0, priceOnRequest: false })).toBe("gratuito");
    expect(customerPriceLabel({ name: "Consulta médica", price: "0", priceOnRequest: true })).toBe("valor informado pela clínica");
    expect(customerPriceLabel({ name: "Botox", price: "0", priceOnRequest: true })).toBe("valor definido na avaliação");
  });
  it("textos para a equipe e valor sugerido nos formulários", () => {
    expect(staffPriceLabel({ price: "180.5", priceOnRequest: false })).toBe("R$ 180,50");
    expect(staffPriceLabel({ price: "0", priceOnRequest: true })).toBe("Sob avaliação");
    expect(staffPriceLabel({ price: "0", priceOnRequest: false })).toBe("Gratuito");
    expect(suggestedPriceInput({ price: "180.00", priceOnRequest: false })).toBe("180,00");
    expect(suggestedPriceInput({ price: "0", priceOnRequest: true })).toBe("");
    expect(suggestedPriceInput({ price: "0", priceOnRequest: false })).toBe("0,00");
  });
});
