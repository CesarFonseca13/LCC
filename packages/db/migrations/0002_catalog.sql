-- ═══════════════════════════════════════════════════════════════════
-- 0002 — Catálogo: procedimentos e pacotes (base da agenda e automações)
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE procedures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id),
  name text NOT NULL,
  category text,
  duration_minutes int NOT NULL DEFAULT 60 CHECK (duration_minutes BETWEEN 5 AND 600),
  price numeric(12,2) NOT NULL DEFAULT 0,
  cost numeric(12,2),
  return_days int CHECK (return_days > 0),         -- prazo de retorno → motor da reativação
  touchup_days int CHECK (touchup_days > 0),       -- dias até retoque → automação de retoque
  pre_care text,                                   -- pré-cuidados (enviados X horas antes)
  pre_care_hours_before int NOT NULL DEFAULT 24,
  post_care text,                                  -- pós-cuidados (enviados ao Compareceu)
  post_sale_cadence_days int[],                    -- cadência pós-venda: ex '{7,30,90}'
  commission_default_pct numeric(5,2) CHECK (commission_default_pct BETWEEN 0 AND 100),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz
);
CREATE INDEX procedures_clinic_active_idx ON procedures (clinic_id, active);
CREATE UNIQUE INDEX procedures_clinic_name_uq ON procedures (clinic_id, lower(name)) WHERE active;
CREATE TRIGGER procedures_updated_at BEFORE UPDATE ON procedures
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id),
  name text NOT NULL,
  price numeric(12,2) NOT NULL DEFAULT 0,
  validity_days int CHECK (validity_days > 0),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz
);
CREATE INDEX packages_clinic_active_idx ON packages (clinic_id, active);
CREATE TRIGGER packages_updated_at BEFORE UPDATE ON packages
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE package_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id),
  package_id uuid NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
  procedure_id uuid NOT NULL REFERENCES procedures(id),
  sessions int NOT NULL CHECK (sessions BETWEEN 1 AND 100),
  UNIQUE (package_id, procedure_id)
);
CREATE INDEX package_items_clinic_idx ON package_items (clinic_id);

-- RLS
ALTER TABLE procedures ENABLE ROW LEVEL SECURITY;
ALTER TABLE procedures FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON procedures USING (clinic_id = app_clinic_id());

ALTER TABLE packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE packages FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON packages USING (clinic_id = app_clinic_id());

ALTER TABLE package_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE package_items FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON package_items USING (clinic_id = app_clinic_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON procedures, packages, package_items TO clinicaos_app;
