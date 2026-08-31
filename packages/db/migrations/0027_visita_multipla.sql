-- ═══════════════════════════════════════════════════════════════════
-- 0027 — Visita com múltiplos serviços
--        Cliente marca "limpeza + peeling" numa visita só: cada serviço
--        continua sendo um agendamento (financeiro/comissão por
--        procedimento), mas emendados em sequência e ligados pelo
--        mesmo visit_group_id — remarcar/cancelar move o grupo inteiro.
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE appointments ADD COLUMN IF NOT EXISTS visit_group_id uuid;
CREATE INDEX IF NOT EXISTS appointments_visit_group_idx
  ON appointments (visit_group_id) WHERE visit_group_id IS NOT NULL;
