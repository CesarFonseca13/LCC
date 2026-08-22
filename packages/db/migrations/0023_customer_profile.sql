-- ═══════════════════════════════════════════════════════════════════
-- 0023 — Ficha rica da cliente: RG, sexo, convênio e plano
--        (idade é derivada de birth_date — nunca guardada)
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE customers ADD COLUMN IF NOT EXISTS rg text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS sex text
  CHECK (sex IN ('feminino', 'masculino', 'outro'));
ALTER TABLE customers ADD COLUMN IF NOT EXISTS insurance_name text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS insurance_plan text;
