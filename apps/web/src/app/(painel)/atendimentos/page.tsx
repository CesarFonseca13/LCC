import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import Link from "next/link";
import { can } from "@clinicaos/core/permissions";
import { todayISO, zonedToUtc } from "@clinicaos/core/timezone";
import { schema, withTenant } from "@clinicaos/db";
import { EmptyState } from "@/components/ui";
import { requireAuth } from "@/lib/auth-action";
import { formatBRL } from "@/lib/format";

export const metadata = { title: "Atendimentos" };

const STATUS_CHIP: Record<string, { label: string; className: string }> = {
  scheduled: { label: "Agendado", className: "bg-amber-50 text-amber-700" },
  confirmed: { label: "Confirmado", className: "bg-sky-50 text-sky-700" },
  showed: { label: "Realizado", className: "bg-emerald-50 text-emerald-700" },
  no_show: { label: "Faltou", className: "bg-red-50 text-red-700" },
  cancelled: { label: "Cancelado", className: "bg-stone-100 text-stone-500" },
  rescheduled: { label: "Remarcado", className: "bg-violet-50 text-violet-600" },
};

const ORIGIN_BADGE: Record<string, { label: string; className: string }> = {
  ai_agent: { label: "✨ assistente", className: "bg-violet-50 text-violet-700" },
  online_booking: { label: "online", className: "bg-sky-50 text-sky-700" },
};

const STATUS_FILTERS = [
  ["todos", "Todos"],
  ["showed", "Realizados"],
  ["scheduled", "Agendados"],
  ["confirmed", "Confirmados"],
  ["no_show", "Faltas"],
  ["cancelled", "Cancelados"],
] as const;

function monthShift(monthISO: string, delta: number): string {
  const [y, m] = monthISO.split("-").map(Number);
  const d = new Date(y!, m! - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

const MESES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

export default async function AtendimentosPage({
  searchParams,
}: {
  searchParams: Promise<{ m?: string; s?: string; p?: string }>;
}) {
  const auth = await requireAuth();
  if (!auth.clinicId || !auth.role) return null;

  if (!can(auth.role, "agenda.read.all")) {
    return (
      <div className="p-8">
        <h1 className="text-xl font-semibold text-stone-800">Atendimentos</h1>
        <div className="mt-6 max-w-lg">
          <EmptyState title="O histórico completo de atendimentos é visível para a administração e a recepção. Em breve, seus atendimentos pessoais aparecem aqui." />
        </div>
      </div>
    );
  }

  const sp = await searchParams;

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
      const currentMonth = todayISO(tz).slice(0, 7);
      const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.m ?? "") ? sp.m! : currentMonth;
      const statusFilter = STATUS_FILTERS.some(([k]) => k === sp.s) ? sp.s! : "todos";
      const profFilter = /^[0-9a-f-]{36}$/.test(sp.p ?? "") ? sp.p! : "";

      const monthStart = zonedToUtc(`${month}-01`, "00:00", tz);
      const monthEnd = zonedToUtc(`${monthShift(month, 1)}-01`, "00:00", tz);

      const conditions = [
        gte(schema.appointments.startsAt, monthStart),
        lt(schema.appointments.startsAt, monthEnd),
      ];
      if (statusFilter !== "todos") {
        conditions.push(
          eq(
            schema.appointments.status,
            statusFilter as "scheduled" | "confirmed" | "showed" | "no_show" | "cancelled",
          ),
        );
      }
      if (profFilter) conditions.push(eq(schema.appointments.professionalId, profFilter));

      const rows = await tx
        .select({
          id: schema.appointments.id,
          startsAt: schema.appointments.startsAt,
          status: schema.appointments.status,
          price: schema.appointments.price,
          origin: schema.appointments.origin,
          customerId: schema.customers.id,
          customerName: schema.customers.fullName,
          procedureName: schema.procedures.name,
          professionalName: schema.professionals.name,
          roomName: schema.rooms.name,
          packageId: schema.appointments.customerPackageId,
        })
        .from(schema.appointments)
        .innerJoin(schema.customers, eq(schema.customers.id, schema.appointments.customerId))
        .leftJoin(schema.procedures, eq(schema.procedures.id, schema.appointments.procedureId))
        .leftJoin(
          schema.professionals,
          eq(schema.professionals.id, schema.appointments.professionalId),
        )
        .leftJoin(schema.rooms, eq(schema.rooms.id, schema.appointments.roomId))
        .where(and(...conditions))
        .orderBy(desc(schema.appointments.startsAt))
        .limit(300);

      // Resumo do mês (independente do filtro de status)
      const counts = await tx
        .select({
          status: schema.appointments.status,
          count: sql<number>`count(*)::int`,
          value: sql<string | null>`sum(price) FILTER (WHERE status = 'showed')`,
        })
        .from(schema.appointments)
        .where(
          and(
            gte(schema.appointments.startsAt, monthStart),
            lt(schema.appointments.startsAt, monthEnd),
            ...(profFilter ? [eq(schema.appointments.professionalId, profFilter)] : []),
          ),
        )
        .groupBy(schema.appointments.status);

      const professionals = await tx
        .select({ id: schema.professionals.id, name: schema.professionals.name })
        .from(schema.professionals)
        .where(eq(schema.professionals.active, true))
        .orderBy(schema.professionals.name);

      return { rows, counts, professionals, tz, month, statusFilter, profFilter };
    },
    auth.userId,
  );

  const { rows, counts, professionals, tz, month, statusFilter, profFilter } = data;
  const byStatus = (s: string) => counts.find((c) => c.status === s)?.count ?? 0;
  const realizadoValor = counts.reduce((acc, c) => acc + Number(c.value ?? 0), 0);
  const total = counts.reduce((acc, c) => acc + c.count, 0);

  const [year, m] = month.split("-");
  const monthLabel = `${MESES[Number(m) - 1]} de ${year}`;
  const fmtDay = new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    timeZone: tz,
  });
  const fmtTime = new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: tz,
  });
  const link = (params: { m?: string; s?: string; p?: string }) => {
    const q = new URLSearchParams();
    q.set("m", params.m ?? month);
    if ((params.s ?? statusFilter) !== "todos") q.set("s", params.s ?? statusFilter);
    if (params.p ?? profFilter) q.set("p", params.p ?? profFilter);
    return `/atendimentos?${q.toString()}`;
  };

  const cards = [
    { label: "No mês", value: String(total) },
    { label: "Realizados", value: String(byStatus("showed")) },
    { label: "Faltas", value: String(byStatus("no_show")) },
    { label: "Valor realizado", value: formatBRL(realizadoValor) },
  ];

  return (
    <div className="p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-stone-800">Atendimentos</h1>
          <p className="mt-0.5 text-sm text-stone-500">
            Tudo que foi feito e tudo que está marcado — com profissional, sala e valor.
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <Link
            href={link({ m: monthShift(month, -1) })}
            className="rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 hover:border-stone-300"
          >
            ←
          </Link>
          <span className="min-w-36 text-center font-medium capitalize text-stone-700">
            {monthLabel}
          </span>
          <Link
            href={link({ m: monthShift(month, 1) })}
            className="rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 hover:border-stone-300"
          >
            →
          </Link>
        </div>
      </div>

      <section className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {cards.map((card) => (
          <div key={card.label} className="rounded-xl border border-stone-200 bg-white p-4">
            <p className="text-sm text-stone-500">{card.label}</p>
            <p className="mt-1 text-2xl font-semibold text-stone-800">{card.value}</p>
          </div>
        ))}
      </section>

      <div className="mt-6 flex flex-wrap items-center gap-2">
        {STATUS_FILTERS.map(([key, label]) => (
          <Link
            key={key}
            href={link({ s: key })}
            className={
              statusFilter === key
                ? "rounded-full bg-teal-700 px-3 py-1.5 text-xs font-medium text-white"
                : "rounded-full border border-stone-200 bg-white px-3 py-1.5 text-xs text-stone-600 hover:border-stone-300"
            }
          >
            {label}
          </Link>
        ))}
        <span className="mx-1 text-stone-300">·</span>
        <Link
          href={link({ p: "" })}
          className={
            !profFilter
              ? "rounded-full bg-stone-700 px-3 py-1.5 text-xs font-medium text-white"
              : "rounded-full border border-stone-200 bg-white px-3 py-1.5 text-xs text-stone-600 hover:border-stone-300"
          }
        >
          Todas profissionais
        </Link>
        {professionals.map((p) => (
          <Link
            key={p.id}
            href={link({ p: p.id })}
            className={
              profFilter === p.id
                ? "rounded-full bg-stone-700 px-3 py-1.5 text-xs font-medium text-white"
                : "rounded-full border border-stone-200 bg-white px-3 py-1.5 text-xs text-stone-600 hover:border-stone-300"
            }
          >
            {p.name}
          </Link>
        ))}
      </div>

      <div className="mt-4">
        {rows.length === 0 ? (
          <EmptyState title="Nenhum atendimento nesse mês com esses filtros." />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-stone-200 text-left text-xs uppercase tracking-wide text-stone-400">
                  <th className="px-4 py-3 font-medium">Data</th>
                  <th className="px-4 py-3 font-medium">Cliente</th>
                  <th className="px-4 py-3 font-medium">Procedimento</th>
                  <th className="px-4 py-3 font-medium">Profissional</th>
                  <th className="px-4 py-3 font-medium">Sala</th>
                  <th className="px-4 py-3 font-medium">Valor</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const chip = STATUS_CHIP[r.status] ?? STATUS_CHIP.scheduled!;
                  const origin = ORIGIN_BADGE[r.origin ?? ""];
                  const date = new Date(r.startsAt);
                  return (
                    <tr
                      key={r.id}
                      className="border-b border-stone-100 last:border-0 hover:bg-stone-50"
                    >
                      <td className="whitespace-nowrap px-4 py-3 text-stone-600">
                        {fmtDay.format(date)}{" "}
                        <span className="text-stone-400">{fmtTime.format(date)}</span>
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          href={`/clientes/${r.customerId}`}
                          className="font-medium text-teal-800 hover:underline"
                        >
                          {r.customerName}
                        </Link>
                        {origin ? (
                          <span
                            className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[11px] font-medium ${origin.className}`}
                          >
                            {origin.label}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-stone-700">
                        {r.procedureName ?? "—"}
                        {r.packageId ? (
                          <span className="ml-1.5 rounded-full bg-teal-50 px-1.5 py-0.5 text-[11px] text-teal-700">
                            📦 pacote
                          </span>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-stone-600">{r.professionalName ?? "—"}</td>
                      <td className="px-4 py-3 text-stone-600">{r.roomName ?? "—"}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-stone-600">
                        {r.packageId ? (
                          <span className="text-stone-400" title="Sessão coberta pelo pacote">
                            no pacote
                          </span>
                        ) : r.price ? (
                          formatBRL(r.price)
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${chip.className}`}
                        >
                          {chip.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {rows.length >= 300 ? (
              <p className="border-t border-stone-100 px-4 py-3 text-xs text-stone-500">
                Mostrando os primeiros 300 do mês — use os filtros para refinar.
              </p>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
