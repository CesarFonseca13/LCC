-- ═══════════════════════════════════════════════════════════════════
-- 0029 — Aceite dos Termos de Uso
--        Global (sem clinic_id obrigatório, como auth_sessions): cada usuário
--        aceita cada versão dos Termos uma vez; guardamos quando e de onde
--        (evidência). O painel só abre depois do aceite da versão vigente.
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS terms_acceptances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  clinic_id uuid REFERENCES clinics(id),
  version text NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  ip inet,
  user_agent text,
  CONSTRAINT terms_acceptances_user_version_uq UNIQUE (user_id, version)
);
CREATE INDEX IF NOT EXISTS terms_acceptances_user_idx ON terms_acceptances (user_id);

GRANT SELECT, INSERT ON terms_acceptances TO clinicaos_app;
GRANT SELECT ON terms_acceptances TO clinicaos_worker;
