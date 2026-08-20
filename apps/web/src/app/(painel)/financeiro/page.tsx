import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import Link from "next/link";
import { can } from "@clinicaos/core/permissions";
import { addDaysISO, todayISO } from "@clinicaos/core/timezone";
import { schema, withTenant } from "@clinicaos/db";
import { EmptyState } from "@/components/ui";
import { requireAuth } from "@/lib/auth-action";
import { formatBRL } from "@/lib/format";
import { PayableFormButton, PayButton, ReceiveButton } from "./finance-client";

export const metadata = { title: "Financeiro" };

type Tab = "geral" | "receber" | "despesas";

function monthRange(monthISO: string): { start: string; end: string } {
  const [y, m] = monthISO.split("-").map(Number);
  const start = `${monthISO}-01`;
  const nextMonth = m === 12 ? `${y! + 1}-01` : `${y}-${String(m! + 1).padStart(2, "0")}`;
  return { start, end: addDaysISO(`${nextMonth}-01`, -1) };
}

function fmtDate(d: string): string {
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
}

export default async function FinanceiroPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; m?: string }>;
}) {
  const auth = await requireAuth();
  if (!auth.clinicId || !auth.role) return null;

  if (!can(auth.role, "finance.read")) {
    return (
      <div className="p-8">
        <h1 className="text-xl font-semibold text-stone-800">Financeiro</h1>
        <div className="mt-6">
          <EmptyState title="O financeiro é visível apenas para a administradora e a gestora." />
        </div>
      </div>
    );
  }

  const sp = await searchParams;
  const tab: Tab = sp.tab === "receber" ? "receber" : sp.tab === "despesas" ? "despesas" : "geral";
  const hoje = todayISO("America/Sao_Paulo");
  const monthISO = /^\d{4}-\d{2}$/.test(sp.m ?? "") ? sp.m! : hoje.slice(0, 7);
  const { start, end } = monthRange(monthISO);

  const data = await withTenant(
    auth.clinicId,
    async (tx) => {
      const received = (
        await tx
          .select({ total: sql<string | null>`sum(net_amount)` })
          .from(schema.receivables)
          .where(
            and(
              eq(schema.receivables.status, "received"),
              gte(schema.receivables.receivedAt, start),
              lte(schema.receivables.receivedAt, end),
            ),
          )
      )[0];
      const pending = (
        await tx
          .select({ total: sql<string | null>`sum(net_amount)`, count: sql<number>`count(*)::int` })
          .from(schema.receivables)
          .where(eq(schema.receivables.status, "pending"))
      )[0];
      const expensesPaid = (
        await tx
          .select({ total: sql<string | null>`sum(amount)` })
          .from(schema.payables)
          .where(
            and(
              eq(schema.payables.status, "paid"),
              gte(schema.payables.paidAt, start),
              lte(schema.payables.paidAt, end),
            ),
          )
      )[0];

      const receivablesList = await tx
        .select({
          id: schema.receivables.id,
          description: schema.receivables.description,
          netAmount: schema.receivables.netAmount,
          dueDate: schema.receivables.dueDate,
          status: schema.receivables.status,
          method: schema.receivables.method,
          receivedAt: schema.receivables.receivedAt,
        })
        .from(schema.receivables)
        .where(sql`${schema.receivables.status} <> 'cancelled'`)
        .orderBy(desc(schema.receivables.dueDate))
        .limit(100);

      const payablesList = await tx
        .select({
          id: schema.payables.id,
          description: schema.payables.description,
          supplier: schema.payables.supplier,
          amount: schema.payables.amount,
          dueDate: schema.payables.dueDate,
          status: schema.payables.status,
          categoryName: sql<string | null>`(SELECT name FROM finance_categories fc WHERE fc.id = payables.category_id)`,
        })
        .from(schema.payables)
        .where(sql`${schema.payables.status} <> 'cancelled'`)
        .orderBy(desc(schema.payables.dueDate))
        .limit(100);

      return {
        received: received?.total ?? "0",
        pendingTotal: pending?.total ?? "0",
        pendingCount: pending?.count ?? 0,
        expenses: expensesPaid?.total ?? "0",
        receivablesList,
        payablesList,
      };
    },
    auth.userId,
  );

  const canWrite = can(auth.role, "finance.write");
  const saldo = Number(data.received ?? 0) - Number(data.expenses ?? 0);
  const [y, m] = monthISO.split("-").map(Number);
  const prevMonth = m === 1 ? `${y! - 1}-12` : `${y}-${String(m! - 1).padStart(2, "0")}`;
  const nextMonth = m === 12 ? `${y! + 1}-01` : `${y}-${String(m! + 1).padStart(2, "0")}`;
  const monthLabel = new Intl.DateTimeFormat("pt-BR", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${monthISO}-15T12:00:00Z`));

  const cards = [
    { label: "Recebido no mês", value: formatBRL(data.received), tone: "text-emerald-700" },
    {
      label: `A receber (${data.pendingCount})`,
      value: formatBRL(data.pendingTotal),
      tone: "text-amber-700",
    },
    { label: "Despesas pagas no mês", value: formatBRL(data.expenses), tone: "text-red-600" },
    { label: "Saldo do mês", value: formatBRL(saldo), tone: saldo >= 0 ? "text-teal-700" : "text-red-600" },
  ];

  return (
    <div className="p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-stone-800">Financeiro</h1>
          <p className="mt-0.5 text-sm text-stone-500">
            Entrou, vai entrar, saiu — as contas nascem sozinhas quando você marca
            “Compareceu”.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/financeiro?tab=${tab}&m=${prevMonth}`}
            className="rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-sm text-stone-600 hover:bg-stone-50"
          >
            ←
          </Link>
          <span className="min-w-36 text-center text-sm font-medium capitalize text-stone-700">
            {monthLabel}
          </span>
          <Link
            href={`/financeiro?tab=${tab}&m=${nextMonth}`}
            className="rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-sm text-stone-600 hover:bg-stone-50"
          >
            →
          </Link>
        </div>
      </div>

      <section className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {cards.map((card) => (
          <div key={card.label} className="rounded-xl border border-stone-200 bg-white p-4">
            <p className="text-sm text-stone-500">{card.label}</p>
            <p className={`mt-1 text-xl font-semibold ${card.tone}`}>{card.value}</p>
          </div>
        ))}
      </section>

      <div className="mt-6 flex items-center justify-between gap-2 border-b border-stone-200">
        <div className="flex gap-1">
          {(
            [
              ["geral", "Visão geral"],
              ["receber", "A receber"],
              ["despesas", "Despesas"],
            ] as const
          ).map(([key, label]) => (
            <Link
              key={key}
              href={`/financeiro?tab=${key}&m=${monthISO}`}
              className={
                tab === key
                  ? "border-b-2 border-teal-700 px-4 py-2 text-sm font-medium text-teal-800"
                  : "border-b-2 border-transparent px-4 py-2 text-sm text-stone-500 hover:text-stone-800"
              }
            >
              {label}
            </Link>
          ))}
        </div>
        {tab === "despesas" && canWrite ? <PayableFormButton /> : null}
      </div>

      <div className="mt-6">
        {tab === "despesas" ? (
          data.payablesList.length === 0 ? (
            <EmptyState
              title="Lance suas despesas fixas (aluguel, materiais...) para enxergar o saldo real do mês."
              action={canWrite ? <PayableFormButton /> : undefined}
            />
          ) : (
            <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-stone-200 text-left text-xs uppercase tracking-wide text-stone-400">
                    <th className="px-4 py-3 font-medium">Vencimento</th>
                    <th className="px-4 py-3 font-medium">Descrição</th>
                    <th className="px-4 py-3 font-medium">Categoria</th>
                    <th className="px-4 py-3 font-medium">Valor</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    {canWrite ? <th className="px-4 py-3" /> : null}
                  </tr>
                </thead>
                <tbody>
                  {data.payablesList.map((p) => {
                    const overdue = p.status === "pending" && p.dueDate < hoje;
                    return (
                      <tr key={p.id} className="border-b border-stone-100 last:border-0">
                        <td className="px-4 py-3 text-stone-600">{fmtDate(p.dueDate)}</td>
                        <td className="px-4 py-3">
                          <span className="font-medium text-stone-800">{p.description}</span>
                          {p.supplier ? (
                            <span className="block text-xs text-stone-400">{p.supplier}</span>
                          ) : null}
                        </td>
                        <td className="px-4 py-3 text-stone-600">{p.categoryName ?? "—"}</td>
                        <td className="px-4 py-3 text-stone-800">{formatBRL(p.amount)}</td>
                        <td className="px-4 py-3">
                          {p.status === "paid" ? (
                            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                              Paga
                            </span>
                          ) : overdue ? (
                            <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">
                              Vencida
                            </span>
                          ) : (
                            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                              A pagar
                            </span>
                          )}
                        </td>
                        {canWrite ? (
                          <td className="px-4 py-3 text-right">
                            {p.status === "pending" ? <PayButton id={p.id} /> : null}
                          </td>
                        ) : null}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )
        ) : (
          <ReceivablesTable
            list={
              tab === "receber"
                ? data.receivablesList.filter((r) => r.status === "pending")
                : data.receivablesList
            }
            hoje={hoje}
            canWrite={canWrite}
            emptyText={
              tab === "receber"
                ? "Nada a receber no momento. Quando você marcar “Compareceu” na agenda, o valor do atendimento entra aqui."
                : "Seu financeiro se preenche sozinho: marque “Compareceu” na agenda e o valor do atendimento aparece aqui como “a receber”."
            }
          />
        )}
      </div>
    </div>
  );
}

function ReceivablesTable({
  list,
  hoje,
  canWrite,
  emptyText,
}: {
  list: {
    id: string;
    description: string;
    netAmount: string;
    dueDate: string;
    status: string;
    method: string | null;
    receivedAt: string | null;
  }[];
  hoje: string;
  canWrite: boolean;
  emptyText: string;
}) {
  const METHOD_LABEL: Record<string, string> = {
    cash: "Dinheiro",
    pix: "Pix",
    debit: "Débito",
    credit: "Crédito",
    transfer: "Transferência",
    boleto: "Boleto",
  };
  if (list.length === 0) return <EmptyState title={emptyText} />;
  return (
    <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-stone-200 text-left text-xs uppercase tracking-wide text-stone-400">
            <th className="px-4 py-3 font-medium">Data</th>
            <th className="px-4 py-3 font-medium">Descrição</th>
            <th className="px-4 py-3 font-medium">Valor</th>
            <th className="px-4 py-3 font-medium">Status</th>
            {canWrite ? <th className="px-4 py-3" /> : null}
          </tr>
        </thead>
        <tbody>
          {list.map((r) => {
            const overdue = r.status === "pending" && r.dueDate < hoje;
            return (
              <tr key={r.id} className="border-b border-stone-100 last:border-0">
                <td className="px-4 py-3 text-stone-600">{fmtDate(r.dueDate)}</td>
                <td className="px-4 py-3 font-medium text-stone-800">{r.description}</td>
                <td className="px-4 py-3 text-stone-800">{formatBRL(r.netAmount)}</td>
                <td className="px-4 py-3">
                  {r.status === "received" ? (
                    <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                      Recebida{r.method ? ` · ${METHOD_LABEL[r.method] ?? r.method}` : ""}
                    </span>
                  ) : overdue ? (
                    <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">
                      Vencida
                    </span>
                  ) : (
                    <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                      A receber
                    </span>
                  )}
                </td>
                {canWrite ? (
                  <td className="px-4 py-3 text-right">
                    {r.status === "pending" ? <ReceiveButton id={r.id} /> : null}
                  </td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
