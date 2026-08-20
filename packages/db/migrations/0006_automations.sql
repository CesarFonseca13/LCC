-- ═══════════════════════════════════════════════════════════════════
-- 0006 — Motor de automações: catálogo global, config por clínica,
--        runs (next_run_at é a fila real), log e fila de Aprovações
-- ═══════════════════════════════════════════════════════════════════

-- Catálogo GLOBAL (sem clinic_id, sem RLS): faz parte do produto, seed via migração
CREATE TABLE automation_definitions (
  id text PRIMARY KEY,                    -- slug: 'reminder_24h', 'confirm_2h', ...
  phase text NOT NULL CHECK (phase IN
    ('confirmation','auto_reply','no_show_recovery','post_visit','reactivation','growth')),
  name text NOT NULL,
  description text NOT NULL,
  default_template text NOT NULL,
  default_config jsonb NOT NULL DEFAULT '{}',
  sort int NOT NULL DEFAULT 0
);

INSERT INTO automation_definitions (id, phase, name, description, default_template, default_config, sort) VALUES
(
  'reminder_24h', 'confirmation',
  'Lembrete 24h antes',
  'Envia uma mensagem carinhosa um dia antes do horário, pedindo confirmação.',
  'Oi {{nome}}! Tudo bem? 😊 Passando pra lembrar do seu horário de {{procedimento}} no dia {{data}} às {{hora}} com a {{profissional}}. Posso confirmar sua presença?',
  '{"offset_hours": 24}', 10
),
(
  'confirm_2h', 'confirmation',
  'Confirmação 2h antes',
  'Reforço gentil no dia, só para quem ainda não confirmou.',
  'Oi {{nome}}! Seu horário de {{procedimento}} é hoje às {{hora}}. Está tudo certo para você vir? 💛',
  '{"offset_hours": 2}', 20
);

-- Config por clínica (tela Automações: toggle + editar mensagem + revisar antes de enviar)
CREATE TABLE automation_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id),
  automation_id text NOT NULL REFERENCES automation_definitions(id),
  enabled boolean NOT NULL DEFAULT false,
  requires_approval boolean NOT NULL DEFAULT true,   -- modo supervisionado por default
  message_template text,                             -- NULL = usa o default do catálogo
  config jsonb NOT NULL DEFAULT '{}',
  updated_by uuid REFERENCES users(id),
  updated_at timestamptz,
  UNIQUE (clinic_id, automation_id)
);

-- Instância de execução: ★ next_run_at é a fila real (tick varre por índice global)
CREATE TABLE automation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id),
  automation_id text NOT NULL REFERENCES automation_definitions(id),
  customer_id uuid NOT NULL REFERENCES customers(id),
  appointment_id uuid REFERENCES appointments(id) ON DELETE CASCADE,
  current_step int NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','processing','completed','goal_reached','cancelled','skipped','error')),
  next_run_at timestamptz,
  stop_reason text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
-- Varredura global do tick (cross-tenant, worker BYPASSRLS)
CREATE INDEX automation_runs_due_idx ON automation_runs (next_run_at)
  WHERE status = 'active';
CREATE INDEX automation_runs_appt_idx ON automation_runs (appointment_id);
-- Uma run ativa por automação × agendamento (idempotência da materialização)
CREATE UNIQUE INDEX automation_runs_active_uq
  ON automation_runs (automation_id, appointment_id)
  WHERE status IN ('active','processing');

CREATE TABLE automation_log (
  id bigserial PRIMARY KEY,
  clinic_id uuid NOT NULL REFERENCES clinics(id),
  automation_id text NOT NULL,
  run_id uuid,
  customer_id uuid,
  appointment_id uuid,
  result text NOT NULL CHECK (result IN
    ('queued','pending_approval','sent','skipped','goal_reached','cancelled','expired','error')),
  detail text,
  message_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX automation_log_clinic_idx ON automation_log (clinic_id, created_at DESC);

-- Fila de Aprovações (human-in-the-loop)
CREATE TABLE approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id),
  message_id uuid NOT NULL UNIQUE REFERENCES messages(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES customers(id),
  automation_id text,
  run_id uuid,
  generated_body text NOT NULL,
  edited_body text,
  context_line text,                     -- "Limpeza de Pele · amanhã 14:00 · Dra. Paula"
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','edited_approved','rejected','expired')),
  reviewed_by uuid REFERENCES users(id),
  reviewed_at timestamptz,
  expires_at timestamptz,                -- lembrete aprovado tarde não faz sentido
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX approvals_pending_idx ON approvals (clinic_id, created_at)
  WHERE status = 'pending';
-- Sweep de expiração (cross-tenant)
CREATE INDEX approvals_expiring_idx ON approvals (expires_at)
  WHERE status = 'pending';

-- RLS (automation_definitions é global e somente leitura p/ app)
ALTER TABLE automation_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE automation_settings FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON automation_settings USING (clinic_id = app_clinic_id());

ALTER TABLE automation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE automation_runs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON automation_runs USING (clinic_id = app_clinic_id());

ALTER TABLE automation_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE automation_log FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON automation_log USING (clinic_id = app_clinic_id());

ALTER TABLE approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE approvals FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON approvals USING (clinic_id = app_clinic_id());

GRANT SELECT ON automation_definitions TO clinicaos_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  automation_settings, automation_runs, automation_log, approvals
TO clinicaos_app;
GRANT USAGE, SELECT ON SEQUENCE automation_log_id_seq TO clinicaos_app;
