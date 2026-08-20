import { and, asc, eq } from "drizzle-orm";
import { adoptClinic, schema, withContext } from "@clinicaos/db";
import { todayISO } from "@clinicaos/core/timezone";
import { AcceptQuoteButton } from "./accept-button";

export const metadata = { title: "Orçamento" };

function brl(v: string): string {
  return Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default async function OrcamentoPublicoPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const data = await withContext({ quoteToken: token }, async (tx) => {
    const quote = (
      await tx
        .select()
        .from(schema.quotes)
        .where(eq(schema.quotes.publicToken, token))
        .limit(1)
    )[0];
    if (!quote) return null;

    await adoptClinic(tx, quote.clinicId);
    const clinic = (
      await tx
        .select({ name: schema.clinics.name })
        .from(schema.clinics)
        .where(eq(schema.clinics.id, quote.clinicId))
        .limit(1)
    )[0];
    const customer = (
      await tx
        .select({ fullName: schema.customers.fullName })
        .from(schema.customers)
        .where(eq(schema.customers.id, quote.customerId))
        .limit(1)
    )[0];
    const items = await tx
      .select()
      .from(schema.quoteItems)
      .where(eq(schema.quoteItems.quoteId, quote.id))
      .orderBy(asc(schema.quoteItems.description));

    const expired =
      ["sent", "viewed"].includes(quote.status) &&
      quote.validUntil < todayISO("America/Sao_Paulo");

    // Primeira abertura marca "Visualizado"
    if (quote.status === "sent" && !expired) {
      await tx
        .update(schema.quotes)
        .set({ status: "viewed", viewedAt: new Date() })
        .where(and(eq(schema.quotes.id, quote.id), eq(schema.quotes.status, "sent")));
    }

    return {
      number: quote.number,
      status: expired ? "expired" : quote.status === "sent" ? "viewed" : quote.status,
      validUntil: quote.validUntil,
      subtotal: quote.subtotal,
      discount: quote.discountAmount,
      total: quote.total,
      notes: quote.notes,
      clinicName: clinic?.name ?? "Clínica",
      customerFirstName: customer?.fullName.split(" ")[0] ?? "",
      items: items.map((i) => ({
        id: i.id,
        description: i.description,
        kind: i.kind,
        quantity: i.quantity,
        total: i.total,
      })),
    };
  });

  if (!data) {
    return (
      <Shell clinicName="">
        <p className="text-center text-stone-600">
          Link inválido. Peça para a clínica enviar o orçamento novamente.
        </p>
      </Shell>
    );
  }

  const [y, m, d] = data.validUntil.split("-");

  return (
    <Shell clinicName={data.clinicName}>
      <p className="text-center text-sm text-stone-500">
        Oi{data.customerFirstName ? `, ${data.customerFirstName}` : ""}! Aqui está o seu
        orçamento:
      </p>
      <h1 className="mt-1 text-center text-lg font-semibold text-stone-800">
        Orçamento #{data.number}
      </h1>

      <div className="mt-5 overflow-hidden rounded-xl border border-stone-200">
        <table className="w-full text-sm">
          <tbody>
            {data.items.map((item) => (
              <tr key={item.id} className="border-b border-stone-100 last:border-0">
                <td className="px-4 py-3 text-stone-700">
                  {item.kind === "package" ? "📦 " : ""}
                  {item.description}
                  {item.quantity > 1 ? ` × ${item.quantity}` : ""}
                </td>
                <td className="px-4 py-3 text-right font-medium text-stone-800">
                  {brl(item.total)}
                </td>
              </tr>
            ))}
            {Number(data.discount) > 0 ? (
              <tr className="border-b border-stone-100">
                <td className="px-4 py-3 text-emerald-700">Desconto especial</td>
                <td className="px-4 py-3 text-right font-medium text-emerald-700">
                  − {brl(data.discount)}
                </td>
              </tr>
            ) : null}
            <tr className="bg-stone-50">
              <td className="px-4 py-3 font-semibold text-stone-800">Total</td>
              <td className="px-4 py-3 text-right text-lg font-bold text-teal-800">
                {brl(data.total)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {data.notes ? (
        <p className="mt-3 rounded-lg bg-stone-50 px-4 py-3 text-sm text-stone-600">
          {data.notes}
        </p>
      ) : null}

      <div className="mt-5">
        {data.status === "accepted" ? (
          <div className="rounded-lg bg-emerald-50 px-4 py-4 text-center">
            <p className="text-sm font-medium text-emerald-700">
              ✅ Orçamento aceito! A {data.clinicName} já foi avisada e vai falar com você
              para combinar os detalhes. 💛
            </p>
          </div>
        ) : data.status === "rejected" ? (
          <p className="text-center text-sm text-stone-500">
            Este orçamento foi recusado. Se mudou de ideia, é só chamar a clínica!
          </p>
        ) : data.status === "expired" ? (
          <p className="text-center text-sm text-stone-500">
            Este orçamento venceu em {d}/{m}/{y} — fale com a clínica para gerar um novo. 💛
          </p>
        ) : (
          <>
            <AcceptQuoteButton token={token} />
            <p className="mt-2 text-center text-xs text-stone-400">
              Válido até {d}/{m}/{y}
            </p>
          </>
        )}
      </div>
    </Shell>
  );
}

function Shell({
  clinicName,
  children,
}: {
  clinicName: string;
  children: React.ReactNode;
}) {
  return (
    <main className="min-h-screen bg-stone-100 px-4 py-8">
      <div className="mx-auto max-w-md">
        {clinicName ? (
          <p className="mb-4 text-center text-sm font-semibold uppercase tracking-wide text-teal-800">
            {clinicName}
          </p>
        ) : null}
        <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
          {children}
        </div>
      </div>
    </main>
  );
}

