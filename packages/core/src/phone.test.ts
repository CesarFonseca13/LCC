import { describe, expect, it } from "vitest";
import { formatPhoneBR, normalizePhoneBR } from "./phone";

describe("normalizePhoneBR", () => {
  it("normaliza formatos comuns para E.164", () => {
    expect(normalizePhoneBR("(11) 98862-1152")).toBe("+5511988621152");
    expect(normalizePhoneBR("11 98862 1152")).toBe("+5511988621152");
    expect(normalizePhoneBR("11988621152")).toBe("+5511988621152");
    expect(normalizePhoneBR("5511988621152")).toBe("+5511988621152");
    expect(normalizePhoneBR("+55 11 98862-1152")).toBe("+5511988621152");
    expect(normalizePhoneBR("0055 11 98862-1152")).toBe("+5511988621152");
    expect(normalizePhoneBR("011 98862-1152")).toBe("+5511988621152");
  });

  it("aceita fixo de 10 dígitos", () => {
    expect(normalizePhoneBR("(11) 3256-7890")).toBe("+551132567890");
  });

  it("rejeita entradas inválidas", () => {
    expect(normalizePhoneBR("")).toBeNull();
    expect(normalizePhoneBR("123")).toBeNull();
    expect(normalizePhoneBR("(01) 98862-1152")).toBeNull(); // DDD inválido
    expect(normalizePhoneBR("11 88862-1152 9")).toBeNull(); // 11 dígitos sem 9 inicial
    expect(normalizePhoneBR("abc")).toBeNull();
  });

  it("formata para exibição", () => {
    expect(formatPhoneBR("+5511988621152")).toBe("(11) 98862-1152");
    expect(formatPhoneBR("+551132567890")).toBe("(11) 3256-7890");
  });
});
