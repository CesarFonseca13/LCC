-- ═══════════════════════════════════════════════════════════════════
-- 0005 — WhatsApp: instâncias, eventos brutos, conversas e mensagens
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE whatsapp_instances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id),
  evolution_instance_name text NOT NULL UNIQUE,   -- ex.: cl-a1b2c3d4-01
  label text,
  phone_e164 text,
  is_primary boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'disconnected'
    CHECK (status IN ('created','qr_pending','connecting','connected','disconnected','banned')),
  webhook_token text NOT NULL,                    -- valida chamadas Evolution → web
  qr_code text,                                   -- último QR (base64), enquanto qr_pending
  last_seen_at timestamptz,
  last_disconnect_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz
);
CREATE INDEX whatsapp_instances_clinic_idx ON whatsapp_instances (clinic_id);
CREATE TRIGGER whatsapp_instances_updated_at BEFORE UPDATE ON whatsapp_instances
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Payload bruto de todo webhook: verdade para reprocessamento; retenção 30d (job futuro)
CREATE TABLE whatsapp_events (
  id bigserial PRIMARY KEY,
  instance_id uuid NOT NULL REFERENCES whatsapp_instances(id) ON DELETE CASCADE,
  clinic_id uuid NOT NULL REFERENCES clinics(id),
  event_type text NOT NULL,
  wa_message_id text,                             -- dedupe de reentrega p/ MESSAGES_UPSERT
  payload jsonb NOT NULL,
  processed boolean NOT NULL DEFAULT false,
  processed_at timestamptz,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX whatsapp_events_unprocessed_idx ON whatsapp_events (created_at)
  WHERE NOT processed;
CREATE UNIQUE INDEX whatsapp_events_dedupe_uq
  ON whatsapp_events (instance_id, event_type, wa_message_id)
  WHERE wa_message_id IS NOT NULL;

CREATE TABLE conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id),
  instance_id uuid NOT NULL REFERENCES whatsapp_instances(id),
  remote_jid text NOT NULL,                       -- 5511999999999@s.whatsapp.net
  customer_id uuid REFERENCES customers(id),      -- NULL = número desconhecido (lead cria customer)
  mode text NOT NULL DEFAULT 'ai'
    CHECK (mode IN ('ai','human','waiting_human')),
  assigned_user_id uuid REFERENCES users(id),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  unread_count int NOT NULL DEFAULT 0,
  last_message_at timestamptz,
  last_inbound_at timestamptz,
  ai_context_summary text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz,
  UNIQUE (instance_id, remote_jid)
);
CREATE INDEX conversations_clinic_last_idx ON conversations (clinic_id, last_message_at DESC);
CREATE TRIGGER conversations_updated_at BEFORE UPDATE ON conversations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  direction text NOT NULL CHECK (direction IN ('inbound','outbound')),
  author text NOT NULL CHECK (author IN ('customer','ai','human','automation')),
  author_user_id uuid REFERENCES users(id),
  wa_message_id text,                             -- id da Evolution
  type text NOT NULL DEFAULT 'text'
    CHECK (type IN ('text','image','audio','video','document','sticker','location','other')),
  body text,
  media_path text,
  status text NOT NULL
    CHECK (status IN ('received','queued','pending_approval','sending','sent',
                      'delivered','read','failed','rejected','expired')),
  automation_id text,
  automation_run_id uuid,
  scheduled_for timestamptz,                      -- janela comercial
  error text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX messages_conversation_idx ON messages (clinic_id, conversation_id, created_at DESC);
-- Fila de envio: a VERDADE é o Postgres (worker re-enfileira 'queued' no boot)
CREATE INDEX messages_outbound_queue_idx ON messages (clinic_id, scheduled_for)
  WHERE status = 'queued';
-- Reconciliação exactly-once: linhas 'sending' são verificadas antes de qualquer reenvio
CREATE INDEX messages_sending_idx ON messages (created_at) WHERE status = 'sending';
CREATE UNIQUE INDEX messages_wa_id_uq ON messages (conversation_id, wa_message_id)
  WHERE wa_message_id IS NOT NULL;

-- RLS
ALTER TABLE whatsapp_instances ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_instances FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON whatsapp_instances USING (clinic_id = app_clinic_id());
-- Webhook (sem sessão): resolve a instância pelo token vindo na URL
CREATE POLICY webhook_resolve ON whatsapp_instances
  USING (webhook_token = NULLIF(current_setting('app.webhook_token', true), ''));

ALTER TABLE whatsapp_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_events FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON whatsapp_events USING (clinic_id = app_clinic_id());

ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON conversations USING (clinic_id = app_clinic_id());

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON messages USING (clinic_id = app_clinic_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON
  whatsapp_instances, whatsapp_events, conversations, messages
TO clinicaos_app;
GRANT USAGE, SELECT ON SEQUENCE whatsapp_events_id_seq TO clinicaos_app;
