-- ═══════════════════════════════════════════════════════════════════
-- 0015 — Reativação inteligente: sequências de até 7 mensagens por
--        procedimento + reativação genérica. Resposta da cliente PAUSA
--        a cadência; sem conversão, retoma do passo seguinte.
-- ═══════════════════════════════════════════════════════════════════

-- Runs de reativação não nascem de um agendamento: guardam o procedimento
-- direto; 'paused' entra no ciclo de vida (resposta da cliente pausa).
ALTER TABLE automation_runs
  ADD COLUMN procedure_id uuid REFERENCES procedures(id),
  ADD COLUMN paused_at timestamptz;

ALTER TABLE automation_runs DROP CONSTRAINT automation_runs_status_check;
ALTER TABLE automation_runs ADD CONSTRAINT automation_runs_status_check
  CHECK (status IN ('active','processing','paused','completed','goal_reached','cancelled','skipped','error'));

CREATE INDEX automation_runs_paused_idx ON automation_runs (paused_at)
  WHERE status = 'paused';
CREATE INDEX automation_runs_customer_reactivation_idx ON automation_runs (customer_id)
  WHERE automation_id IN ('reactivation_smart','reactivation_generic');

INSERT INTO automation_definitions (id, phase, name, description, default_template, default_config, sort) VALUES
(
  'reactivation_smart', 'reactivation',
  'Reativação por procedimento',
  'Quando o prazo de retorno de um procedimento vence e a cliente some, uma sequência de até 7 mensagens espaçadas tenta o reencontro — do convite leve à despedida elegante. Se ela responder, a sequência pausa na hora.',
  'Sequência de 7 mensagens (edite cada uma abaixo)',
  '{"cooldown_days": 60, "resume_hours": 48, "max_new_per_day": 10, "steps": [
    {"days": 0,  "template": "Oi {{nome}}, tudo bem? 💛 Lembrei de você por aqui — já está na época do seu retorno de {{procedimento}}. Quer que eu veja uns horários dessa semana pra você?"},
    {"days": 3,  "template": "Oi {{nome}}! Me fala um dia que fica bom pra você que eu olho os horários de {{procedimento}} — assim seu resultado continua em dia 😊"},
    {"days": 13, "template": "{{nome}}, passando de novo por aqui! Abriram uns horários ótimos pro seu {{procedimento}} essa semana. Quer aproveitar?"},
    {"days": 25, "template": "Oi {{nome}}, tudo bem? Seu resultado de {{procedimento}} merece continuidade — se quiser, separo umas opções de horário pra você escolher 💛"},
    {"days": 40, "template": "{{nome}}, que saudade! 😊 Sentimos sua falta por aqui. Que tal retomarmos seu cuidado com {{procedimento}}? Me avisa que eu organizo tudo."},
    {"days": 60, "template": "Oi {{nome}}! Prometo que não quero insistir — só não queria que você perdesse o resultado que a gente construiu junto. Se quiser retomar o {{procedimento}}, é só me chamar 💛"},
    {"days": 90, "template": "{{nome}}, essa é minha última mensagenzinha, prometo 😊 Saiba que as portas da {{clinica}} estão sempre abertas pra você. Quando quiser voltar, é só dizer um oi. Um beijo!"}
  ]}', 62
),
(
  'reactivation_generic', 'reactivation',
  'Reativação de quem sumiu',
  'Para clientes sem procedimento com prazo de retorno: depois de um tempo sem visitas, uma sequência curta e carinhosa chama de volta.',
  'Sequência de 3 mensagens (edite cada uma abaixo)',
  '{"cooldown_days": 60, "resume_hours": 48, "max_new_per_day": 10, "gap_days": 90, "steps": [
    {"days": 0,  "template": "Oi {{nome}}, tudo bem com você? Faz um tempinho que a gente não se vê e lembrei de você 💛 Se quiser dar uma passadinha, me fala que eu encontro um horário gostoso pra você."},
    {"days": 7,  "template": "Oi {{nome}}! A agenda dessa semana está com uns horários ótimos — que tal marcarmos seu retorno? 😊"},
    {"days": 21, "template": "{{nome}}, só passando pra dizer que as portas da {{clinica}} estão sempre abertas pra você 💛 Quando quiser voltar, é só me chamar. Um beijo!"}
  ]}', 64
)
ON CONFLICT (id) DO NOTHING;
