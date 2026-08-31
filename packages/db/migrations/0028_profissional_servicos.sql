-- ═══════════════════════════════════════════════════════════════════
-- 0028 — Serviços por profissional
--        Profissional especializada faz só alguns serviços. Convenção:
--        SEM linhas aqui = faz todos (padrão, compatível com o que existe);
--        COM linhas = faz somente os listados. A busca de horários da
--        assistente e o agendamento online respeitam o vínculo.
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS professional_procedures (
  clinic_id uuid NOT NULL REFERENCES clinics(id),
  professional_id uuid NOT NULL REFERENCES professionals(id) ON DELETE CASCADE,
  procedure_id uuid NOT NULL REFERENCES procedures(id) ON DELETE CASCADE,
  PRIMARY KEY (professional_id, procedure_id)
);
CREATE INDEX IF NOT EXISTS professional_procedures_clinic_idx
  ON professional_procedures (clinic_id);

ALTER TABLE professional_procedures ENABLE ROW LEVEL SECURITY;
ALTER TABLE professional_procedures FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON professional_procedures;
CREATE POLICY tenant_isolation ON professional_procedures USING (clinic_id = app_clinic_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON professional_procedures TO clinicaos_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON professional_procedures TO clinicaos_worker;
