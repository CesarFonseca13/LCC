import { and, eq } from "drizzle-orm";
import { adoptClinic, schema, withContext } from "@clinicaos/db";
import { BookingFlow } from "./booking-flow";

export const metadata = { title: "Agendar horário" };

export default async function AgendarPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const data = await withContext({ bookingSlug: slug }, async (tx) => {
    const clinic = (
      await tx
        .select({ id: schema.clinics.id, name: schema.clinics.name })
        .from(schema.clinics)
        .where(eq(schema.clinics.bookingSlug, slug))
        .limit(1)
    )[0];
    if (!clinic) return null;

    await adoptClinic(tx, clinic.id);
    const procedures = await tx
      .select({
        id: schema.procedures.id,
        name: schema.procedures.name,
        durationMinutes: schema.procedures.durationMinutes,
        price: schema.procedures.price,
      })
      .from(schema.procedures)
      .where(and(eq(schema.procedures.clinicId, clinic.id), eq(schema.procedures.active, true)))
      .orderBy(schema.procedures.name);

    return { clinicName: clinic.name, procedures };
  }).catch(() => null);

  if (!data) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-stone-100 px-4">
        <p className="text-center text-stone-600">
          Agendamento online indisponível. Fale com a clínica pelo WhatsApp. 💛
        </p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-stone-100 px-4 py-8">
      <div className="mx-auto max-w-md">
        <p className="mb-1 text-center text-sm font-semibold uppercase tracking-wide text-teal-800">
          {data.clinicName}
        </p>
        <p className="mb-5 text-center text-sm text-stone-500">
          Agende seu horário em menos de 1 minuto
        </p>
        <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
          <BookingFlow
            slug={slug}
            procedures={data.procedures.map((p) => ({
              id: p.id,
              name: p.name,
              durationMinutes: p.durationMinutes,
              priceLabel: Number(p.price).toLocaleString("pt-BR", {
                style: "currency",
                currency: "BRL",
              }),
            }))}
          />
        </div>
      </div>
    </main>
  );
}
