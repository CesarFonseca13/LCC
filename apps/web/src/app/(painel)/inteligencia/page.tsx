import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { can } from "@clinicaos/core/permissions";
import { schema, withTenant } from "@clinicaos/db";
import { EmptyState } from "@/components/ui";
import { requireAuth } from "@/lib/auth-action";
import { IntelligenceView, type ScoreRow } from "./intelligence-view";

export const metadata = { title: "Inteligência" };

export default async function InteligenciaPage() {
  const auth = await requireAuth();
  if (!auth.clinicId || !auth.role) return null;

  if (!can(auth.role, "intelligence.read")) {
    return (
      <div className="p-8">
        <h1 className="text-xl font-semibold text-stone-800">Inteligência</h1>
        <div className="mt-6">
          <EmptyState title="A Inteligência é visível apenas para a administradora e a recepção." />
        </div>
      </div>
    );
  }

  const { rows, lastComputed, byClass } = await withTenant(
    auth.clinicId,
    async (tx) => {
      const rows = await tx
        .select({
          customerId: schema.customerScores.customerId,
          name: schema.customers.fullName,
          score: schema.customerScores.score,
          recency: schema.customerScores.recencyScore,
          frequency: schema.customerScores.frequencyScore,
          value: schema.customerScores.valueScore,
          engagement: schema.customerScores.engagementScore,
          classification: schema.customerScores.classification,
          suggestedKind: schema.customerScores.suggestedKind,
          suggestedAction: schema.customerScores.suggestedAction,
          metrics: schema.customerScores.metrics,
        })
        .from(schema.customerScores)
        .innerJoin(
          schema.customers,
          eq(schema.customers.id, schema.customerScores.customerId),
        )
        // Ficha mesclada/excluída sai da lista (o botão dela só daria erro)
        .where(
          and(isNull(schema.customers.deletedAt), isNull(schema.customers.mergedIntoId)),
        )
        .orderBy(desc(schema.customerScores.score), schema.customers.fullName)
        .limit(300);
      const lastComputed = (
        await tx
          .select({ max: sql<string | null>`max(computed_at)` })
          .from(schema.customerScores)
      )[0];
      // Contagens sobre a base inteira (a lista mostra até 300)
      const byClass = await tx
        .select({
          classification: schema.customerScores.classification,
          count: sql<number>`count(*)::int`,
        })
        .from(schema.customerScores)
        .innerJoin(
          schema.customers,
          eq(schema.customers.id, schema.customerScores.customerId),
        )
        .where(
          and(isNull(schema.customers.deletedAt), isNull(schema.customers.mergedIntoId)),
        )
        .groupBy(schema.customerScores.classification);
      return { rows, lastComputed: lastComputed?.max ?? null, byClass };
    },
    auth.userId,
  );

  const counts = {
    quente: byClass.find((c) => c.classification === "quente")?.count ?? 0,
    morno: byClass.find((c) => c.classification === "morno")?.count ?? 0,
    frio: byClass.find((c) => c.classification === "frio")?.count ?? 0,
  };
  const total = counts.quente + counts.morno + counts.frio;

  // Valores em R$ só para quem enxerga o financeiro — a nota (0-25) continua
  const canSeeMoney = can(auth.role, "finance.read");
  const safeRows = canSeeMoney
    ? rows
    : rows.map((r) => ({
        ...r,
        metrics: {
          ...(r.metrics as Record<string, unknown>),
          value12m: null,
          valuePercentile: null,
        },
      }));

  return (
    <div className="p-8">
      <h1 className="text-xl font-semibold text-stone-800">Inteligência</h1>
      <p className="mt-0.5 text-sm text-stone-500">
        Suas clientes por potencial (0 a 100), com o porquê de cada nota e uma ação
        pronta — tudo passa por Aprovações antes de sair.
      </p>

      {rows.length === 0 ? (
        <div className="mt-6 max-w-4xl">
          <IntelligenceView rows={[]} counts={counts} total={0} lastComputedISO={null} />
          <div className="mt-4">
            <EmptyState title='Clique em "Atualizar análise" para calcular o score das suas clientes pela primeira vez.' />
          </div>
        </div>
      ) : (
        <IntelligenceView
          rows={safeRows as unknown as ScoreRow[]}
          counts={counts}
          total={total}
          lastComputedISO={lastComputed ? new Date(lastComputed).toISOString() : null}
        />
      )}
    </div>
  );
}
