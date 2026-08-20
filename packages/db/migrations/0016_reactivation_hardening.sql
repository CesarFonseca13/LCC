-- ═══════════════════════════════════════════════════════════════════
-- 0016 — Blindagem da reativação: no máximo UMA cadência viva por
--        cliente (sweeps concorrentes não conseguem duplicar).
-- ═══════════════════════════════════════════════════════════════════

CREATE UNIQUE INDEX automation_runs_reactivation_live_uq
  ON automation_runs (customer_id)
  WHERE automation_id IN ('reactivation_smart', 'reactivation_generic')
    AND status IN ('active', 'processing', 'paused');
