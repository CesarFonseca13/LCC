-- ═══════════════════════════════════════════════════════════════════
-- 0035 — Importação da coexistência (API oficial + app WhatsApp Business)
--        Depois que a clínica conecta o número mantendo o app no celular,
--        a Meta permite pedir UMA vez (nas 24 h seguintes) os contatos da
--        agenda do app (smb_app_state_sync) e até 6 meses de conversas
--        (history). Os pedidos e o andamento ficam no próprio número.
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE whatsapp_instances
  ADD COLUMN IF NOT EXISTS meta_sync_requested_at timestamptz,
  -- { requestedAt, contactsRequestId, historyRequestId, contactsError, historyError,
  --   contacts, threads, messages, progress, phase, lastEventAt, historyShared, doneAt }
  ADD COLUMN IF NOT EXISTS meta_sync jsonb;

-- Lotes da importação chegam UMA vez (a Meta não reenvia depois do 200): uma
-- falha passageira no meio do lote não pode enterrar o evento — o worker tenta
-- de novo (até 10 vezes, com 1 min de espera) antes de marcar como processado.
ALTER TABLE whatsapp_events
  ADD COLUMN IF NOT EXISTS attempts int NOT NULL DEFAULT 0;
