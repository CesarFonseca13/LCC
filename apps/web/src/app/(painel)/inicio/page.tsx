import { and, asc, eq, gte, inArray, lt } from "drizzle-orm";
import Link from "next/link";
import { todayISO, utcToZoned, zonedToUtc, addDaysISO } from "@clinicaos/core/timezone";
import { schema, withTenant } from "@clinicaos/db";
import { requireAuth } from "@/lib/auth-action";
import { QuickStatusButtons } from "./quick-status";

function saudacao(hora: number): string {
  if (hora < 12) return "Bom dia";
  if (hora < 18) return "Boa tarde";
  return "Boa noite";
}

const STATUS_CHIP: Record<string, { label: string; className: string }> = {
  scheduled: { label: "A confirmar", className: "bg-amber-50 text-amber-700" },
  confirmed: { label: "Confirmada", className: "bg-emerald-50 text-emerald-700" },
  showed: { label: "Compareceu", className: "bg-emerald-600 text-white" },
  no_show: { label: "Faltou", className: "bg-red-50 text-red-700" },
  cancelled: { label: "Cancelada", className: "bg-stone-100 text-stone-500" },
};

export default async function InicioPage() {
  const auth = await requireAuth();
  if (!auth.clinicId) return null;
  const primeiroNome = auth.userName.split(" ")[0];

  const data = await withTenant(
    auth.clinicId,
    async (tx) => {
      const clinic = (
        await tx
          .select({ timezone: schema.clinics.timezone })
          .from(schema.clinics)
          .where(eq(schema.clinics.id, auth.clinicId!))
          .limit(1)
      )[0];
      const tz = clinic?.timezone ?? "America/Sao_Paulo";
      const hoje = todayISO(tz);
      const dayStart = zonedToUtc(hoje, "00:00", tz);
      const dayEnd = zonedToUtc(addDaysISO(hoje, 1), "00:00", tz);

      const rows = await tx
        .select({
          id: schema.appointments.id,
          status: schema.appointments.status,
          startsAt: schema.appointments.startsAt,
          endsAt: schema.appointments.endsAt,
          customerName: schema.customers.fullName,
          customerId: schema.appointments.customerId,
          professionalId: schema.appointments.professionalId,
          procedureId: schema.appointments.procedureId,
        })
        .from(schema.appointments)
        .innerJoin(
          schema.customers,
          eq(schema.customers.id, schema.appointments.customerId),
        )
        .where(
          and(
            gte(schema.appointments.startsAt, dayStart),
            lt(schema.appointments.startsAt, dayEnd),
            inArray(schema.appointments.status, [
              "scheduled",
              "confirmed",
              "showed",
              "no_show",
            ]),
          ),
        )
        .orderBy(asc(schema.appointments.startsAt));

      const professionals = await tx
        .select({ id: schema.professionals.id, name: schema.professionals.name })
        .from(schema.professionals);
      const procedures = await tx
        .select({ id: schema.procedures.id, name: schema.procedures.name })
        .from(schema.procedures);

      const now = new Date();
      const appointments = rows.map((r) => ({
        id: r.id,
        status: r.status,
        time: utcToZoned(new Date(r.startsAt), tz).timeHHMM,
        past: new Date(r.endsAt) < now,
        customerName: r.customerName,
        professionalName:
          professionals.find((p) => p.id === r.professionalId)?.name ?? "—",
        procedureName: procedures.find((p) => p.id === r.procedureId)?.name ?? "—",
      }));

      const horaLocal = utcToZoned(now, tz).minutesOfDay / 60;

      return { appointments, horaLocal, tz };
    },
    auth.userId,
  );

  const { appointments } = data;
  const total = appointments.length;
  const confirmados = appointments.filter((a) => a.status === "confirmed").length;
  const aguardando = appointments.filter((a) => a.status === "scheduled").length;
  const faltas = appointments.filter((a) => a.status === "no_show").length;
  const semDesfecho = appointments.filter(
    (a) => a.past && (a.status === "scheduled" || a.status === "confirmed"),
  ).length;

  const cards = [
    { label: "Agendamentos", value: total },
    { label: "Confirmados", value: confirmados },
    { label: "Aguardando confirmação", value: aguardando },
    { label: "Faltas", value: faltas },
  ];

  const dataDeHoje = new Intl.DateTimeFormat("pt-BR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: data.tz,
  }).format(new Date());

  return (
    <div className="p-8">
      <h1 className="text-2xl font-semibold text-stone-800">
        {saudacao(Math.floor(data.horaLocal))}, {primeiroNome}!
      </h1>
      <p className="mt-0.5 text-sm text-stone-500">
        {dataDeHoje.charAt(0).toUpperCase() + dataDeHoje.slice(1)}
      </p>

      {semDesfecho > 0 ? (
        <div className="mt-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
          ⚠ {semDesfecho} atendimento{semDesfecho === 1 ? "" : "s"} de hoje sem desfecho —
          marque <strong>Compareceu</strong> ou <strong>Faltou</strong> para o financeiro
          e as automações funcionarem.
        </div>
      ) : null}

      <section className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {cards.map((card) => (
          <div key={card.label} className="rounded-xl border border-stone-200 bg-white p-4">
            <p className="text-sm text-stone-500">{card.label}</p>
            <p className="mt-1 text-2xl font-semibold text-stone-800">{card.value}</p>
          </div>
        ))}
      </section>

      <section className="mt-6 rounded-xl border border-stone-200 bg-white">
        <div className="flex items-center justify-between border-b border-stone-100 px-6 py-4">
          <h2 className="text-sm font-medium text-stone-700">Agenda de hoje</h2>
          <Link href="/agenda" className="text-sm text-teal-700 hover:underline">
            Abrir agenda →
          </Link>
        </div>
        {appointments.length === 0 ? (
          <p className="px-6 py-8 text-center text-sm text-stone-500">
            Nenhum agendamento para hoje. Toque em “Abrir agenda” para criar um em
            segundos.
          </p>
        ) : (
          <ul>
            {appointments.map((a) => {
              const chip = STATUS_CHIP[a.status] ?? STATUS_CHIP.scheduled!;
              return (
                <li
                  key={a.id}
                  className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-100 px-6 py-3 last:border-0"
                >
                  <div className="flex items-center gap-3">
                    <span className="w-12 text-sm font-semibold text-stone-700">
                      {a.time}
                    </span>
                    <div>
                      <p className="text-sm font-medium text-stone-800">{a.customerName}</p>
                      <p className="text-xs text-stone-500">
                        {a.procedureName} · {a.professionalName}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${chip.className}`}
                    >
                      {chip.label}
                    </span>
                    <QuickStatusButtons appointmentId={a.id} status={a.status} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="mt-6 rounded-xl border border-stone-200 bg-white p-6">
        <h2 className="text-sm font-medium text-stone-700">
          O que as automações fizeram hoje
        </h2>
        <p className="mt-4 text-center text-sm text-stone-500">
          Quando o WhatsApp estiver conectado, este bloco mostra lembretes enviados,
          confirmações recebidas e faltas em recuperação — tudo sozinho.
        </p>
      </section>
    </div>
  );
}
