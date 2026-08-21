-- ═══════════════════════════════════════════════════════════════════
-- 0021 — Campanhas segmentadas com envio gradual (throttling anti-ban).
--        Só para clientes cadastradas — cold list é proibido por design.
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id),
  name text NOT NULL,
  message_template text NOT NULL,
  segment jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'running', 'paused', 'done', 'cancelled')),
  daily_cap int NOT NULL DEFAULT 30,
  recipient_count int,
  -- Ritmo: próximo envio só depois deste instante (45-180s entre mensagens)
  next_send_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz
);
CREATE INDEX campaigns_clinic_status_idx ON campaigns (clinic_id, status);

CREATE TABLE campaign_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id),
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'skipped')),
  message_id uuid,
  sent_at timestamptz,
  skip_reason text,
  UNIQUE (campaign_id, customer_id)
);
CREATE INDEX campaign_recipients_pending_idx
  ON campaign_recipients (campaign_id) WHERE status = 'pending';

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['campaigns', 'campaign_recipients']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (clinic_id = app_clinic_id())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO clinicaos_app', t);
  END LOOP;
END $$;
