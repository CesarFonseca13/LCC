import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import Link from "next/link";
import { can } from "@clinicaos/core/permissions";
import { addDaysISO, todayISO } from "@clinicaos/core/timezone";
import { schema, withTenant } from "@clinicaos/db";
import { EmptyState } from "@/components/ui";
import { requireAuth } from "@/lib/auth-action";
import { formatBRL } from "@/lib/format";
import { PrepareMessageButton } from "@/components/prepare-message-button";

export const metadata = { title: "Relatórios" };

type Period = "mes" | "mes-passado" | "30d" | "90d";

const PERIODS: { key: Period; label: string }[] = [
  { key: "mes", label: "Este mês" },
  { key: "mes-passado", label: "Mês passado" },
  { key: "30d", label: "Últimos 30 dias" },
  { key: "90d", label: "Últimos 90 dias" },
];

function periodRange(period: Period, hoje: string): { start: string; end: string } {
  const [y, m] = hoje.split("-").map(Number);
  if (period === "mes") {
    const nextFirst =
      m === 12 ? `${y! + 1}-01-01` : `${y}-${String(m! + 1).padStart(2, "0")}-01`;
    return { start: `${hoje.slice(0, 7)}-01`, end: addDaysISO(nextFirst, -1) };
  }
  if (period === "mes-passado") {
    const prevFirst =
      m === 1 ? `${y! - 1}-12-01` : `${y}-${String(m! - 1).padStart(2, "0")}-01`;
    return { start: prevFirst, end: addDaysISO(`${hoje.slice(0, 7)}-01`, -1) };
  }
  // -29/-89 porque o próprio hoje conta: exatamente 30/90 datas na janela
  return { start: addDaysISO(hoje, period === "30d" ? -29 : -89), end: hoje };
}

function Card({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-4">
      <p className="text-xs font-medium text-stone-500">{label}</p>
      <p className="mt-1 text-xl font-semibold text-stone-800">{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-stone-400">{hint}</p> : null}
    </div>
  );
}

export default async function RelatoriosPage({
  searchParams,
}: {
  searchParams: Promise<{ p?: string }>;
}) {
  const auth = await requireAuth();
  if (!auth.clinicId || !auth.role) return null;

  if (!can(auth.role, "reports.read")) {
    return (
      <div className="p-8">
        <h1 className="text-xl font-semibold text-stone-800">Relatórios</h1>
        <div className="mt-6">
          <EmptyState title="Os relatórios são visíveis apenas para a administradora e a gestora." />
        </div>
      </div>
    );
  }

  const sp = await searchParams;
  const period: Period = (PERIODS.find((p) => p.key === sp.p)?.key ?? "mes") as Period;
  const hoje = todayISO("America/Sao_Paulo");
  const { start, end } = periodRange(period, hoje);
  const startTs = `${start}T00:00:00-03:00`;
  const endTs = `${addDaysISO(end, 1)}T00:00:00-03:00`;

  const data = await withTenant(
    auth.clinicId,
    async (tx) => {
      const received = (
        await tx
          .select({ total: sql<string | null>`sum(net_amount)`, count: sql<number>`count(*)::int` })
          .from(schema.receivables)
          .where(
            and(
              eq(schema.receivables.status, "received"),
              gte(schema.receivables.receivedAt, start),
              lte(schema.receivables.receivedAt, end),
            ),
          )
      )[0];
      const toReceive = (
        await tx
          .select({ total: sql<string | null>`sum(net_amount)` })
          .from(schema.receivables)
          .where(
            and(
              eq(schema.receivables.status, "pending"),
              gte(schema.receivables.dueDate, start),
              lte(schema.receivables.dueDate, end),
            ),
          )
      )[0];

      const appts = (
        await tx
          .select({
            showed: sql<number>`count(*) FILTER (WHERE status = 'showed')::int`,
            noShow: sql<number>`count(*) FILTER (WHERE status = 'no_show')::int`,
            cancelled: sql<number>`count(*) FILTER (WHERE status = 'cancelled')::int`,
            upcoming: sql<number>`count(*) FILTER (WHERE status IN ('scheduled','confirmed'))::int`,
            // Sessão de pacote não gera cobrança: o preço avulso dela NÃO entra
            // no ticket (o dinheiro do pacote entrou quando foi vendido)
            showedValue: sql<string | null>`sum(price) FILTER (WHERE status = 'showed' AND customer_package_id IS NULL)`,
            showedBillable: sql<number>`count(*) FILTER (WHERE status = 'showed' AND customer_package_id IS NULL)::int`,
          })
          .from(schema.appointments)
          .where(
            and(
              gte(schema.appointments.startsAt, new Date(startTs)),
              lte(schema.appointments.startsAt, new Date(endTs)),
            ),
          )
      )[0];

      const topProcedures = await tx
        .select({
          name: schema.procedures.name,
          count: sql<number>`count(*)::int`,
          total: sql<string | null>`sum(${schema.appointments.price}) FILTER (WHERE ${schema.appointments.customerPackageId} IS NULL)`,
        })
        .from(schema.appointments)
        .innerJoin(
          schema.procedures,
          eq(schema.procedures.id, schema.appointments.procedureId),
        )
        .where(
          and(
            eq(schema.appointments.status, "showed"),
            gte(schema.appointments.startsAt, new Date(startTs)),
            lte(schema.appointments.startsAt, new Date(endTs)),
          ),
        )
        .groupBy(schema.procedures.name)
        .orderBy(desc(sql`count(*)`))
        .limit(5);

      const quotes = (
        await tx
          .select({
            sent: sql<number>`count(*)::int`,
            accepted: sql<number>`count(*) FILTER (WHERE status = 'accepted' OR converted_at IS NOT NULL)::int`,
          })
          .from(schema.quotes)
          .where(
            and(
              gte(schema.quotes.sentAt, new Date(startTs)),
              lte(schema.quotes.sentAt, new Date(endTs)),
            ),
          )
      )[0];

      // CMV: materiais consumidos nos atendimentos do período × custo unitário
      const hasStock = (
        await tx
          .select({ id: schema.stockItems.id })
          .from(schema.stockItems)
          .limit(1)
      )[0];
      const cmv = (
        await tx
          .select({
            total: sql<string | null>`sum(-${schema.stockMovements.quantity} * COALESCE(${schema.stockItems.cost}, 0))`,
          })
          .from(schema.stockMovements)
          .innerJoin(
            schema.stockItems,
            eq(schema.stockItems.id, schema.stockMovements.stockItemId),
          )
          // Consumo entra no período do ATENDIMENTO (não do clique tardio no
          // "Compareceu") — mesmo corte usado por atendimentos/ticket
          .leftJoin(
            schema.appointments,
            eq(schema.appointments.id, schema.stockMovements.appointmentId),
          )
          .where(
            and(
              eq(schema.stockMovements.kind, "procedure_use"),
              gte(
                sql`COALESCE(${schema.appointments.startsAt}, ${schema.stockMovements.createdAt})`,
                new Date(startTs),
              ),
              lte(
                sql`COALESCE(${schema.appointments.startsAt}, ${schema.stockMovements.createdAt})`,
                new Date(endTs),
              ),
            ),
          )
      )[0];

      const reactivations = await tx
        .select({
          customerId: schema.customerScores.customerId,
          name: schema.customers.fullName,
          score: schema.customerScores.score,
          action: schema.customerScores.suggestedAction,
        })
        .from(schema.customerScores)
        .innerJoin(
          schema.customers,
          eq(schema.customers.id, schema.customerScores.customerId),
        )
        .where(
          and(
            inArray(schema.customerScores.suggestedKind, ["return_due", "reactivation"]),
            sql`customers.deleted_at IS NULL AND customers.merged_into_id IS NULL`,
          ),
        )
        .orderBy(desc(schema.customerScores.score))
        .limit(10);

      return {
        received: received?.total ?? "0",
        receivedCount: received?.count ?? 0,
        toReceive: toReceive?.total ?? "0",
        showed: appts?.showed ?? 0,
        noShow: appts?.noShow ?? 0,
        cancelled: appts?.cancelled ?? 0,
        upcoming: appts?.upcoming ?? 0,
        showedValue: appts?.showedValue ?? "0",
        showedBillable: appts?.showedBillable ?? 0,
        cmv: cmv?.total ?? "0",
        hasStock: Boolean(hasStock),
        topProcedures,
        quotesSent: quotes?.sent ?? 0,
        quotesAccepted: quotes?.accepted ?? 0,
        reactivations,
      };
    },
    auth.userId,
  );

  const finished = data.showed + data.noShow;
  const showRate = finished > 0 ? Math.round((data.showed / finished) * 100) : null;
  const ticket =
    data.showedBillable > 0 ? Number(data.showedValue ?? 0) / data.showedBillable : null;
  const quoteRate =
    data.quotesSent > 0 ? Math.round((data.quotesAccepted / data.quotesSent) * 100) : null;
  const maxProcCount = Math.max(1, ...data.topProcedures.map((p) => p.count));

  return (
    <div className="p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-stone-800">Relatórios</h1>
          <p className="mt-0.5 text-sm text-stone-500">
            Como a clínica está indo — sem planilha.
          </p>
        </div>
        <div className="flex gap-2">
          {PERIODS.map((p) => (
            <Link
              key={p.key}
              href={p.key === "mes" ? "/relatorios" : `/relatorios?p=${p.key}`}
              className={
                p.key === period
                  ? "rounded-full bg-teal-700 px-3.5 py-1.5 text-xs font-medium text-white"
                  : "rounded-full border border-stone-300 bg-white px-3.5 py-1.5 text-xs font-medium text-stone-600 hover:bg-stone-50"
              }
            >
              {p.label}
            </Link>
          ))}
        </div>
      </div>

      <div className="mt-6 grid max-w-4xl gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card
          label="Recebido no período"
          value={formatBRL(data.received)}
          hint={`${data.receivedCount} recebimento${data.receivedCount === 1 ? "" : "s"}`}
        />
        <Card
          label="A receber no período"
          value={formatBRL(data.toReceive)}
          hint="parcelas com vencimento no período"
        />
        <Card
          label="Atendimentos realizados"
          value={String(data.showed)}
          hint={data.upcoming > 0 ? `+${data.upcoming} agendados no período` : undefined}
        />
        <Card
          label="Ticket médio"
          value={ticket === null ? "—" : formatBRL(ticket)}
          hint="por atendimento avulso (sessões de pacote fora)"
        />
        {data.hasStock ? (
          <Card
            label="Custo de materiais"
            value={formatBRL(data.cmv)}
            hint="consumo dos atendimentos, pelo custo atual dos itens"
          />
        ) : null}
      </div>

      <div className="mt-4 grid max-w-4xl gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-stone-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-stone-700">Conversão</h2>
          <dl className="mt-3 space-y-2.5 text-sm">
            <div className="flex items-center justify-between">
              <dt className="text-stone-600">Comparecimento</dt>
              <dd className="font-medium text-stone-800">
                {showRate === null ? "sem dados no período" : `${showRate}%`}
                {finished > 0 ? (
                  <span className="ml-1.5 text-xs font-normal text-stone-400">
                    ({data.showed} de {finished})
                  </span>
                ) : null}
              </dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-stone-600">Faltas</dt>
              <dd className="font-medium text-stone-800">{data.noShow}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-stone-600">Cancelamentos</dt>
              <dd className="font-medium text-stone-800">{data.cancelled}</dd>
            </div>
            <div className="flex items-center justify-between border-t border-stone-100 pt-2.5">
              <dt className="text-stone-600">Orçamentos aceitos</dt>
              <dd className="font-medium text-stone-800">
                {quoteRate === null
                  ? "nenhum enviado no período"
                  : `${quoteRate}% (${data.quotesAccepted} de ${data.quotesSent})`}
              </dd>
            </div>
          </dl>
        </section>

        <section className="rounded-xl border border-stone-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-stone-700">
            Procedimentos mais realizados
          </h2>
          {data.topProcedures.length === 0 ? (
            <p className="mt-3 text-sm text-stone-500">
              Nenhum atendimento realizado no período ainda.
            </p>
          ) : (
            <ul className="mt-3 space-y-2.5">
              {data.topProcedures.map((p) => (
                <li key={p.name}>
                  <div className="flex items-baseline justify-between text-sm">
                    <span className="text-stone-700">{p.name}</span>
                    <span className="text-xs text-stone-500">
                      {p.count}× · {formatBRL(p.total ?? "0")}
                    </span>
                  </div>
                  <div className="mt-1 h-2 rounded-full bg-stone-100">
                    <div
                      className="h-2 rounded-full bg-teal-500"
                      style={{ width: `${(p.count / maxProcCount) * 100}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="mt-4 max-w-4xl rounded-xl border border-stone-200 bg-white p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-stone-700">
            Clientes para reativar
          </h2>
          <Link
            href="/inteligencia"
            className="text-xs text-teal-700 underline-offset-2 hover:underline"
          >
            ver análise completa →
          </Link>
        </div>
        {data.reactivations.length === 0 ? (
          <p className="mt-3 text-sm text-stone-500">
            Ninguém precisando de reativação — ou a análise ainda não foi calculada na
            página Inteligência.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-stone-100">
            {data.reactivations.map((r) => (
              <li key={r.customerId} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-stone-800">{r.name}</p>
                  {r.action ? (
                    <p className="truncate text-xs text-stone-500">{r.action}</p>
                  ) : null}
                </div>
                <PrepareMessageButton customerId={r.customerId} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
