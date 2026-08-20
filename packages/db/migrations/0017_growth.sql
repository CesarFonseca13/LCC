-- ═══════════════════════════════════════════════════════════════════
-- 0017 — Crescimento e receita: preenchimento inteligente da agenda
--        (buracos das próximas 72h) e renovação de pacotes (2 gatilhos).
-- ═══════════════════════════════════════════════════════════════════

INSERT INTO automation_definitions (id, phase, name, description, default_template, default_config, sort) VALUES
(
  'smart_fill', 'growth',
  'Preenchimento inteligente da agenda',
  'Abriu um buraco na agenda dos próximos 3 dias? O sistema oferece o horário para a cliente certa: quem está com o retorno atrasado, começando pelas notas mais altas da Inteligência. Uma oferta por vez — a próxima só sai se a anterior ficar 4h sem resposta.',
  'Oi {{nome}}! Abriu um horário {{horario}} e lembrei na hora de você — seu {{procedimento}} já está na época do retorno 😊 Quer que eu deixe reservado?',
  '{"max_per_day": 4, "stagger_hours": 4, "cooldown_days": 14, "window_hours": 72}', 70
),
(
  'package_renewal_sessions', 'growth',
  'Renovação de pacote — sessões acabando',
  'Quando restar só {N} sessão do pacote, oferece a renovação para não perder o ritmo do tratamento.',
  'Oi {{nome}}! Suas sessões do {{pacote}} estão quase no fim — que tal já garantirmos a continuidade do seu cuidado? Se quiser, te passo as condições de renovação 😊',
  '{"sessions_left_threshold": 1, "cooldown_days": 30, "max_new_per_day": 10}', 72
),
(
  'package_renewal_expiry', 'growth',
  'Renovação de pacote — validade chegando',
  'Pacote vencendo em poucos dias com sessões sobrando? Convida a aproveitar e já renovar.',
  'Oi {{nome}}! Seu {{pacote}} vence daqui a pouquinho e você ainda tem sessões pra aproveitar 💛 Quer que eu veja uns horários pra essa semana? Se quiser, já te passo as condições da renovação.',
  '{"expiry_days": 7, "cooldown_days": 30, "max_new_per_day": 10}', 74
)
ON CONFLICT (id) DO NOTHING;
