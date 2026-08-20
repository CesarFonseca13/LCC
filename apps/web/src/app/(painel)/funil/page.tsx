import { and, asc, eq, sql } from "drizzle-orm";
import { can } from "@clinicaos/core/permissions";
import { formatPhoneBR } from "@clinicaos/core/phone";
import { todayISO, zonedToUtc } from "@clinicaos/core/timezone";
import { schema, withTenant } from "@clinicaos/db";
import { EmptyState } from "@/components/ui";
import { requireAuth } from "@/lib/auth-action";
import { formatBRL } from "@/lib/format";
import { FunnelBoard, NewDealButton, type DealCard } from "./funnel-view";
import { FUNNEL_STAGES } from "./stages";

export const metadata = { title: "Funil de Vendas" };

export default async function FunilPage() {
  const auth = await requireAuth();
  if (!auth.clinicId || !auth.role) return null;

  if (!can(auth.role, "funnel.manage")) {
    return (
      <div className="p-8">
        <h1 className="text-xl font-semibold text-stone-800">Funil de Vendas</h1>
        <div className="mt-6">
          <EmptyState title="O funil é visível para a administradora, a gestora e a recepção." />
        </div>
      </div>
    );
  }

  const { deals, monthStats, customers, recentClosed } = await withTenant(
    auth.clinicId,
    async (tx) => {
      const deals = await tx
        .select({
          id: schema.deals.id,
          value: schema.deals.value,
          source: schema.deals.source,
          notes: schema.deals.notes,
          createdAt: schema.deals.createdAt,
          stageName: sql<string | null>`(SELECT name FROM pipeline_stages ps WHERE ps.id = deals.stage_id)`,
          customerName: schema.customers.fullName,
          phone: schema.customers.phoneE164,
        })
        .from(schema.deals)
        .innerJoin(schema.customers, eq(schema.customers.id, schema.deals.customerId))
        .where(and(eq(schema.deals.status, "open"), sql`customers.deleted_at IS NULL`))
        .orderBy(asc(schema.deals.createdAt));

      // "No mês" no fuso da clínica (não no do servidor)
      const tz = "America/Sao_Paulo";
      const monthStart = zonedToUtc(`${todayISO(tz).slice(0, 7)}-01`, "00:00", tz);
      const monthStats = (
        await tx
          .select({
            won: sql<number>`count(*) FILTER (WHERE status = 'won' AND won_at >= ${monthStart})::int`,
            lost: sql<number>`count(*) FILTER (WHERE status = 'lost' AND lost_at >= ${monthStart})::int`,
            wonValue: sql<string | null>`sum(value) FILTER (WHERE status = 'won' AND won_at >= ${monthStart})`,
          })
          .from(schema.deals)
      )[0];

      const customers = await tx
        .select({ id: schema.customers.id, name: schema.customers.fullName })
        .from(schema.customers)
        .where(and(sql`deleted_at IS NULL`, sql`merged_into_id IS NULL`))
        .orderBy(asc(schema.customers.fullName))
        .limit(1000);

      // Histórico recente: ganhas/perdidas não somem sem deixar rastro
      const recentClosed = await tx
        .select({
          id: schema.deals.id,
          status: schema.deals.status,
          value: schema.deals.value,
          lostReason: schema.deals.lostReason,
          closedAt: sql<string>`COALESCE(deals.won_at, deals.lost_at)`,
          customerName: schema.customers.fullName,
        })
        .from(schema.deals)
        .innerJoin(schema.customers, eq(schema.customers.id, schema.deals.customerId))
        .where(sql`deals.status <> 'open'`)
        .orderBy(sql`COALESCE(deals.won_at, deals.lost_at) DESC`)
        .limit(10);

      return { deals, monthStats, customers, recentClosed };
    },
    auth.userId,
  );

  const now = Date.now();
  const cards: DealCard[] = deals.map((d) => ({
    id: d.id,
    customerName: d.customerName,
    phone: formatPhoneBR(d.phone),
    stageName: d.stageName ?? FUNNEL_STAGES[0],
    value: d.value,
    source: d.source,
    notes: d.notes,
    daysOpen: Math.max(0, Math.floor((now - new Date(d.createdAt).getTime()) / 86_400_000)),
  }));

  return (
    <div className="p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-stone-800">Funil de Vendas</h1>
          <p className="mt-0.5 text-sm text-stone-500">
            Conversa nova de número desconhecido vira um card aqui sozinha — acompanhe
            até fechar.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-stone-500">
            No mês:{" "}
            <span className="font-medium text-emerald-700">
              {monthStats?.won ?? 0} ganha{(monthStats?.won ?? 0) === 1 ? "" : "s"}
              {monthStats?.wonValue ? ` (${formatBRL(monthStats.wonValue)})` : ""}
            </span>{" "}
            · <span className="text-stone-600">{monthStats?.lost ?? 0} perdida{(monthStats?.lost ?? 0) === 1 ? "" : "s"}</span>
          </span>
          <NewDealButton customers={customers} />
        </div>
      </div>

      <div className="mt-6">
        <FunnelBoard deals={cards} />
      </div>

      {recentClosed.length > 0 ? (
        <section className="mt-6 max-w-3xl rounded-xl border border-stone-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-stone-700">Fechadas recentemente</h2>
          <ul className="mt-3 divide-y divide-stone-100 text-sm">
            {recentClosed.map((d) => (
              <li key={d.id} className="flex items-center justify-between py-2">
                <span className="min-w-0 truncate text-stone-700">
                  {d.customerName}
                  {d.lostReason ? (
                    <span className="ml-2 text-xs text-stone-400">{d.lostReason}</span>
                  ) : null}
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  {d.value ? (
                    <span className="text-xs text-stone-500">{formatBRL(d.value)}</span>
                  ) : null}
                  {d.status === "won" ? (
                    <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                      Ganha
                    </span>
                  ) : (
                    <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs font-medium text-stone-500">
                      Perdida
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
