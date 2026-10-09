-- ═══════════════════════════════════════════════════════════════════
-- 0033 — Sugestões de oferta na conversa (venda complementar segura)
--        procedure_pairings: a clínica diz quais serviços PODEM ser oferecidos
--        junto com cada serviço (direcional). O sistema nunca sugere fora disso.
--        procedures.offer_note: como a clínica quer que o serviço seja oferecido.
--        procedures.promo_text/promo_until: promoção vigente, mostrada só até a data.
-- ═══════════════════════════════════════════════════════════════════
ALTER TABLE procedures
  ADD COLUMN IF NOT EXISTS offer_note text,
  ADD COLUMN IF NOT EXISTS promo_text text,
  ADD COLUMN IF NOT EXISTS promo_until date;

CREATE TABLE IF NOT EXISTS procedure_pairings (
  clinic_id uuid NOT NULL REFERENCES clinics(id),
  procedure_id uuid NOT NULL REFERENCES procedures(id) ON DELETE CASCADE,
  related_id uuid NOT NULL REFERENCES procedures(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (procedure_id, related_id),
  CHECK (procedure_id <> related_id)
);
CREATE INDEX IF NOT EXISTS procedure_pairings_clinic_idx ON procedure_pairings (clinic_id, procedure_id);

ALTER TABLE procedure_pairings ENABLE ROW LEVEL SECURITY;
ALTER TABLE procedure_pairings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON procedure_pairings;
CREATE POLICY tenant_isolation ON procedure_pairings USING (clinic_id = app_clinic_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON procedure_pairings TO clinicaos_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON procedure_pairings TO clinicaos_worker;
