-- ═══════════════════════════════════════════════════════════════════
-- 0010 — Orçamentos: numeração por clínica, itens, link público,
--        aceite e conversão em venda (financeiro + pacotes)
-- ═══════════════════════════════════════════════════════════════════

-- Sequências por clínica (nº do orçamento) sem corrida: UPDATE ... RETURNING
CREATE TABLE clinic_counters (
  clinic_id uuid NOT NULL REFERENCES clinics(id),
  key text NOT NULL,
  value int NOT NULL DEFAULT 0,
  PRIMARY KEY (clinic_id, key)
);

CREATE TABLE quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id),
  customer_id uuid NOT NULL REFERENCES customers(id),
  number int NOT NULL,
  status text NOT NULL DEFAULT 'sent'
    CHECK (status IN ('sent','viewed','accepted','rejected','expired')),
  valid_until date NOT NULL,
  subtotal numeric(12,2) NOT NULL,
  discount_amount numeric(12,2) NOT NULL DEFAULT 0,
  total numeric(12,2) NOT NULL,
  notes text,
  public_token text NOT NULL UNIQUE,
  sent_at timestamptz NOT NULL DEFAULT now(),
  viewed_at timestamptz,
  accepted_at timestamptz,
  converted_at timestamptz,             -- virou venda (receivable/pacotes gerados)
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz,
  UNIQUE (clinic_id, number)
);
CREATE INDEX quotes_clinic_status_idx ON quotes (clinic_id, status, created_at DESC);
CREATE TRIGGER quotes_updated_at BEFORE UPDATE ON quotes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE quote_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id),
  quote_id uuid NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('procedure','package')),
  procedure_id uuid REFERENCES procedures(id),
  package_id uuid REFERENCES packages(id),
  description text NOT NULL,
  quantity int NOT NULL DEFAULT 1 CHECK (quantity BETWEEN 1 AND 50),
  unit_price numeric(12,2) NOT NULL,
  total numeric(12,2) NOT NULL
);
CREATE INDEX quote_items_quote_idx ON quote_items (quote_id);

-- RLS
ALTER TABLE clinic_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE clinic_counters FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON clinic_counters USING (clinic_id = app_clinic_id());

ALTER TABLE quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE quotes FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON quotes USING (clinic_id = app_clinic_id());
-- Página pública do orçamento: resolve pelo token da URL
CREATE POLICY quote_resolve ON quotes
  USING (public_token = NULLIF(current_setting('app.quote_token', true), ''));

ALTER TABLE quote_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE quote_items FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON quote_items USING (clinic_id = app_clinic_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON clinic_counters, quotes, quote_items TO clinicaos_app;
