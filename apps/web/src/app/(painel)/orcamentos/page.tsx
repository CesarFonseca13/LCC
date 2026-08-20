import { desc, eq } from "drizzle-orm";
import { can } from "@clinicaos/core/permissions";
import { todayISO } from "@clinicaos/core/timezone";
import { schema, withTenant } from "@clinicaos/db";
import { EmptyState } from "@/components/ui";
import { requireAuth } from "@/lib/auth-action";
import { formatBRL } from "@/lib/format";
import { CreateQuoteButton, QuoteRowActions } from "./quotes-client";

export const metadata = { title: "Orçamentos" };

function fmtDate(d: string): string {
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
}

export default async function OrcamentosPage() {
  const auth = await requireAuth();
  if (!auth.clinicId || !auth.role) return null;

  if (!can(auth.role, "quotes.manage")) {
    return (
      <div className="p-8">
        <h1 className="text-xl font-semibold text-stone-800">Orçamentos</h1>
        <div className="mt-6">
          <EmptyState title="Os orçamentos são gerenciados pela administradora, gestora ou recepção." />
        </div>
      </div>
    );
  }

  const { quotes, procedures, packages } = await withTenant(
    auth.clinicId,
    async (tx) => {
      const quotes = await tx
        .select({
          id: schema.quotes.id,
          number: schema.quotes.number,
          status: schema.quotes.status,
          total: schema.quotes.total,
          validUntil: schema.quotes.validUntil,
          viewedAt: schema.quotes.viewedAt,
          convertedAt: schema.quotes.convertedAt,
          publicToken: schema.quotes.publicToken,
          customerName: schema.customers.fullName,
        })
        .from(schema.quotes)
        .innerJoin(schema.customers, eq(schema.customers.id, schema.quotes.customerId))
        .orderBy(desc(schema.quotes.createdAt))
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
      const packages = await tx
        .select({
          id: schema.packages.id,
          name: schema.packages.name,
          price: schema.packages.price,
        })
        .from(schema.packages)
        .where(eq(schema.packages.active, true))
        .orderBy(schema.packages.name);
      return { quotes, procedures, packages };
    },
    auth.userId,
  );

  const hoje = todayISO("America/Sao_Paulo");
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";

  const STATUS_CHIP: Record<string, { label: string; className: string }> = {
    sent: { label: "Enviado", className: "bg-sky-50 text-sky-700" },
    viewed: { label: "Visualizado", className: "bg-amber-50 text-amber-700" },
    accepted: { label: "Aceito", className: "bg-emerald-50 text-emerald-700" },
    rejected: { label: "Recusado", className: "bg-red-50 text-red-700" },
    expired: { label: "Expirado", className: "bg-stone-100 text-stone-500" },
  };

  return (
    <div className="p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-stone-800">Orçamentos</h1>
          <p className="mt-0.5 text-sm text-stone-500">
            Envie uma proposta bonita pelo WhatsApp — e saiba quando a cliente visualizou.
          </p>
        </div>
        <CreateQuoteButton
          procedures={procedures.map((p) => ({
            id: p.id,
            name: p.name,
            price: Number(p.price).toFixed(2).replace(".", ","),
          }))}
          packages={packages.map((p) => ({
            id: p.id,
            name: p.name,
            price: Number(p.price).toFixed(2).replace(".", ","),
          }))}
        />
      </div>

      <div className="mt-6">
        {quotes.length === 0 ? (
          <EmptyState
            title="Crie seu primeiro orçamento — a cliente recebe o link no WhatsApp, vê os valores com a marca da clínica e aceita com um toque."
            action={
              <CreateQuoteButton
                procedures={procedures.map((p) => ({
                  id: p.id,
                  name: p.name,
                  price: Number(p.price).toFixed(2).replace(".", ","),
                }))}
                packages={packages.map((p) => ({
                  id: p.id,
                  name: p.name,
                  price: Number(p.price).toFixed(2).replace(".", ","),
                }))}
              />
            }
          />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-stone-200 text-left text-xs uppercase tracking-wide text-stone-400">
                  <th className="px-4 py-3 font-medium">Nº</th>
                  <th className="px-4 py-3 font-medium">Cliente</th>
                  <th className="px-4 py-3 font-medium">Total</th>
                  <th className="px-4 py-3 font-medium">Válido até</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {quotes.map((q) => {
                  const expired =
                    ["sent", "viewed"].includes(q.status) && q.validUntil < hoje;
                  const chip = expired
                    ? STATUS_CHIP.expired!
                    : (STATUS_CHIP[q.status] ?? STATUS_CHIP.sent!);
                  return (
                    <tr key={q.id} className="border-b border-stone-100 last:border-0">
                      <td className="px-4 py-3 font-medium text-stone-800">#{q.number}</td>
                      <td className="px-4 py-3 text-stone-700">{q.customerName}</td>
                      <td className="px-4 py-3 text-stone-800">{formatBRL(q.total)}</td>
                      <td className="px-4 py-3 text-stone-600">{fmtDate(q.validUntil)}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${chip.className}`}
                        >
                          {chip.label}
                        </span>
                        {q.convertedAt ? (
                          <span className="ml-1.5 rounded-full bg-teal-600 px-2 py-0.5 text-xs font-medium text-white">
                            Venda ✓
                          </span>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <QuoteRowActions
                          id={q.id}
                          status={expired ? "expired" : q.status}
                          converted={Boolean(q.convertedAt)}
                          quoteUrl={`${appUrl}/orcamento/${q.publicToken}`}
                        />
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
