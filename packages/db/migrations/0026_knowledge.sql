-- ═══════════════════════════════════════════════════════════════════
-- 0026 — Base de conhecimento da clínica
--        Cards curtos e curados que a assistente consulta para responder
--        perguntas factuais (estacionamento, convênios, cuidados pré/pós...).
--        A ficha estruturada (endereço, pagamento etc.) vive em
--        clinics.settings.knowledge e entra inteira no prompt.
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS kb_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id),
  kind text NOT NULL DEFAULT 'faq' CHECK (kind IN ('faq', 'servico', 'politica', 'outro')),
  title text NOT NULL,
  content text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz,
  -- Busca em português direto no Postgres — sem serviço externo de embeddings
  search tsvector GENERATED ALWAYS AS (
    to_tsvector('portuguese', coalesce(title, '') || ' ' || coalesce(content, ''))
  ) STORED
);

CREATE INDEX IF NOT EXISTS kb_entries_search_idx ON kb_entries USING GIN (search);
CREATE INDEX IF NOT EXISTS kb_entries_clinic_idx ON kb_entries (clinic_id, active);

ALTER TABLE kb_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE kb_entries FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON kb_entries;
CREATE POLICY tenant_isolation ON kb_entries USING (clinic_id = app_clinic_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON kb_entries TO clinicaos_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON kb_entries TO clinicaos_worker;
