import { describe, expect, it } from "vitest";
import { FakeTimeProvider } from "./time";

describe("FakeTimeProvider", () => {
  it("congela e avança o tempo", () => {
    const t0 = new Date("2026-08-20T12:00:00Z");
    const clock = new FakeTimeProvider(t0);
    expect(clock.now().toISOString()).toBe("2026-08-20T12:00:00.000Z");

    clock.advance({ hours: 24 });
    expect(clock.now().toISOString()).toBe("2026-08-21T12:00:00.000Z");

    clock.advance({ days: 3, minutes: 45 });
    expect(clock.now().toISOString()).toBe("2026-08-24T12:45:00.000Z");
  });

  it("now() retorna cópia (imutável de fora)", () => {
    const clock = new FakeTimeProvider(new Date("2026-01-01T00:00:00Z"));
    clock.now().setFullYear(1999);
    expect(clock.now().getUTCFullYear()).toBe(2026);
  });
});
