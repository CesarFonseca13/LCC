/**
 * TimeProvider — relógio injetável.
 *
 * Regra do projeto: código de domínio/automação NUNCA chama Date.now() direto.
 * Em produção usa SystemTimeProvider; em dev/teste o FakeTimeProvider permite
 * congelar e avançar o tempo para disparar cadências (24h/2h/45min, D+3, D+13...)
 * em segundos, sem esperar dias reais.
 */
export interface TimeProvider {
  now(): Date;
}

export class SystemTimeProvider implements TimeProvider {
  now(): Date {
    return new Date();
  }
}

export class FakeTimeProvider implements TimeProvider {
  private current: Date;

  constructor(start: Date = new Date()) {
    this.current = new Date(start);
  }

  now(): Date {
    return new Date(this.current);
  }

  set(date: Date): void {
    this.current = new Date(date);
  }

  /** Avança o relógio. Ex.: advance({ hours: 24 }) dispara a cadência de 24h. */
  advance(delta: { days?: number; hours?: number; minutes?: number; seconds?: number }): Date {
    const ms =
      (delta.days ?? 0) * 86_400_000 +
      (delta.hours ?? 0) * 3_600_000 +
      (delta.minutes ?? 0) * 60_000 +
      (delta.seconds ?? 0) * 1_000;
    this.current = new Date(this.current.getTime() + ms);
    return this.now();
  }
}
