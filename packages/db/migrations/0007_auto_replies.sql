-- ═══════════════════════════════════════════════════════════════════
-- 0007 — Resposta automática à confirmação (fase auto_reply)
--        Respostas reativas são direct-send (nunca passam por aprovação)
-- ═══════════════════════════════════════════════════════════════════

INSERT INTO automation_definitions (id, phase, name, description, default_template, default_config, sort) VALUES
(
  'reply_on_confirm', 'auto_reply',
  'Resposta ao confirmar',
  'O que a cliente recebe na hora quando ela mesma confirma pelo WhatsApp.',
  'Perfeito, {{nome}}! Combinado então: {{data}} às {{hora}} 💛 Qualquer coisa é só me chamar.',
  '{}', 30
)
ON CONFLICT (id) DO NOTHING;
