-- "Está por aí?" — a Ana dá um toque gentil quando a cliente some no meio
-- da conversa com pergunta em aberto. Um toque por rodada de silêncio:
-- o marcador zera (fica para trás de last_inbound_at) quando a cliente fala.
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS nudge_sent_at timestamptz;
