import Link from "next/link";
import { formatBrl } from "@clinicaos/core/spend";
import { currentMonth, invoiceForMonth, lastMonths, monthLabel, requireSuperadmin } from "@/lib/admin";

export default async function AdminFinanceiro({ searchParams }: { searchParams: Promise<{ mes?: string }> }) {
  await requireSuperadmin();
  const sp = await searchParams;
  const months = lastMonths(6);
  const month = sp.mes && /^\d{4}-\d{2}$/.test(sp.mes) ? sp.mes : currentMonth();
  const lines = await invoiceForMonth(month);
  const billable = lines.filter((l) => !l.isDemo && l.status === "active");
  const sum = (f: (l: (typeof lines)[number]) => number) => billable.reduce((a, l) => a + f(l), 0);
  const totalApi = lines.reduce((a, l) => a + l.spendBrl, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-stone-900">Financeiro · {monthLabel(month)}</h1>
        <nav className="flex flex-wrap gap-1">
          {months.map((m) => (
            <Link
              key={m}
              href={`/admin/financeiro?mes=${m}`}
              className={`rounded-lg px-3 py-1.5 text-sm ${m === month ? "bg-stone-900 text-white" : "bg-white text-stone-700 ring-1 ring-stone-200 hover:bg-stone-50"}`}
            >
              {monthLabel(m)}
            </Link>
          ))}
        </nav>
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        <Card label="Mensalidades" value={formatBrl(sum((l) => l.monthlyBrl))} />
        <Card label="Excedente de API a cobrar" value={formatBrl(sum((l) => l.overageChargeBrl))} hint="com 20%" />
        <Card label="Total a faturar" value={formatBrl(sum((l) => l.totalBrl))} strong />
        <Card label="Custo de API (seu)" value={formatBrl(totalApi)} hint="IA + Meta, incluindo demo" />
      </div>

      <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
            <tr>
              <th className="px-4 py-2">Clínica</th>
              <th className="px-4 py-2">Plano</th>
              <th className="px-4 py-2 text-right">Mensalidade</th>
              <th className="px-4 py-2 text-right">Gasto API</th>
              <th className="px-4 py-2 text-right">Franquia</th>
              <th className="px-4 py-2 text-right">Excedente</th>
              <th className="px-4 py-2 text-right">Total</th>
              <th className="px-4 py-2">Uso</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => {
              const off = l.isDemo || l.status !== "active";
              return (
                <tr key={l.clinicId} className={`border-t border-stone-100 ${off ? "text-stone-400" : ""}`}>
                  <td className="px-4 py-2.5">
                    <Link href={`/admin/clinicas/${l.clinicId}`} className="font-medium hover:underline">{l.clinicName}</Link>
                    {l.isDemo ? <span className="ml-2 text-[10px] uppercase">demo</span> : null}
                    {l.status !== "active" ? <span className="ml-2 text-[10px] uppercase">{l.status}</span> : null}
                  </td>
                  <td className="px-4 py-2.5">{l.plan?.name ?? "—"}</td>
                  <td className="px-4 py-2.5 text-right">
                    {formatBrl(l.monthlyBrl)}
                    {l.customPrice ? <span className="ml-1 text-[10px]">neg.</span> : null}
                  </td>
                  <td className="px-4 py-2.5 text-right">{formatBrl(l.spendBrl)}</td>
                  <td className="px-4 py-2.5 text-right">{formatBrl(l.allowanceBrl)}</td>
                  <td className="px-4 py-2.5 text-right">
                    {l.overageChargeBrl > 0 ? formatBrl(l.overageChargeBrl) : l.spendBrl > l.allowanceBrl ? <span className="text-amber-700" title="Passou da franquia, mas não liberou excedente: ficou pausada">pausada</span> : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-right font-medium">{off ? "—" : formatBrl(l.totalBrl)}</td>
                  <td className="px-4 py-2.5 text-xs text-stone-500">{l.aiCalls} IA · {l.metaMessages} Meta</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-stone-400">
        Mensalidade = preço negociado ou preço do plano. Excedente = (gasto de API − franquia do plano) × 1,20, só para clínicas com &quot;permitir ultrapassar&quot; ligado. Demo e clínicas suspensas não entram nos totais. Os gastos de API são estimativas no momento do uso; confira com as faturas da OpenAI e da Meta.
      </p>
    </div>
  );
}

function Card({ label, value, hint, strong }: { label: string; value: string; hint?: string; strong?: boolean }) {
  return (
    <div className={`rounded-xl border p-4 ${strong ? "border-teal-200 bg-teal-50" : "border-stone-200 bg-white"}`}>
      <p className="text-xs text-stone-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${strong ? "text-teal-900" : "text-stone-900"}`}>{value}</p>
      {hint ? <p className="text-[11px] text-stone-400">{hint}</p> : null}
    </div>
  );
}
