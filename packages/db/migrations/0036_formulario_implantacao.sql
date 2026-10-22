-- ═══════════════════════════════════════════════════════════════════
-- 0036 — Formulário de implantação (página pública /form)
--        A clínica nova responde o questionário antes de existir no sistema;
--        a resposta fica aqui, global e sem RLS, e aparece no /admin com PDF.
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS onboarding_forms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_name text NOT NULL,
  contact_name text,
  contact_email text,
  contact_phone text,
  answers jsonb NOT NULL,
  form_version int NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'done')),
  ip text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  handled_at timestamptz,
  handled_by uuid REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS onboarding_forms_created_idx ON onboarding_forms (status, created_at DESC);

-- A página pública (papel do app) só insere; o /admin (papel do worker) lê, marca e apaga.
-- Os privilégios padrão da 0001 dão SELECT/INSERT/UPDATE/DELETE ao app em toda tabela
-- nova, então aqui é preciso REVOGAR o que a página pública não deve ter.
REVOKE SELECT, UPDATE, DELETE ON onboarding_forms FROM clinicaos_app;
GRANT INSERT ON onboarding_forms TO clinicaos_app;
GRANT SELECT (id) ON onboarding_forms TO clinicaos_app; -- RETURNING id no envio
GRANT SELECT, UPDATE, DELETE ON onboarding_forms TO clinicaos_worker;
