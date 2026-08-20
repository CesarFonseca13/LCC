import { and, eq, ilike, isNull, sql } from "drizzle-orm";
import Link from "next/link";
import { formatPhoneBR } from "@clinicaos/core/phone";
import { schema, withTenant } from "@clinicaos/db";
import { EmptyState, Input } from "@/components/ui";
import { requireAuth } from "@/lib/auth-action";
import { formatBRL } from "@/lib/format";
import { CustomerFormButton } from "./customer-form";
import { ImportButton } from "./import-modal";

export const metadata = { title: "Clientes" };

const FILTERS = [
  ["todas", "Todas"],
  ["active", "Ativas"],
  ["at_risk", "Em risco"],
  ["lead", "Leads"],
  ["blocked", "Bloqueadas p/ automações"],
] as const;

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  lead: { label: "Lead", className: "bg-sky-50 text-sky-700" },
  active: { label: "Ativa", className: "bg-emerald-50 text-emerald-700" },
  at_risk: { label: "Em risco", className: "bg-amber-50 text-amber-700" },
  inactive: { label: "Inativa", className: "bg-stone-100 text-stone-500" },
};

export default async function ClientesPage({
  searchParams,
}: {
  searchParams: Promise<{ f?: string; q?: string }>;
}) {
  const auth = await requireAuth();
  if (!auth.clinicId) return null;
  const sp = await searchParams;
  const filter = sp.f ?? "todas";
  const query = sp.q?.trim() ?? "";

  const { counts, list } = await withTenant(
    auth.clinicId,
    async (tx) => {
      const countRows = await tx
        .select({
          status: schema.customers.status,
          blocked: schema.customers.automationsBlocked,
          count: sql<number>`count(*)::int`,
        })
        .from(schema.customers)
        .where(isNull(schema.customers.deletedAt))
        .groupBy(schema.customers.status, schema.customers.automationsBlocked);

      const conditions = [isNull(schema.customers.deletedAt)];
      if (filter === "blocked") {
        conditions.push(eq(schema.customers.automationsBlocked, true));
      } else if (filter !== "todas") {
        conditions.push(
          eq(schema.customers.status, filter as "lead" | "active" | "at_risk" | "inactive"),
        );
      }
      if (query) conditions.push(ilike(schema.customers.fullName, `%${query}%`));

      const list = await tx
        .select({
          id: schema.customers.id,
          fullName: schema.customers.fullName,
          phoneE164: schema.customers.phoneE164,
          status: schema.customers.status,
          automationsBlocked: schema.customers.automationsBlocked,
          visits: sql<number>`(SELECT count(*)::int FROM customer_history_entries h2 WHERE h2.customer_id = customers.id)`,
          totalSpent: sql<string | null>`(SELECT sum(h2.amount) FROM customer_history_entries h2 WHERE h2.customer_id = customers.id)`,
          lastVisit: sql<string | null>`(SELECT max(h2.occurred_on) FROM customer_history_entries h2 WHERE h2.customer_id = customers.id)`,
          lastProcedure: sql<string | null>`(
            SELECT COALESCE(p2.name, h2.procedure_name)
            FROM customer_history_entries h2 LEFT JOIN procedures p2 ON p2.id = h2.procedure_id
            WHERE h2.customer_id = customers.id
            ORDER BY h2.occurred_on DESC LIMIT 1
          )`,
        })
        .from(schema.customers)
        .where(and(...conditions))
        .orderBy(schema.customers.fullName)
        .limit(200);

      return { counts: countRows, list };
    },
    auth.userId,
  );

  const total = counts.reduce((acc, c) => acc + c.count, 0);
  const byStatus = (s: string) =>
    counts.filter((c) => c.status === s).reduce((acc, c) => acc + c.count, 0);
  const blocked = counts.filter((c) => c.blocked).reduce((acc, c) => acc + c.count, 0);

  const cards = [
    { label: "Total", value: total },
    { label: "Ativas", value: byStatus("active") },
    { label: "Em risco", value: byStatus("at_risk") },
    { label: "Leads", value: byStatus("lead") },
  ];

  return (
    <div className="p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-stone-800">Clientes</h1>
          <p className="mt-0.5 text-sm text-stone-500">
            {total} cliente{total === 1 ? "" : "s"} cadastrada{total === 1 ? "" : "s"}
          </p>
        </div>
        <div className="flex gap-2">
          <ImportButton />
          <CustomerFormButton />
        </div>
      </div>

      <section className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {cards.map((card) => (
          <div key={card.label} className="rounded-xl border border-stone-200 bg-white p-4">
            <p className="text-sm text-stone-500">{card.label}</p>
            <p className="mt-1 text-2xl font-semibold text-stone-800">{card.value}</p>
          </div>
        ))}
      </section>

      <div className="mt-6 flex flex-wrap items-center gap-2">
        {FILTERS.map(([key, label]) => (
          <Link
            key={key}
            href={`/clientes?f=${key}${query ? `&q=${encodeURIComponent(query)}` : ""}`}
            className={
              filter === key
                ? "rounded-full bg-teal-700 px-3 py-1.5 text-xs font-medium text-white"
                : "rounded-full border border-stone-200 bg-white px-3 py-1.5 text-xs text-stone-600 hover:border-stone-300"
            }
          >
            {label}
            {key === "blocked" && blocked > 0 ? ` (${blocked})` : ""}
          </Link>
        ))}
        <form className="ml-auto w-64" action="/clientes">
          <input type="hidden" name="f" value={filter} />
          <Input
            name="q"
            defaultValue={query}
            placeholder="Buscar por nome..."
            aria-label="Buscar cliente"
          />
        </form>
      </div>

      <div className="mt-4">
        {list.length === 0 ? (
          <EmptyState
            title={
              query
                ? `Nenhuma cliente encontrada para "${query}".`
                : "Cadastre sua primeira cliente — só nome e WhatsApp bastam para começar. Ou importe todas de uma vez pela planilha."
            }
            action={query ? undefined : <CustomerFormButton />}
          />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-stone-200 text-left text-xs uppercase tracking-wide text-stone-400">
                  <th className="px-4 py-3 font-medium">Cliente</th>
                  <th className="px-4 py-3 font-medium">Último procedimento</th>
                  <th className="px-4 py-3 font-medium">Visitas</th>
                  <th className="px-4 py-3 font-medium">Total investido</th>
                  <th className="px-4 py-3 font-medium">Última visita</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {list.map((c) => {
                  const badge = STATUS_BADGE[c.status] ?? STATUS_BADGE.lead!;
                  return (
                    <tr
                      key={c.id}
                      className="border-b border-stone-100 transition last:border-0 hover:bg-stone-50"
                    >
                      <td className="px-4 py-3">
                        <Link href={`/clientes/${c.id}`} className="block">
                          <span className="font-medium text-teal-800 hover:underline">
                            {c.fullName}
                          </span>
                          <span className="block text-xs text-stone-400">
                            {formatPhoneBR(c.phoneE164)}
                          </span>
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-stone-600">{c.lastProcedure ?? "—"}</td>
                      <td className="px-4 py-3 text-stone-600">{c.visits}</td>
                      <td className="px-4 py-3 text-stone-600">
                        {c.totalSpent ? formatBRL(c.totalSpent) : "—"}
                      </td>
                      <td className="px-4 py-3 text-stone-600">
                        {c.lastVisit
                          ? new Date(`${c.lastVisit}T12:00:00`).toLocaleDateString("pt-BR")
                          : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${badge.className}`}
                        >
                          {badge.label}
                        </span>
                        {c.automationsBlocked ? (
                          <span className="ml-1.5 rounded-full bg-red-50 px-2 py-0.5 text-xs text-red-600">
                            sem automações
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
