-- ═══════════════════════════════════════════════════════════════════
-- 0012 — Automações de relacionamento: 45min, pré-cuidados, faltas,
--        pós-atendimento, feedback, retoque, pós-venda e aniversário
-- ═══════════════════════════════════════════════════════════════════

INSERT INTO automation_definitions (id, phase, name, description, default_template, default_config, sort) VALUES
(
  'reminder_45min', 'confirmation',
  'Lembrete 45min antes',
  'Aviso logístico pouco antes do horário — envia mesmo já confirmado e NUNCA passa por aprovação (perderia o sentido).',
  'Oi {{nome}}! Daqui a pouquinho é o seu horário de {{procedimento}}, às {{hora}} 😊 Te espero!',
  '{"offset_minutes": 45, "time_critical": true}', 25
),
(
  'pre_care', 'confirmation',
  'Pré-cuidados por procedimento',
  'Envia os cuidados de antes do procedimento (cadastrados em Serviços) com antecedência.',
  'Oi {{nome}}! Seu {{procedimento}} está chegando 💛 Alguns cuidados importantes antes: {{cuidados}}',
  '{}', 28
),
(
  'no_show_message', 'no_show_recovery',
  'Mensagem da falta',
  'A cliente faltou? Pouco depois, uma mensagem carinhosa tenta o reagendamento.',
  'Oi {{nome}}, senti sua falta hoje no horário de {{procedimento}}! Aconteceu alguma coisa? Se quiser, já deixo um novo horário reservado pra você 💛',
  '{"delay_minutes": 40}', 40
),
(
  'no_show_followup', 'no_show_recovery',
  'Follow-up de reagendamento',
  'Alguns dias após a falta, um lembrete final — só se ela ainda não remarcou.',
  'Oi {{nome}}! Ainda quer remarcar o seu {{procedimento}}? Tenho uns horários ótimos essa semana 😊',
  '{"days_after": 3}', 42
),
(
  'post_visit', 'post_visit',
  'Mensagem pós-atendimento',
  'Algumas horas após o atendimento: agradecimento + cuidados de depois (de Serviços).',
  '{{nome}}, obrigada pela visita de hoje! 💛 {{cuidados}}',
  '{"hours_after": 2}', 50
),
(
  'feedback_request', 'post_visit',
  'Coleta de feedback',
  'No dia seguinte, pergunta a nota da experiência. Nota alta → convite para avaliar no Google; nota baixa → vira alerta para a equipe recuperar a cliente.',
  'Oi {{nome}}! Como você está se sentindo depois do {{procedimento}}? De 0 a 10, que nota você dá para a sua experiência com a gente?',
  '{"hours_after": 24}', 52
),
(
  'touchup_offer', 'post_visit',
  'Oferta de retoque',
  'Quando o procedimento tem retoque configurado, oferece o horário na época certa.',
  'Oi {{nome}}! Já se passaram {{dias}} dias do seu {{procedimento}} — é a época ideal do retoque pra manter o resultado perfeito 😊 Quer que eu veja um horário pra você?',
  '{}', 54
),
(
  'post_sale_cadence', 'post_visit',
  'Cadência pós-venda por procedimento',
  'Acompanhamento nos dias configurados em cada procedimento (ex.: 7 e 30 dias depois).',
  'Oi {{nome}}! Passando pra saber como está o resultado do seu {{procedimento}} 💛 Ficou alguma dúvida? Estou por aqui!',
  '{}', 56
),
(
  'birthday', 'reactivation',
  'Parabéns de aniversário',
  'No dia do aniversário da cliente, uma mensagem de carinho (uma por ano, prometido).',
  'Feliz aniversário, {{nome}}! 🎉 Que seu novo ciclo venha cheio de saúde e autoestima lá em cima. Um beijo enorme da equipe {{clinica}} 💛',
  '{}', 60
)
ON CONFLICT (id) DO NOTHING;
