-- ═══════════════════════════════════════════════════════════════════
-- 0020 — Funil de vendas: kanban de negociações + lead automático
--        (conversa nova de número desconhecido vira card sozinha).
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE pipeline_stages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id),
  name text NOT NULL,
  sort int NOT NULL DEFAULT 0,
  UNIQUE (clinic_id, name)
);

CREATE TABLE deals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id),
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  -- NULL = primeira coluna ("Novo contato"); vira linha real ao mover
  stage_id uuid REFERENCES pipeline_stages(id),
  value numeric(12,2),
  source text,                          -- 'whatsapp' | 'manual'
  notes text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'won', 'lost')),
  lost_reason text,
  won_at timestamptz,
  lost_at timestamptz,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz
);
CREATE INDEX deals_clinic_status_idx ON deals (clinic_id, status, created_at);
-- Uma negociação aberta por cliente — nunca empilha cards duplicados
CREATE UNIQUE INDEX deals_customer_open_uq ON deals (customer_id) WHERE status = 'open';

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['pipeline_stages', 'deals']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (clinic_id = app_clinic_id())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO clinicaos_app', t);
  END LOOP;
END $$;
