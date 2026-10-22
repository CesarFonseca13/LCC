import { desc } from "drizzle-orm";
import Link from "next/link";
import { adminDb, schema } from "@clinicaos/db";
import { requireSuperadmin } from "@/lib/admin";

export const metadata = { title: "Formulários de implantação" };

function when(d: Date): string {
  return d.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** Lista dos formulários respondidos na página pública /form. */
export default async function AdminFormularios() {
  await requireSuperadmin();
  const rows = await adminDb()
    .select({
      id: schema.onboardingForms.id,
      clinicName: schema.onboardingForms.clinicName,
      contactName: schema.onboardingForms.contactName,
      contactPhone: schema.onboardingForms.contactPhone,
      contactEmail: schema.onboardingForms.contactEmail,
      status: schema.onboardingForms.status,
      createdAt: schema.onboardingForms.createdAt,
    })
    .from(schema.onboardingForms)
    .orderBy(desc(schema.onboardingForms.createdAt))
    .limit(300);
  const novos = rows.filter((r) => r.status === "new").length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-stone-900">Formulários de implantação</h1>
          <p className="mt-1 text-sm text-stone-500">
            Respostas da página pública <code className="rounded bg-stone-200 px-1">/form</code>. {novos} {novos === 1 ? "novo" : "novos"} para configurar.
          </p>
        </div>
        <a href="/form" target="_blank" rel="noreferrer" className="text-sm text-teal-700 underline-offset-2 hover:underline">
          Abrir a página do formulário
        </a>
      </div>
      <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
            <tr>
              <th className="px-4 py-2">Recebido</th>
              <th className="px-4 py-2">Clínica</th>
              <th className="px-4 py-2">Responsável</th>
              <th className="px-4 py-2">Contato</th>
              <th className="px-4 py-2">Situação</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-stone-400">
                  Nenhum formulário recebido ainda. Mande o link vesaliusx.com.br/form para a clínica.
                </td>
              </tr>
            ) : null}
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-stone-100 align-top">
                <td className="whitespace-nowrap px-4 py-2 text-stone-500">{when(r.createdAt)}</td>
                <td className="px-4 py-2 font-medium text-stone-800">
                  <Link href={`/admin/formularios/${r.id}`} className="hover:underline">
                    {r.clinicName}
                  </Link>
                </td>
                <td className="px-4 py-2">{r.contactName ?? "—"}</td>
                <td className="px-4 py-2 text-xs text-stone-500">
                  {r.contactPhone ?? "—"}
                  {r.contactEmail ? <span className="block">{r.contactEmail}</span> : null}
                </td>
                <td className="px-4 py-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${r.status === "new" ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"}`}>
                    {r.status === "new" ? "Novo" : "Configurada"}
                  </span>
                </td>
                <td className="whitespace-nowrap px-4 py-2 text-right">
                  <a href={`/admin/formularios/${r.id}/pdf`} className="text-teal-700 underline-offset-2 hover:underline">
                    Baixar PDF
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
