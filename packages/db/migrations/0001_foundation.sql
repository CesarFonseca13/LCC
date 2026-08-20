-- ═══════════════════════════════════════════════════════════════════
-- 0001 — Fundação: extensões, helpers, tenancy, equipe, plataforma, RLS
-- ═══════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS citext;

-- ── Helpers de contexto (lidos pelas políticas RLS) ─────────────────
CREATE OR REPLACE FUNCTION app_clinic_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.clinic_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION app_user_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '')::uuid
$$;

-- Trigger de updated_at
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ── Tenancy ─────────────────────────────────────────────────────────
CREATE TABLE clinics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  legal_name text,
  cnpj text,
  phone text,
  email text,
  address_street text,
  address_number text,
  address_complement text,
  address_district text,
  address_city text,
  address_state char(2),
  address_zip text,
  timezone text NOT NULL DEFAULT 'America/Sao_Paulo',
  logo_path text,
  business_hours jsonb NOT NULL DEFAULT '{}',
  booking_slug text UNIQUE,
  online_booking_enabled boolean NOT NULL DEFAULT false,
  anticipates_receivables boolean NOT NULL DEFAULT false,
  google_review_url text,
  settings jsonb NOT NULL DEFAULT '{}',
  plan text NOT NULL DEFAULT 'trial',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz
);
CREATE TRIGGER clinics_updated_at BEFORE UPDATE ON clinics
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- GLOBAL: um usuário pode pertencer a N clínicas
CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email citext NOT NULL UNIQUE,
  password_hash text,
  avatar_path text,
  phone text,
  is_superadmin boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz
);
CREATE TRIGGER users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Recurso de agenda; nem toda profissional tem login
CREATE TABLE professionals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id),
  name text NOT NULL,
  specialty text,
  registration_number text,
  calendar_color text NOT NULL DEFAULT '#0f766e',
  works_hours jsonb,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz
);
CREATE INDEX professionals_clinic_active_idx ON professionals (clinic_id, active);
CREATE TRIGGER professionals_updated_at BEFORE UPDATE ON professionals
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE clinic_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id),
  user_id uuid NOT NULL REFERENCES users(id),
  role text NOT NULL CHECK (role IN ('owner','manager','professional','reception')),
  professional_id uuid REFERENCES professionals(id),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT clinic_members_clinic_user_uq UNIQUE (clinic_id, user_id)
);
CREATE INDEX clinic_members_user_idx ON clinic_members (user_id);

CREATE TABLE rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id),
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX rooms_clinic_idx ON rooms (clinic_id);

-- Sessões opacas: id = sha256(token); token em claro nunca toca o banco
CREATE TABLE auth_sessions (
  id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  active_clinic_id uuid REFERENCES clinics(id),
  expires_at timestamptz NOT NULL,
  ip inet,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_sessions_user_idx ON auth_sessions (user_id);

-- ── Plataforma ──────────────────────────────────────────────────────
CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id),
  user_id uuid REFERENCES users(id),          -- NULL = todos da clínica
  type text NOT NULL,
  title text NOT NULL,
  body text,
  ref_table text,
  ref_id uuid,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_clinic_user_idx ON notifications (clinic_id, user_id, read_at);

CREATE TABLE audit_log (
  id bigserial PRIMARY KEY,
  clinic_id uuid NOT NULL REFERENCES clinics(id),
  user_id uuid REFERENCES users(id),
  action text NOT NULL CHECK (action IN ('create','update','delete','view_sensitive','export')),
  table_name text NOT NULL,
  record_id uuid,
  changes jsonb,
  ip inet,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_clinic_created_idx ON audit_log (clinic_id, created_at DESC);
CREATE INDEX audit_log_record_idx ON audit_log (table_name, record_id);

CREATE TABLE email_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid REFERENCES clinics(id),      -- NULL = e-mail de plataforma
  to_email text NOT NULL,
  subject text NOT NULL,
  kind text NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','failed')),
  error text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ═════════════════════════════ RLS ═════════════════════════════════
-- Padrão: ENABLE + FORCE em toda tabela de tenant. A aplicação conecta
-- com role SEM BYPASSRLS; até o owner respeita as políticas (FORCE).

-- clinics: visível se é a clínica ativa OU o usuário é membro (pré-seleção)
ALTER TABLE clinics ENABLE ROW LEVEL SECURITY;
ALTER TABLE clinics FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON clinics
  USING (
    id = app_clinic_id()
    OR id IN (SELECT clinic_id FROM clinic_members WHERE user_id = app_user_id() AND active)
  );

-- clinic_members: visível pela clínica ativa OU pelo próprio usuário
ALTER TABLE clinic_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE clinic_members FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON clinic_members
  USING (clinic_id = app_clinic_id() OR user_id = app_user_id());

-- Tabelas 100% de tenant: só a clínica ativa
ALTER TABLE professionals ENABLE ROW LEVEL SECURITY;
ALTER TABLE professionals FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON professionals USING (clinic_id = app_clinic_id());

ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE rooms FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON rooms USING (clinic_id = app_clinic_id());

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON notifications USING (clinic_id = app_clinic_id());

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON audit_log USING (clinic_id = app_clinic_id());

ALTER TABLE email_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_log FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON email_log
  USING (clinic_id = app_clinic_id() OR clinic_id IS NULL);

-- users e auth_sessions são GLOBAIS (sem RLS): acessados apenas pela camada de auth.

-- ── Grants para o usuário da aplicação ──────────────────────────────
GRANT USAGE ON SCHEMA public TO clinicaos_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO clinicaos_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO clinicaos_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO clinicaos_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO clinicaos_app;
REVOKE ALL ON schema_migrations FROM clinicaos_app;
