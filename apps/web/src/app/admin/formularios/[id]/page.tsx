import { eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { onboardingEntries, type OnbAnswers } from "@clinicaos/core/onboarding-form";
import { adminDb, schema } from "@clinicaos/db";
import { requireSuperadmin } from "@/lib/admin";
import { FormAdminActions } from "./form-admin-actions";

export const metadata = { title: "Formulário de implantação" };

/** Um formulário respondido, por extenso, com PDF e marcação de "configurada". */
export default async function AdminFormulario({ params }: { params: Promise<{ id: string }> }) {
  await requireSuperadmin();
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) notFound();
  const row = (
    await adminDb().select().from(schema.onboardingForms).where(eq(schema.onboardingForms.id, id)).limit(1)
  )[0];
  if (!row) notFound();
  const sections = onboardingEntries(row.answers as OnbAnswers);
  const received = row.createdAt.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });

  return (
    <div className="space-y-5">
      <div>
        <Link href="/admin/formularios" className="text-sm text-stone-500 hover:underline">
          ← Formulários
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-stone-900">{row.clinicName}</h1>
            <p className="mt-1 text-sm text-stone-500">
              {row.contactName ?? "—"} · {row.contactEmail ?? "—"} · WhatsApp {row.contactPhone ?? "—"}
              <span className="block">Recebido em {received} · protocolo {row.id.slice(0, 8)}</span>
            </p>
          </div>
          <FormAdminActions id={row.id} status={row.status} />
        </div>
      </div>

      {sections.map((sec) => (
        <section key={sec.id} className="rounded-xl border border-stone-200 bg-white">
          <h2 className="border-b border-stone-100 px-4 py-2.5 text-sm font-semibold text-teal-800">{sec.title}</h2>
          <dl className="divide-y divide-stone-100">
            {sec.entries.map((e) => (
              <div key={e.label} className="grid gap-1 px-4 py-2.5 text-sm sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] sm:gap-4">
                <dt className="font-medium text-stone-600">{e.label}</dt>
                <dd className="min-w-0 whitespace-pre-wrap break-words text-stone-800">
                  {e.items ? (
                    e.items.length === 0 ? (
                      <span className="italic text-stone-400">nenhum</span>
                    ) : (
                      <div className="space-y-2">
                        {e.items.map((it) => (
                          <div key={it.title} className="rounded-lg border border-stone-200 bg-stone-50 p-2.5">
                            <p className="font-semibold text-stone-800">{it.title}</p>
                            <dl className="mt-1 space-y-0.5">
                              {it.pairs.map((p) => (
                                <div key={p.label} className="grid gap-0.5 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] sm:gap-3">
                                  <dt className="text-xs text-stone-500">{p.label}</dt>
                                  <dd className="min-w-0 whitespace-pre-wrap break-words text-stone-800">{p.value}</dd>
                                </div>
                              ))}
                            </dl>
                          </div>
                        ))}
                      </div>
                    )
                  ) : e.value ? (
                    e.value
                  ) : (
                    <span className="italic text-stone-400">não respondido</span>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}
