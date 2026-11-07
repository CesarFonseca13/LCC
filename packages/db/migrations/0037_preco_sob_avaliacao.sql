-- ═══════════════════════════════════════════════════════════════════
-- 0037 — Preço sob avaliação
--        Muitas clínicas não divulgam valor: ele depende do caso de cada
--        pessoa e é definido pelo profissional na avaliação. Serviço com
--        price_on_request = true nunca mostra valor (atendente, página de
--        agendamento); a atendente explica que varia e convida para avaliar.
--        Preço 0 sem essa marca passa a significar "gratuito".
-- ═══════════════════════════════════════════════════════════════════
ALTER TABLE procedures
  ADD COLUMN IF NOT EXISTS price_on_request boolean NOT NULL DEFAULT false;

-- Serviços que já estavam com preço 0 faziam a atendente dizer "a partir de R$ 0,00".
-- Viram "sob avaliação": nunca prometer gratuidade sem a clínica dizer que é gratuito
-- (quem for gratuito de verdade, a clínica digita 0 de novo em Serviços).
-- O migrador é dono da tabela mas não tem BYPASSRLS: com FORCE, a política
-- tenant_isolation (sem app.clinic_id) faria o UPDATE casar 0 linhas. O FORCE fica
-- suspenso só dentro desta transação.
ALTER TABLE procedures NO FORCE ROW LEVEL SECURITY;
UPDATE procedures SET price_on_request = true WHERE price = 0 AND NOT price_on_request;
ALTER TABLE procedures FORCE ROW LEVEL SECURITY;
