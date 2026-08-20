-- ═══════════════════════════════════════════════════════════════════
-- 0003 — Clientes: cadastro, telefones, tags, histórico pré-sistema,
--        anamnese versionada (respostas cifradas em nível de aplicação)
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id),
  full_name text NOT NULL,
  social_name text,
  cpf text,
  birth_date date,
  phone_e164 text NOT NULL,            -- chave de match com o WhatsApp: +5511999999999
  email citext,
  instagram text,
  occupation text,
  address_street text,
  address_number text,
  address_complement text,
  address_district text,
  address_city text,
  address_state char(2),
  address_zip text,
  source text,                         -- 'indicacao','instagram','google','walk-in','import',...
  status text NOT NULL DEFAULT 'lead'
    CHECK (status IN ('lead','active','at_risk','inactive')),
  automations_blocked boolean NOT NULL DEFAULT false,
  opted_out_at timestamptz,
  photo_consent boolean NOT NULL DEFAULT false,
  lgpd_consent_at timestamptz,
  lgpd_consent_source text,
  whatsapp_valid boolean,              -- NULL = ainda não verificado (onWhatsApp)
  notes text,
  deleted_at timestamptz,              -- soft delete (LGPD/mesclagem)
  merged_into_id uuid REFERENCES customers(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz
);
CREATE UNIQUE INDEX customers_clinic_phone_uq ON customers (clinic_id, phone_e164)
  WHERE deleted_at IS NULL;
CREATE INDEX customers_clinic_status_idx ON customers (clinic_id, status)
  WHERE deleted_at IS NULL;
CREATE INDEX customers_name_trgm_idx ON customers USING gin (full_name gin_trgm_ops);
CREATE INDEX customers_clinic_birth_idx ON customers (clinic_id, birth_date);
CREATE TRIGGER customers_updated_at BEFORE UPDATE ON customers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE customer_phones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id),
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  phone_e164 text NOT NULL,
  label text,                          -- 'marido','trabalho',...
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (customer_id, phone_e164)
);
CREATE INDEX customer_phones_clinic_phone_idx ON customer_phones (clinic_id, phone_e164);

CREATE TABLE tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id),
  name text NOT NULL,
  color text NOT NULL DEFAULT '#78716c',
  UNIQUE (clinic_id, name)
);

CREATE TABLE customer_tags (
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  tag_id uuid NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  clinic_id uuid NOT NULL REFERENCES clinics(id),
  PRIMARY KEY (customer_id, tag_id)
);

-- Atendimentos anteriores ao sistema ("Inserir Histórico"): alimentam score e
-- reativação SEM disparar efeitos (comissão, estoque, automações).
CREATE TABLE customer_history_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id),
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  occurred_on date NOT NULL,
  procedure_id uuid REFERENCES procedures(id),
  procedure_name text,                 -- texto livre quando não há cadastro
  amount numeric(12,2),
  notes text,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX customer_history_clinic_customer_idx
  ON customer_history_entries (clinic_id, customer_id, occurred_on DESC);

-- ── Anamnese versionada ──────────────────────────────────────────────
CREATE TABLE anamnesis_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id),
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE anamnesis_template_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id),
  template_id uuid NOT NULL REFERENCES anamnesis_templates(id) ON DELETE CASCADE,
  version int NOT NULL,
  schema jsonb NOT NULL,               -- [{section, fields:[{key,label,type,risk?}]}]
  published_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (template_id, version)
);

CREATE TABLE anamnesis_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id),
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  template_version_id uuid NOT NULL REFERENCES anamnesis_template_versions(id),
  answers_encrypted text NOT NULL,     -- AES-256-GCM (dados de saúde — LGPD art. 11)
  risk_summary text,                   -- rótulos de risco em claro p/ alerta da ficha
  filled_by_user_id uuid REFERENCES users(id),   -- NULL = preenchida pela cliente
  filled_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX anamnesis_responses_customer_idx
  ON anamnesis_responses (clinic_id, customer_id, filled_at DESC);

-- ── RLS ──────────────────────────────────────────────────────────────
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON customers USING (clinic_id = app_clinic_id());

ALTER TABLE customer_phones ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_phones FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON customer_phones USING (clinic_id = app_clinic_id());

ALTER TABLE tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE tags FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tags USING (clinic_id = app_clinic_id());

ALTER TABLE customer_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_tags FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON customer_tags USING (clinic_id = app_clinic_id());

ALTER TABLE customer_history_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_history_entries FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON customer_history_entries USING (clinic_id = app_clinic_id());

ALTER TABLE anamnesis_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE anamnesis_templates FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON anamnesis_templates USING (clinic_id = app_clinic_id());

ALTER TABLE anamnesis_template_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE anamnesis_template_versions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON anamnesis_template_versions USING (clinic_id = app_clinic_id());

ALTER TABLE anamnesis_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE anamnesis_responses FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON anamnesis_responses USING (clinic_id = app_clinic_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON
  customers, customer_phones, tags, customer_tags, customer_history_entries,
  anamnesis_templates, anamnesis_template_versions, anamnesis_responses
TO clinicaos_app;
