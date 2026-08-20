-- ═══════════════════════════════════════════════════════════════════
-- 0018 — Blindagem do crescimento: no máximo UMA oferta/convite vivo
--        por cliente e automação (varreduras concorrentes não duplicam).
-- ═══════════════════════════════════════════════════════════════════

CREATE UNIQUE INDEX automation_runs_growth_live_uq
  ON automation_runs (customer_id, automation_id)
  WHERE automation_id IN ('smart_fill', 'package_renewal_sessions', 'package_renewal_expiry')
    AND status IN ('active', 'processing');
