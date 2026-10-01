-- ═══════════════════════════════════════════════════════════════════
-- 0031 — Embedded Signup + coexistência (app WhatsApp Business + API)
--        meta_coexistence: o número continua no app do celular; mensagens
--        enviadas pelo app chegam como eco (smb_message_echoes) e pausam a IA.
--        meta_pin_enc: PIN de verificação em duas etapas usado no registro
--        do número pela API (só sem coexistência), cifrado.
-- ═══════════════════════════════════════════════════════════════════
ALTER TABLE whatsapp_instances
  ADD COLUMN IF NOT EXISTS meta_coexistence boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS meta_pin_enc text;
