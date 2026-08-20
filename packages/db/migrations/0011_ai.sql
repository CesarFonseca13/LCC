-- ═══════════════════════════════════════════════════════════════════
-- 0011 — IA conversacional: debounce persistente por conversa e
--        medição de uso (cap mensal com kill-switch)
-- ═══════════════════════════════════════════════════════════════════

-- Debounce da IA no Postgres (a verdade nunca fica só na memória do worker):
-- cada mensagem recebida empurra o turno para +N segundos; o sweep processa vencidos.
ALTER TABLE conversations
  ADD COLUMN ai_turn_after timestamptz;
CREATE INDEX conversations_ai_due_idx ON conversations (ai_turn_after)
  WHERE ai_turn_after IS NOT NULL;

-- Medição de uso da IA por clínica (controle de custo + kill-switch)
CREATE TABLE ai_usage (
  id bigserial PRIMARY KEY,
  clinic_id uuid NOT NULL REFERENCES clinics(id),
  purpose text NOT NULL,                -- 'agent' | 'classify'
  model text NOT NULL,
  input_tokens int NOT NULL DEFAULT 0,
  output_tokens int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_usage_clinic_month_idx ON ai_usage (clinic_id, created_at);

ALTER TABLE ai_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_usage FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ai_usage USING (clinic_id = app_clinic_id());

GRANT SELECT, INSERT ON ai_usage TO clinicaos_app;
GRANT USAGE, SELECT ON SEQUENCE ai_usage_id_seq TO clinicaos_app;
