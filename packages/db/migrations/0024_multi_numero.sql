-- ═══════════════════════════════════════════════════════════════════
-- 0024 — Multi-número de WhatsApp por clínica
--        Ritmo de campanha passa a ser POR NÚMERO (next_campaign_send_at);
--        exatamente um número principal por clínica.
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE whatsapp_instances ADD COLUMN IF NOT EXISTS next_campaign_send_at timestamptz;
ALTER TABLE whatsapp_instances ALTER COLUMN is_primary SET DEFAULT false;

-- Só o número mais antigo de cada clínica fica como principal
UPDATE whatsapp_instances w SET is_primary = false
WHERE w.id <> (
  SELECT id FROM whatsapp_instances w3
  WHERE w3.clinic_id = w.clinic_id ORDER BY created_at LIMIT 1
);
UPDATE whatsapp_instances w SET is_primary = true
WHERE w.id = (
  SELECT id FROM whatsapp_instances w3
  WHERE w3.clinic_id = w.clinic_id ORDER BY created_at LIMIT 1
);

CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_instances_primary_uq
  ON whatsapp_instances (clinic_id) WHERE is_primary;
