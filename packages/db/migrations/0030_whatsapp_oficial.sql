-- ═══════════════════════════════════════════════════════════════════
-- 0030 — WhatsApp pela API oficial da Meta (Cloud API)
--        Cada número escolhe o provedor: 'evolution' (QR code, como o
--        WhatsApp Web — risco de bloqueio) ou 'meta' (API oficial — sem
--        risco de banimento, mensagens fora da janela de 24h só como
--        template aprovado pela Meta). Credenciais cifradas com
--        SENSITIVE_DATA_KEY. O webhook da Meta é único por app e resolve
--        o número pelo phone_number_id (política meta_webhook_resolve).
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE whatsapp_instances
  ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'evolution',
  ADD COLUMN IF NOT EXISTS meta_phone_number_id text,
  ADD COLUMN IF NOT EXISTS meta_waba_id text,
  ADD COLUMN IF NOT EXISTS meta_access_token_enc text,
  ADD COLUMN IF NOT EXISTS meta_app_secret_enc text,
  ADD COLUMN IF NOT EXISTS meta_token_hint text,
  ADD COLUMN IF NOT EXISTS meta_verified_name text;

ALTER TABLE whatsapp_instances DROP CONSTRAINT IF EXISTS whatsapp_instances_provider_chk;
ALTER TABLE whatsapp_instances
  ADD CONSTRAINT whatsapp_instances_provider_chk CHECK (provider IN ('evolution', 'meta'));

CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_instances_meta_phone_uq
  ON whatsapp_instances (meta_phone_number_id) WHERE meta_phone_number_id IS NOT NULL;

DROP POLICY IF EXISTS meta_webhook_resolve ON whatsapp_instances;
CREATE POLICY meta_webhook_resolve ON whatsapp_instances
  USING (meta_phone_number_id IS NOT NULL
         AND meta_phone_number_id = NULLIF(current_setting('app.meta_phone_number_id', true), ''));

-- Valores que renderizaram o texto (nome, data, hora...) — na API oficial,
-- fora da janela de 24h, viram parâmetros do template aprovado
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS template_vars jsonb,
  ADD COLUMN IF NOT EXISTS sent_as_template text;

-- Templates registrados na Meta por número (um por finalidade)
CREATE TABLE IF NOT EXISTS whatsapp_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id),
  instance_id uuid NOT NULL REFERENCES whatsapp_instances(id) ON DELETE CASCADE,
  purpose text NOT NULL,                 -- reminder_24h, consent_term, reactivation...
  meta_name text NOT NULL,               -- nome do template na Meta (vx_lembrete_24h_v1)
  language text NOT NULL DEFAULT 'pt_BR',
  category text NOT NULL,                -- UTILITY | MARKETING
  body_text text NOT NULL,               -- texto submetido, com {{1}}..{{n}}
  param_names text[] NOT NULL,           -- ordem dos parâmetros do corpo
  button_url_param text,                 -- variável que preenche o sufixo do botão de link
  status text NOT NULL DEFAULT 'pending', -- pending | approved | rejected | paused | disabled | error
  meta_template_id text,
  reject_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz,
  UNIQUE (instance_id, purpose)
);
CREATE INDEX IF NOT EXISTS whatsapp_templates_clinic_idx ON whatsapp_templates (clinic_id);

ALTER TABLE whatsapp_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_templates FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON whatsapp_templates;
CREATE POLICY tenant_isolation ON whatsapp_templates USING (clinic_id = app_clinic_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON whatsapp_templates TO clinicaos_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON whatsapp_templates TO clinicaos_worker;
