-- ═══════════════════════════════════════════════════════════════════
-- 0009 — Termos de consentimento: modelos, documentos, assinatura
--        nativa (MP 2.200-2/2001) e trilha de auditoria completa
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE document_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id),
  name text NOT NULL,
  kind text NOT NULL DEFAULT 'consent' CHECK (kind IN ('consent','contract','other')),
  body_text text NOT NULL,               -- texto simples com {{variáveis}} (parágrafos por linha em branco)
  variables text[] NOT NULL DEFAULT '{}',
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz
);
CREATE INDEX document_templates_clinic_idx ON document_templates (clinic_id, active);
CREATE TRIGGER document_templates_updated_at BEFORE UPDATE ON document_templates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id),
  customer_id uuid NOT NULL REFERENCES customers(id),
  template_id uuid REFERENCES document_templates(id),
  procedure_id uuid REFERENCES procedures(id),
  appointment_id uuid REFERENCES appointments(id),
  title text NOT NULL,
  body_html_rendered text NOT NULL,      -- HTML final CONGELADO no envio
  variables_snapshot jsonb NOT NULL DEFAULT '{}',
  content_sha256 text NOT NULL,          -- hash do conteúdo exato apresentado
  pdf_path text,
  pdf_sha256 text,
  status text NOT NULL DEFAULT 'sent'
    CHECK (status IN ('sent','viewed','signed','declined','expired')),
  sign_token text NOT NULL UNIQUE,       -- /assinar/[token] — 32 bytes aleatórios
  token_expires_at timestamptz NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  viewed_at timestamptz,
  signed_at timestamptz,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz
);
CREATE INDEX documents_clinic_status_idx ON documents (clinic_id, status, created_at DESC);
CREATE INDEX documents_customer_idx ON documents (clinic_id, customer_id);
-- Sweep de geração de PDF (worker, cross-tenant)
CREATE INDEX documents_pdf_pending_idx ON documents (signed_at)
  WHERE status = 'signed' AND pdf_path IS NULL;
CREATE TRIGGER documents_updated_at BEFORE UPDATE ON documents
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE document_signatures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id),
  document_id uuid NOT NULL UNIQUE REFERENCES documents(id) ON DELETE CASCADE,
  signer_name text NOT NULL,
  signer_cpf text,
  signature_kind text NOT NULL CHECK (signature_kind IN ('drawn','typed')),
  signature_image text,                  -- data URL do canvas (quando desenhada)
  signed_at timestamptz NOT NULL DEFAULT now(),
  ip inet NOT NULL,
  user_agent text NOT NULL,
  content_sha256 text NOT NULL,          -- deve bater com documents.content_sha256
  evidence jsonb NOT NULL DEFAULT '{}'   -- viewport, timezone do aparelho, etc.
);

CREATE TABLE document_audit_log (
  id bigserial PRIMARY KEY,
  clinic_id uuid NOT NULL REFERENCES clinics(id),
  document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  event text NOT NULL CHECK (event IN
    ('created','sent','link_opened','signed','declined','pdf_generated','resent','expired')),
  ip inet,
  user_agent text,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX document_audit_doc_idx ON document_audit_log (document_id, created_at);

-- RLS
ALTER TABLE document_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_templates FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON document_templates USING (clinic_id = app_clinic_id());

ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON documents USING (clinic_id = app_clinic_id());
-- Página pública de assinatura: resolve o documento pelo token da URL
CREATE POLICY sign_resolve ON documents
  USING (sign_token = NULLIF(current_setting('app.sign_token', true), ''));

ALTER TABLE document_signatures ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_signatures FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON document_signatures USING (clinic_id = app_clinic_id());

ALTER TABLE document_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_audit_log FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON document_audit_log USING (clinic_id = app_clinic_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON
  document_templates, documents, document_signatures, document_audit_log
TO clinicaos_app;
GRANT USAGE, SELECT ON SEQUENCE document_audit_log_id_seq TO clinicaos_app;
