import { sql } from "drizzle-orm";
import Link from "next/link";
import { parseClinicPlan } from "@clinicaos/core/plans";
import { formatBrl } from "@clinicaos/core/spend";
import { adminDb, schema } from "@clinicaos/db";
import { currentMonth, invoiceForMonth, isDemoClinic, monthLabel, requireSuperadmin } from "@/lib/admin";
import { DemoActions } from "./demo-actions";

export default async function AdminHome() {
  await requireSuperadmin();
  const db = adminDb();
  const month = currentMonth();
  const lines = await invoiceForMonth(month);
  const clinics = await db
    .select({
      id: schema.clinics.id,
      name: schema.clinics.name,
      status: schema.clinics.status,
      settings: schema.clinics.settings,
      createdAt: schema.clinics.createdAt,
      users: sql<number>`(SELECT count(*) FROM clinic_members m WHERE m.clinic_id = clinics.id AND m.active)::int`,
      customers: sql<number>`(SELECT count(*) FROM customers c WHERE c.clinic_id = clinics.id)::int`,
      lastMessageAt: sql<string | null>`(SELECT max(last_message_at)::text FROM conversations v WHERE v.clinic_id = clinics.id)`,
    })
    .from(schema.clinics)
    .orderBy(schema.clinics.createdAt);
  const instances = await db
    .select({
      clinicId: schema.whatsappInstances.clinicId,
      status: schema.whatsappInstances.status,
      provider: schema.whatsappInstances.provider,
      phone: schema.whatsappInstances.phoneE164,
      label: schema.whatsappInstances.label,
      verifiedName: schema.whatsappInstances.metaVerifiedName,
    })
    .from(schema.whatsappInstances);

  const byClinic = new Map(lines.map((l) => [l.clinicId, l]));
  const billable = lines.filter((l) => !l.isDemo && l.status === "active");
  const mrr = billable.reduce((a, l) => a + l.monthlyBrl, 0);
  const apiSpend = lines.reduce((a, l) => a + l.spendBrl, 0);
  const overage = billable.reduce((a, l) => a + l.overageChargeBrl, 0);
  const demo = clinics.find((c) => isDemoClinic(c.settings));
  const demoInstances = demo ? instances.filter((i) => i.clinicId === demo.id) : [];

  return (
    <div className="space-y-8">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Clínicas ativas (pagantes)" value={String(billable.length)} hint={`${clinics.length} no total`} />
        <Stat label={`Mensalidades · ${monthLabel(month)}`} value={formatBrl(mrr)} hint="sem demo, sem suspensas" />
        <Stat label="Gasto de API no mês" value={formatBrl(apiSpend)} hint="IA + Meta, todas as clínicas" />
        <Stat label="Excedente a cobrar" value={formatBrl(overage)} hint="já com 20%" />
      </div>

      {/* Demonstração */}
      <section className="rounded-xl border border-amber-200 bg-amber-50 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-amber-900">Demonstração ao vivo</h2>
            {demo ? (
              <>
                <p className="mt-1 text-sm text-amber-900">
                  Clínica <Link href={`/admin/clinicas/${demo.id}`} className="font-medium underline">{demo.name}</Link>. Use o número abaixo na prospecção; a Ana e o painel respondem como numa clínica real.
                </p>
                <ul className="mt-2 space-y-1 text-sm text-amber-900">
                  {demoInstances.length === 0 ? <li>Nenhum número conectado ainda. Conecte em Configurações → WhatsApp dentro da clínica.</li> : null}
                  {demoInstances.map((i, idx) => (
                    <li key={idx} className="flex flex-wrap items-center gap-2">
                      <span className={`inline-block h-2 w-2 rounded-full ${i.status === "connected" ? "bg-emerald-500" : "bg-red-500"}`} />
                      <span className="font-medium">{i.phone ?? "(sem número)"}</span>
                      <span className="text-xs text-amber-800">{i.verifiedName ?? i.label ?? ""} · {i.provider === "meta" ? "API oficial" : "QR code"} · {i.status}</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="mt-1 text-sm text-amber-900">
                Nenhuma clínica marcada como demonstração. Abra uma clínica e ligue &quot;Clínica de demonstração&quot;, ou crie uma nova com essa opção.
              </p>
            )}
          </div>
          {demo ? <DemoActions clinicId={demo.id} /> : null}
        </div>
      </section>

      {/* Clínicas */}
      <section>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">Clínicas</h2>
          <Link href="/admin/nova" className="rounded-lg bg-stone-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-stone-700">
            + Nova clínica
          </Link>
        </div>
        <div className="mt-3 overflow-x-auto rounded-xl border border-stone-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
              <tr>
                <th className="px-4 py-2">Clínica</th>
                <th className="px-4 py-2">Plano</th>
                <th className="px-4 py-2">Mensalidade</th>
                <th className="px-4 py-2">API no mês</th>
                <th className="px-4 py-2">WhatsApp</th>
                <th className="px-4 py-2">Equipe</th>
                <th className="px-4 py-2">Clientes</th>
                <th className="px-4 py-2">Última conversa</th>
              </tr>
            </thead>
            <tbody>
              {clinics.map((c) => {
                const plan = parseClinicPlan(c.settings);
                const line = byClinic.get(c.id);
                const inst = instances.filter((i) => i.clinicId === c.id);
                const connected = inst.filter((i) => i.status === "connected").length;
                return (
                  <tr key={c.id} className="border-t border-stone-100 hover:bg-stone-50">
                    <td className="px-4 py-2.5">
                      <Link href={`/admin/clinicas/${c.id}`} className="font-medium text-stone-800 hover:underline">
                        {c.name}
                      </Link>
                      <span className="ml-2 inline-flex gap-1">
                        {isDemoClinic(c.settings) ? <Tag tone="amber">demo</Tag> : null}
                        {c.status !== "active" ? <Tag tone="red">{c.status === "suspended" ? "suspensa" : "cancelada"}</Tag> : null}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">{plan?.name ?? <span className="text-stone-400">sem plano</span>}</td>
                    <td className="px-4 py-2.5">
                      {line ? formatBrl(line.monthlyBrl) : "—"}
                      {line?.customPrice ? <span className="ml-1 text-[11px] text-stone-400">negociada</span> : null}
                    </td>
                    <td className="px-4 py-2.5">
                      {line ? formatBrl(line.spendBrl) : "—"}
                      {line && line.spendBrl > line.allowanceBrl ? <span className="ml-1 text-[11px] text-amber-700">acima da franquia</span> : null}
                    </td>
                    <td className="px-4 py-2.5">
                      {inst.length === 0 ? (
                        <span className="text-stone-400">nenhum</span>
                      ) : (
                        <span className={connected > 0 ? "text-emerald-700" : "text-red-600"}>
                          {connected}/{inst.length} conectado{inst.length > 1 ? "s" : ""}
                          {inst.some((i) => i.provider === "meta") ? " · oficial" : ""}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">{c.users}</td>
                    <td className="px-4 py-2.5">{c.customers}</td>
                    <td className="px-4 py-2.5 text-stone-500">{c.lastMessageAt ? c.lastMessageAt.slice(0, 16).replace("T", " ") : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-4">
      <p className="text-xs text-stone-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-stone-900">{value}</p>
      {hint ? <p className="text-[11px] text-stone-400">{hint}</p> : null}
    </div>
  );
}

function Tag({ tone, children }: { tone: "amber" | "red"; children: React.ReactNode }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${tone === "amber" ? "bg-amber-100 text-amber-800" : "bg-red-100 text-red-700"}`}>
      {children}
    </span>
  );
}
