-- ═══════════════════════════════════════════════════════════════════
-- 0032 — Gastos com API por clínica (IA + WhatsApp Meta)
--        ai_usage.cost_brl: custo estimado em reais da chamada (tokens × preço
--        do modelo × câmbio) gravado no momento do uso.
--        whatsapp_usage: um registro por modelo (template) enviado pela API
--        oficial da Meta, com a categoria e o custo em reais.
--        O limite mensal e o "permitir excedente" ficam em clinics.settings.spend.
-- ═══════════════════════════════════════════════════════════════════
ALTER TABLE ai_usage
  ADD COLUMN IF NOT EXISTS cost_brl numeric(12,6) NOT NULL DEFAULT 0;

-- Estimativa retroativa dos registros antigos (preços de referência 2026, US$ 5,40)
UPDATE ai_usage SET cost_brl = round((
  CASE
    WHEN model LIKE 'gpt-5-nano%'   THEN input_tokens * 0.05  + output_tokens * 0.4
    WHEN model LIKE 'gpt-5-mini%'   THEN input_tokens * 0.25  + output_tokens * 2
    WHEN model LIKE 'gpt-5%'        THEN input_tokens * 1.25  + output_tokens * 10
    WHEN model LIKE 'gpt-4.1-nano%' THEN input_tokens * 0.1   + output_tokens * 0.4
    WHEN model LIKE 'gpt-4.1-mini%' THEN input_tokens * 0.4   + output_tokens * 1.6
    WHEN model LIKE 'gpt-4.1%'      THEN input_tokens * 2     + output_tokens * 8
    WHEN model LIKE 'gpt-4o-mini%'  THEN input_tokens * 0.15  + output_tokens * 0.6
    WHEN model LIKE 'gpt-4o%'       THEN input_tokens * 2.5   + output_tokens * 10
    WHEN model LIKE 'claude%haiku%' THEN input_tokens * 1     + output_tokens * 5
    WHEN model LIKE 'claude%opus%'  THEN input_tokens * 15    + output_tokens * 75
    WHEN model LIKE 'claude%'       THEN input_tokens * 3     + output_tokens * 15
    ELSE                                 input_tokens * 2.5   + output_tokens * 10
  END) / 1000000.0 * 5.4, 6)
WHERE cost_brl = 0;

CREATE TABLE IF NOT EXISTS whatsapp_usage (
  id bigserial PRIMARY KEY,
  clinic_id uuid NOT NULL REFERENCES clinics(id),
  instance_id uuid REFERENCES whatsapp_instances(id) ON DELETE SET NULL,
  message_id uuid,
  category text NOT NULL,                -- utility | marketing | authentication
  template_name text,
  cost_brl numeric(12,6) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS whatsapp_usage_clinic_month_idx ON whatsapp_usage (clinic_id, created_at);

ALTER TABLE whatsapp_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_usage FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON whatsapp_usage;
CREATE POLICY tenant_isolation ON whatsapp_usage USING (clinic_id = app_clinic_id());

GRANT SELECT, INSERT ON whatsapp_usage TO clinicaos_app;
GRANT USAGE, SELECT ON SEQUENCE whatsapp_usage_id_seq TO clinicaos_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON whatsapp_usage TO clinicaos_worker;
GRANT USAGE, SELECT ON SEQUENCE whatsapp_usage_id_seq TO clinicaos_worker;
GRANT UPDATE ON ai_usage TO clinicaos_worker;
