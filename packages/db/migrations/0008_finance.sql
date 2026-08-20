-- ═══════════════════════════════════════════════════════════════════
-- 0008 — Financeiro essencial + pacotes na operação
--        (Compareceu → conta a receber OU débito de sessão de pacote)
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE finance_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id),
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('income','expense')),
  color text NOT NULL DEFAULT '#78716c',
  UNIQUE (clinic_id, kind, name)
);

-- Instância comprada de um pacote ("5 de 12 sessões usadas")
CREATE TABLE customer_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id),
  customer_id uuid NOT NULL REFERENCES customers(id),
  package_id uuid NOT NULL REFERENCES packages(id),
  procedure_id uuid REFERENCES procedures(id),     -- procedimento coberto (MVP: 1 por pacote)
  sessions_total int NOT NULL CHECK (sessions_total > 0),
  sessions_used int NOT NULL DEFAULT 0 CHECK (sessions_used >= 0),
  price_paid numeric(12,2) NOT NULL,
  purchased_at date NOT NULL DEFAULT current_date,
  expires_at date,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','completed','expired','cancelled')),
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz
);
CREATE INDEX customer_packages_clinic_customer_idx ON customer_packages (clinic_id, customer_id);
CREATE INDEX customer_packages_clinic_status_idx ON customer_packages (clinic_id, status);
CREATE TRIGGER customer_packages_updated_at BEFORE UPDATE ON customer_packages
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Consumo de sessão: auditável e estornável (corrigir Compareceu→Faltou devolve a sessão)
CREATE TABLE package_session_uses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id),
  customer_package_id uuid NOT NULL REFERENCES customer_packages(id),
  appointment_id uuid NOT NULL REFERENCES appointments(id),
  used_at timestamptz NOT NULL DEFAULT now(),
  reverted_at timestamptz
);
CREATE INDEX package_session_uses_pkg_idx ON package_session_uses (customer_package_id);
-- No máximo 1 consumo vigente por atendimento
CREATE UNIQUE INDEX package_session_uses_active_uq ON package_session_uses (appointment_id)
  WHERE reverted_at IS NULL;

-- Agendamento pode consumir sessão de pacote
ALTER TABLE appointments
  ADD COLUMN customer_package_id uuid REFERENCES customer_packages(id);

-- Contas a receber (nascem sozinhas no Compareceu; pacote gera na atribuição)
CREATE TABLE receivables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id),
  customer_id uuid REFERENCES customers(id),
  appointment_id uuid REFERENCES appointments(id),
  customer_package_id uuid REFERENCES customer_packages(id),
  category_id uuid REFERENCES finance_categories(id),
  description text NOT NULL,
  gross_amount numeric(12,2) NOT NULL,
  fee_amount numeric(12,2) NOT NULL DEFAULT 0,
  net_amount numeric(12,2) NOT NULL,
  method text CHECK (method IN ('cash','pix','debit','credit','transfer','boleto')),
  installment_number int NOT NULL DEFAULT 1,
  installment_total int NOT NULL DEFAULT 1,
  due_date date NOT NULL,
  received_at date,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','received','cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz
);
CREATE INDEX receivables_clinic_status_due_idx ON receivables (clinic_id, status, due_date);
CREATE INDEX receivables_appt_idx ON receivables (appointment_id);
CREATE TRIGGER receivables_updated_at BEFORE UPDATE ON receivables
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Contas a pagar / despesas
CREATE TABLE payables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id),
  description text NOT NULL,
  supplier text,
  category_id uuid REFERENCES finance_categories(id),
  amount numeric(12,2) NOT NULL,
  due_date date NOT NULL,
  paid_at date,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','paid','cancelled')),
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz
);
CREATE INDEX payables_clinic_status_due_idx ON payables (clinic_id, status, due_date);
CREATE TRIGGER payables_updated_at BEFORE UPDATE ON payables
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- RLS
ALTER TABLE finance_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_categories FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON finance_categories USING (clinic_id = app_clinic_id());

ALTER TABLE customer_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_packages FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON customer_packages USING (clinic_id = app_clinic_id());

ALTER TABLE package_session_uses ENABLE ROW LEVEL SECURITY;
ALTER TABLE package_session_uses FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON package_session_uses USING (clinic_id = app_clinic_id());

ALTER TABLE receivables ENABLE ROW LEVEL SECURITY;
ALTER TABLE receivables FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON receivables USING (clinic_id = app_clinic_id());

ALTER TABLE payables ENABLE ROW LEVEL SECURITY;
ALTER TABLE payables FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON payables USING (clinic_id = app_clinic_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON
  finance_categories, customer_packages, package_session_uses, receivables, payables
TO clinicaos_app;
