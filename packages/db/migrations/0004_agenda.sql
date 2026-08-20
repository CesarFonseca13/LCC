-- ═══════════════════════════════════════════════════════════════════
-- 0004 — Agenda: agendamentos (máquina de estados), histórico, bloqueios
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id),
  customer_id uuid NOT NULL REFERENCES customers(id),
  professional_id uuid NOT NULL REFERENCES professionals(id),
  room_id uuid REFERENCES rooms(id),
  procedure_id uuid REFERENCES procedures(id),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL CHECK (ends_at > starts_at),
  status text NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled','confirmed','showed','no_show','cancelled','rescheduled')),
  price numeric(12,2),                     -- congelado no momento do agendamento
  is_touchup boolean NOT NULL DEFAULT false,
  parent_appointment_id uuid REFERENCES appointments(id),  -- retoque → atendimento original
  rescheduled_to_id uuid REFERENCES appointments(id),      -- cadeia de reagendamento
  origin text NOT NULL DEFAULT 'manual'
    CHECK (origin IN ('manual','online_booking','automation','ai_agent','reschedule')),
  allow_overlap boolean NOT NULL DEFAULT false,            -- encaixe intencional
  cancel_reason text,
  notes text,
  status_changed_at timestamptz,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz,

  -- Anti-conflito: mesma profissional nunca em dois lugares (exceto encaixe intencional)
  CONSTRAINT appointments_no_overlap_professional EXCLUDE USING gist (
    professional_id WITH =,
    tstzrange(starts_at, ends_at) WITH &&
  ) WHERE (status IN ('scheduled','confirmed','showed') AND NOT allow_overlap),

  -- Anti-conflito: mesma sala nunca com dois atendimentos (exceto encaixe intencional)
  CONSTRAINT appointments_no_overlap_room EXCLUDE USING gist (
    room_id WITH =,
    tstzrange(starts_at, ends_at) WITH &&
  ) WHERE (room_id IS NOT NULL AND status IN ('scheduled','confirmed','showed') AND NOT allow_overlap)
);
CREATE INDEX appointments_clinic_starts_idx ON appointments (clinic_id, starts_at);
CREATE INDEX appointments_clinic_prof_starts_idx ON appointments (clinic_id, professional_id, starts_at);
CREATE INDEX appointments_clinic_customer_idx ON appointments (clinic_id, customer_id, starts_at DESC);
-- Varredura das cadências (24h/2h) e do preenchimento inteligente (72h)
CREATE INDEX appointments_pending_idx ON appointments (clinic_id, starts_at)
  WHERE status IN ('scheduled','confirmed');
CREATE TRIGGER appointments_updated_at BEFORE UPDATE ON appointments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE appointment_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id),
  appointment_id uuid NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  from_status text,
  to_status text NOT NULL,
  source text NOT NULL DEFAULT 'user'
    CHECK (source IN ('user','customer_whatsapp','ai_agent','automation','system')),
  changed_by_user_id uuid REFERENCES users(id),
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX appointment_status_history_appt_idx ON appointment_status_history (appointment_id);

-- Bloqueios de agenda: almoço, férias, feriado, manutenção
CREATE TABLE schedule_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id),
  professional_id uuid REFERENCES professionals(id),   -- NULL = clínica inteira
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL CHECK (ends_at > starts_at),
  reason text,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX schedule_blocks_clinic_starts_idx ON schedule_blocks (clinic_id, starts_at);

-- RLS
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON appointments USING (clinic_id = app_clinic_id());

ALTER TABLE appointment_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointment_status_history FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON appointment_status_history USING (clinic_id = app_clinic_id());

ALTER TABLE schedule_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedule_blocks FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON schedule_blocks USING (clinic_id = app_clinic_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON
  appointments, appointment_status_history, schedule_blocks
TO clinicaos_app;
