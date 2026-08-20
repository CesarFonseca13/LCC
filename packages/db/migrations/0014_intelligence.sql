-- ═══════════════════════════════════════════════════════════════════
-- 0014 — Inteligência v1: score 0-100 materializado por cliente
--        (recência + frequência + valor + engajamento, 0-25 cada)
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE customer_scores (
  clinic_id uuid NOT NULL REFERENCES clinics(id),
  customer_id uuid PRIMARY KEY REFERENCES customers(id) ON DELETE CASCADE,
  score int NOT NULL,
  recency_score int NOT NULL,
  frequency_score int NOT NULL,
  value_score int NOT NULL,
  engagement_score int NOT NULL,
  classification text NOT NULL CHECK (classification IN ('quente', 'morno', 'frio')),
  -- Ação sugerida: o "e agora?" de cada cliente, sempre executável via Aprovações
  suggested_kind text NOT NULL DEFAULT 'none',
  suggested_action text,
  -- Números crus que sustentam as frases de explicação do breakdown
  metrics jsonb NOT NULL DEFAULT '{}',
  computed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX customer_scores_clinic_score_idx ON customer_scores (clinic_id, score DESC);
CREATE INDEX customer_scores_clinic_kind_idx ON customer_scores (clinic_id, suggested_kind);

ALTER TABLE customer_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_scores FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON customer_scores USING (clinic_id = app_clinic_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON customer_scores TO clinicaos_app;
