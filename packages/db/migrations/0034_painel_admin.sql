-- ═══════════════════════════════════════════════════════════════════
-- 0034 — Painel de administração da plataforma
--        platform_audit_log: trilha do que o superadmin fez (criar clínica,
--        mudar plano, entrar numa clínica, apagar...). Global, sem RLS.
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS platform_audit_log (
  id bigserial PRIMARY KEY,
  admin_user_id uuid REFERENCES users(id),
  action text NOT NULL,
  clinic_id uuid,
  target text,
  details jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS platform_audit_log_created_idx ON platform_audit_log (created_at DESC);

GRANT SELECT, INSERT ON platform_audit_log TO clinicaos_app;
GRANT USAGE, SELECT ON SEQUENCE platform_audit_log_id_seq TO clinicaos_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON platform_audit_log TO clinicaos_worker;
GRANT USAGE, SELECT ON SEQUENCE platform_audit_log_id_seq TO clinicaos_worker;
