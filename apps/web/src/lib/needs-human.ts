import "server-only";
import { sql } from "drizzle-orm";
import type { Tx } from "@clinicaos/db";

export interface LatestEscalation {
  /** id do aviso: muda a cada escalação nova (é a etiqueta do alerta no computador). */
  id: string;
  conversationId: string;
  urgent: boolean;
  /** ISO — o alerta só dispara para aviso MAIS NOVO que o último visto. */
  at: string;
}

export interface NeedsHumanCounts {
  /** Conversas em "precisa de você". */
  count: number;
  /** Quantas delas foram passadas como urgentes (motivo mais recente). */
  urgent: number;
  /** Escalação mais recente entre as conversas que ainda esperam a equipe. */
  latest: LatestEscalation | null;
  /** Urgente mais recente entre elas: urgente e comum no mesmo intervalo de
   *  consulta ainda dão alerta "URGENTE" (e o clique abre a urgente). */
  latestUrgent: LatestEscalation | null;
}

/** Tipos de aviso que explicam por que uma conversa está esperando a equipe. */
export const NEEDS_HUMAN_TYPES = ["conversation_needs_human", "conversation_urgent"] as const;

/** Contador do menu: conversas esperando a equipe (RLS da transação escopa a clínica). */
export async function countNeedsHuman(tx: Tx): Promise<NeedsHumanCounts> {
  const totals = await tx.execute(sql`
    SELECT count(*)::int AS count,
           count(*) FILTER (WHERE (
             SELECT n.type FROM notifications n
             WHERE n.ref_table = 'conversations' AND n.ref_id = c.id
               AND n.type IN ('conversation_needs_human', 'conversation_urgent')
             ORDER BY n.created_at DESC
             LIMIT 1
           ) = 'conversation_urgent')::int AS urgent
    FROM conversations c
    WHERE c.mode = 'waiting_human'
  `);
  const latestOf = async (types: readonly string[]): Promise<LatestEscalation | null> => {
    const rows = await tx.execute(sql`
      SELECT n.id, n.ref_id AS conversation_id, n.type, n.created_at
      FROM notifications n
      JOIN conversations c ON c.id = n.ref_id
      WHERE n.ref_table = 'conversations'
        AND n.type IN ${types}
        AND c.mode = 'waiting_human'
        -- só o aviso ATUAL de cada conversa (urgente de um episódio antigo não conta)
        AND NOT EXISTS (
          SELECT 1 FROM notifications n2
          WHERE n2.ref_table = 'conversations' AND n2.ref_id = n.ref_id
            AND n2.type IN ${NEEDS_HUMAN_TYPES}
            AND n2.created_at > n.created_at
        )
      ORDER BY n.created_at DESC
      LIMIT 1
    `);
    const last = rows.rows[0] as
      | { id: string; conversation_id: string; type: string; created_at: Date | string }
      | undefined;
    return last
      ? {
          id: last.id,
          conversationId: last.conversation_id,
          urgent: last.type === "conversation_urgent",
          at: new Date(last.created_at).toISOString(),
        }
      : null;
  };
  const row = totals.rows[0] as { count?: number | string; urgent?: number | string } | undefined;
  return {
    count: Number(row?.count ?? 0),
    urgent: Number(row?.urgent ?? 0),
    latest: await latestOf(NEEDS_HUMAN_TYPES),
    latestUrgent: await latestOf(["conversation_urgent"]),
  };
}
