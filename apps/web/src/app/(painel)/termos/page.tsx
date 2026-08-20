import { desc, eq } from "drizzle-orm";
import Link from "next/link";
import { can } from "@clinicaos/core/permissions";
import { schema, withTenant } from "@clinicaos/db";
import { EmptyState } from "@/components/ui";
import { requireAuth } from "@/lib/auth-action";
import { GenerateTermButton, TemplateFormButton, TermRowActions } from "./terms-client";

export const metadata = { title: "Termos" };

type Tab = "modelos" | "enviados";

function fmtDateTime(d: Date | null): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  }).format(d);
}

export default async function TermosPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const auth = await requireAuth();
  if (!auth.clinicId || !auth.role) return null;

  if (!can(auth.role, "terms.manage")) {
    return (
      <div className="p-8">
        <h1 className="text-xl font-semibold text-stone-800">Termos de Consentimento</h1>
        <div className="mt-6">
          <EmptyState title="Os termos são gerenciados pela administradora ou gestora." />
        </div>
      </div>
    );
  }

  const sp = await searchParams;
  const tab: Tab = sp.tab === "enviados" ? "enviados" : "modelos";

  const { templates, sent, procedures } = await withTenant(
    auth.clinicId,
    async (tx) => {
      const templates = await tx
        .select()
        .from(schema.documentTemplates)
        .orderBy(desc(schema.documentTemplates.createdAt));
      const sent = await tx
        .select({
          id: schema.documents.id,
          title: schema.documents.title,
          status: schema.documents.status,
          sentAt: schema.documents.sentAt,
          viewedAt: schema.documents.viewedAt,
          signedAt: schema.documents.signedAt,
          pdfPath: schema.documents.pdfPath,
          signToken: schema.documents.signToken,
          customerName: schema.customers.fullName,
        })
        .from(schema.documents)
        .innerJoin(schema.customers, eq(schema.customers.id, schema.documents.customerId))
        .orderBy(desc(schema.documents.createdAt))
        .limit(100);
      const procedures = await tx
        .select({
          id: schema.procedures.id,
          name: schema.procedures.name,
          price: schema.procedures.price,
        })
        .from(schema.procedures)
        .where(eq(schema.procedures.active, true))
        .orderBy(schema.procedures.name);
      return { templates, sent, procedures };
    },
    auth.userId,
  );

  const activeTemplates = templates.filter((t) => t.active);
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";

  return (
    <div className="p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-stone-800">Termos de Consentimento</h1>
          <p className="mt-0.5 text-sm text-stone-500">
            Crie modelos, envie pelo WhatsApp e acompanhe as assinaturas.
          </p>
        </div>
        <div className="flex gap-2">
          <TemplateFormButton />
          <GenerateTermButton
            templates={activeTemplates.map((t) => ({ id: t.id, name: t.name }))}
            procedures={procedures.map((p) => ({
              id: p.id,
              name: p.name,
              price: Number(p.price).toFixed(2).replace(".", ","),
            }))}
          />
        </div>
      </div>

      <div className="mt-5 flex gap-1 border-b border-stone-200">
        {(
          [
            ["modelos", "Modelos"],
            ["enviados", "Enviados"],
          ] as const
        ).map(([key, label]) => (
          <Link
            key={key}
            href={`/termos?tab=${key}`}
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

      <div className="mt-6">
        {tab === "modelos" ? (
          templates.length === 0 ? (
            <EmptyState
              title="Crie seu primeiro modelo de termo. Na hora de enviar, o sistema preenche nome, CPF, procedimento e valor sozinho."
              action={<TemplateFormButton />}
            />
          ) : (
            <div className="max-w-3xl space-y-3">
              {templates.map((t) => (
                <div key={t.id} className="rounded-xl border border-stone-200 bg-white p-5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-stone-800">{t.name}</p>
                      <p className="mt-0.5 line-clamp-2 max-w-xl text-xs text-stone-500">
                        {t.bodyText.slice(0, 180)}...
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {t.active ? (
                        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                          Ativo
                        </span>
                      ) : (
                        <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-500">
                          Inativo
                        </span>
                      )}
                      <TemplateFormButton
                        initial={{ id: t.id, name: t.name, bodyText: t.bodyText, active: t.active }}
                      />
                    </div>
                  </div>
                </div>
              ))}
              <p className="text-xs text-stone-400">
                ⚠ Revise os modelos com o responsável técnico da clínica antes de usar.
              </p>
            </div>
          )
        ) : sent.length === 0 ? (
          <EmptyState title='Nenhum termo enviado ainda. Use "Gerar e enviar" — a cliente recebe o link no WhatsApp e assina pelo celular.' />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-stone-200 text-left text-xs uppercase tracking-wide text-stone-400">
                  <th className="px-4 py-3 font-medium">Cliente</th>
                  <th className="px-4 py-3 font-medium">Documento</th>
                  <th className="px-4 py-3 font-medium">Enviado</th>
                  <th className="px-4 py-3 font-medium">Visualizado</th>
                  <th className="px-4 py-3 font-medium">Assinado</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {sent.map((d) => (
                  <tr key={d.id} className="border-b border-stone-100 last:border-0">
                    <td className="px-4 py-3 font-medium text-stone-800">{d.customerName}</td>
                    <td className="px-4 py-3 text-stone-600">{d.title}</td>
                    <td className="px-4 py-3 text-stone-600">✓ {fmtDateTime(d.sentAt)}</td>
                    <td className="px-4 py-3 text-stone-600">
                      {d.viewedAt ? `✓ ${fmtDateTime(d.viewedAt)}` : "—"}
                    </td>
                    <td className="px-4 py-3">
                      {d.signedAt ? (
                        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                          ✓ {fmtDateTime(d.signedAt)}
                        </span>
                      ) : d.status === "expired" ? (
                        <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-500">
                          Expirado
                        </span>
                      ) : (
                        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                          Aguardando
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <TermRowActions
                        id={d.id}
                        status={d.status}
                        hasPdf={Boolean(d.pdfPath)}
                        signUrl={`${appUrl}/assinar/${d.signToken}`}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
