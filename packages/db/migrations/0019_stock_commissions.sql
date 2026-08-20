-- ═══════════════════════════════════════════════════════════════════
-- 0019 — Estoque (movimentos como fonte da verdade + consumo por
--        procedimento) e Comissões (regras, apuração no Compareceu,
--        pagamento vira despesa).
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE stock_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id),
  name text NOT NULL,
  unit text NOT NULL DEFAULT 'un',            -- un | ml | g | caixa...
  min_quantity numeric(12,2) NOT NULL DEFAULT 0,
  cost numeric(12,2),                          -- custo unitário de reposição (CMV)
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz,
  UNIQUE (clinic_id, name)
);

-- Saldo = SUM(quantity); positivo entra, negativo sai. Nunca se edita saldo.
CREATE TABLE stock_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id),
  stock_item_id uuid NOT NULL REFERENCES stock_items(id),
  kind text NOT NULL CHECK (kind IN ('purchase', 'sale', 'procedure_use', 'adjustment', 'loss')),
  quantity numeric(12,2) NOT NULL,
  unit_cost numeric(12,2),
  appointment_id uuid REFERENCES appointments(id),
  notes text,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX stock_movements_item_idx ON stock_movements (clinic_id, stock_item_id, created_at);
CREATE INDEX stock_movements_appt_idx ON stock_movements (appointment_id) WHERE appointment_id IS NOT NULL;
-- Consumo por atendimento não duplica (Compareceu idempotente)
CREATE UNIQUE INDEX stock_movements_appt_item_uq ON stock_movements (appointment_id, stock_item_id)
  WHERE kind = 'procedure_use';

CREATE TABLE procedure_supplies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id),
  procedure_id uuid NOT NULL REFERENCES procedures(id) ON DELETE CASCADE,
  stock_item_id uuid NOT NULL REFERENCES stock_items(id) ON DELETE CASCADE,
  quantity_per_session numeric(12,2) NOT NULL,
  UNIQUE (procedure_id, stock_item_id)
);

CREATE TABLE commission_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id),
  professional_id uuid NOT NULL REFERENCES professionals(id) ON DELETE CASCADE,
  procedure_id uuid REFERENCES procedures(id) ON DELETE CASCADE, -- NULL = todos
  kind text NOT NULL DEFAULT 'pct' CHECK (kind IN ('pct', 'fixed')),
  value numeric(12,2) NOT NULL,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX commission_rules_uq
  ON commission_rules (clinic_id, professional_id, COALESCE(procedure_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- Nasce no Compareceu (regime "atendimentos realizados"); pagamento vira despesa
CREATE TABLE commission_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id),
  professional_id uuid NOT NULL REFERENCES professionals(id),
  appointment_id uuid NOT NULL UNIQUE REFERENCES appointments(id),
  customer_id uuid REFERENCES customers(id),
  procedure_id uuid REFERENCES procedures(id),
  base_amount numeric(12,2) NOT NULL,
  commission_amount numeric(12,2) NOT NULL,
  rule_source text NOT NULL,                   -- 'regra específica' | 'regra geral' | 'padrão do procedimento'
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid')),
  payment_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX commission_entries_clinic_prof_idx ON commission_entries (clinic_id, professional_id, created_at);

CREATE TABLE commission_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id),
  professional_id uuid NOT NULL REFERENCES professionals(id),
  total_amount numeric(12,2) NOT NULL,
  entry_count int NOT NULL,
  payable_id uuid REFERENCES payables(id),
  paid_at date NOT NULL DEFAULT current_date,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['stock_items','stock_movements','procedure_supplies',
                           'commission_rules','commission_entries','commission_payments']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (clinic_id = app_clinic_id())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO clinicaos_app', t);
  END LOOP;
END $$;
