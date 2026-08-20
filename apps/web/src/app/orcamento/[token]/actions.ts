"use server";

import { and, eq, inArray } from "drizzle-orm";
import { adoptClinic, schema, withContext } from "@clinicaos/db";
import { todayISO } from "@clinicaos/core/timezone";

/** Aceite público do orçamento — autenticado pelo próprio token do link. */
export async function acceptQuote(token: string): Promise<{ ok: boolean; error?: string }> {
  if (typeof token !== "string" || token.length < 20) {
    return { ok: false, error: "Link inválido." };
  }

  return withContext({ quoteToken: token }, async (tx) => {
    const quote = (
      await tx
        .select()
        .from(schema.quotes)
        .where(eq(schema.quotes.publicToken, token))
        .limit(1)
    )[0];
    if (!quote) return { ok: false, error: "Link inválido." };
    if (quote.status === "accepted") return { ok: true };
    if (!["sent", "viewed"].includes(quote.status)) {
      return { ok: false, error: "Este orçamento não está mais disponível." };
    }
    if (quote.validUntil < todayISO("America/Sao_Paulo")) {
      return { ok: false, error: "Este orçamento venceu — peça um novo para a clínica." };
    }

    await adoptClinic(tx, quote.clinicId);

    const claimed = await tx
      .update(schema.quotes)
      .set({ status: "accepted", acceptedAt: new Date() })
      .where(
        and(
          eq(schema.quotes.id, quote.id),
          inArray(schema.quotes.status, ["sent", "viewed"]),
        ),
      )
      .returning({ id: schema.quotes.id });
    if (!claimed[0]) return { ok: true };

    // Avisa a equipe: aceite é oportunidade quente
    const customer = (
      await tx
        .select({ fullName: schema.customers.fullName })
        .from(schema.customers)
        .where(eq(schema.customers.id, quote.customerId))
        .limit(1)
    )[0];
    await tx.insert(schema.notifications).values({
      clinicId: quote.clinicId,
      type: "quote_accepted",
      title: `${customer?.fullName ?? "Cliente"} aceitou o orçamento #${quote.number}! 🎉`,
      body: "Converta em venda e combine o agendamento.",
      refTable: "quotes",
      refId: quote.id,
    });

    return { ok: true };
  });
}
