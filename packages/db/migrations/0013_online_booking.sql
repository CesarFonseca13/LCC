-- ═══════════════════════════════════════════════════════════════════
-- 0013 — Agendamento online público: a página /agendar/[slug] resolve
--        a clínica pelo slug (só quando o recurso está ligado)
-- ═══════════════════════════════════════════════════════════════════

CREATE POLICY booking_resolve ON clinics
  USING (
    online_booking_enabled
    AND booking_slug = NULLIF(current_setting('app.booking_slug', true), '')
  );
