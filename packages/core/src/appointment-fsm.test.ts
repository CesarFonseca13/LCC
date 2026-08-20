import { describe, expect, it } from "vitest";
import {
  assertTransition,
  canTransition,
  effectsOf,
  InvalidTransitionError,
} from "./appointment-fsm";

describe("appointment FSM", () => {
  it("permite o fluxo feliz agendado → confirmado → compareceu", () => {
    expect(canTransition("scheduled", "confirmed")).toBe(true);
    expect(canTransition("confirmed", "showed")).toBe(true);
  });

  it("permite compareceu sem confirmação prévia (confirmação implícita)", () => {
    expect(canTransition("scheduled", "showed")).toBe(true);
  });

  it("bloqueia reabrir estados terminais", () => {
    expect(canTransition("cancelled", "scheduled")).toBe(false);
    expect(canTransition("rescheduled", "confirmed")).toBe(false);
    expect(() => assertTransition("cancelled", "showed")).toThrow(InvalidTransitionError);
  });

  it("permite corrigir engano operacional showed ↔ no_show", () => {
    expect(canTransition("showed", "no_show")).toBe(true);
    expect(canTransition("no_show", "showed")).toBe(true);
  });

  it("compareceu dispara os efeitos financeiros e de pós-atendimento", () => {
    const effects = effectsOf("confirmed", "showed");
    expect(effects).toContain("accrue_commission");
    expect(effects).toContain("create_receivable");
    expect(effects).toContain("consume_stock");
    expect(effects).toContain("start_post_visit_flow");
    expect(effects).toContain("offer_touchup");
  });

  it("falta dispara recuperação de no-show", () => {
    expect(effectsOf("scheduled", "no_show")).toContain("start_no_show_recovery");
  });
});
