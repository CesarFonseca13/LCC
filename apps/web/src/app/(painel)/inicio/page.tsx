import { and, asc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { todayISO, utcToZoned, zonedToUtc, addDaysISO } from "@clinicaos/core/timezone";
import { can } from "@clinicaos/core/permissions";
import { schema, withTenant } from "@clinicaos/db";
import { EmptyState } from "@/components/ui";
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
  if (!auth.clinicId || !auth.role) return null;
  const primeiroNome = auth.userName.split(" ")[0];

  // Papel Profissional vê só a própria agenda — o painel geral é da administração
  if (!can(auth.role, "agenda.read.all")) {
    return (
      <div className="p-8">
        <h1 className="text-xl font-semibold text-stone-800">
          {saudacao(new Date().getHours())}, {primeiroNome}!
        </h1>
        <div className="mt-6 max-w-lg">
          <EmptyState title="O painel geral da clínica é visível para a administração e a recepção. Em breve, sua agenda pessoal aparece aqui — por enquanto, fale com a recepção para ver seus horários do dia." />
        </div>
      </div>
    );
  }

  const data = await withTenant(
    auth.clinicId,
    async (tx) => {
      const clinic = (
        await tx
          .select({ timezone: schema.clinics.timezone, settings: schema.clinics.settings })
          .from(schema.clinics)
          .where(eq(schema.clinics.id, auth.clinicId!))
          .limit(1)
      )[0];
      const tz = clinic?.timezone ?? "America/Sao_Paulo";
      const clinicSettings = (clinic?.settings ?? {}) as Record<string, unknown>;

      // Checklist de implantação (estado real, não flags)
      const proceduresCount =
        (
          await tx
            .select({ count: sql<number>`count(*)::int` })
            .from(schema.procedures)
            .where(eq(schema.procedures.active, true))
        )[0]?.count ?? 0;
      const customersCount =
        (
          await tx.select({ count: sql<number>`count(*)::int` }).from(schema.customers)
        )[0]?.count ?? 0;
      const whatsappConnected =
        (
          await tx
            .select({ status: schema.whatsappInstances.status })
            .from(schema.whatsappInstances)
            .limit(1)
        )[0]?.status === "connected";
      const automationsEnabled =
        ((
          await tx
            .select({ count: sql<number>`count(*)::int` })
            .from(schema.automationSettings)
            .where(eq(schema.automationSettings.enabled, true))
        )[0]?.count ?? 0) > 0;
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

      // "O que as automações fizeram hoje" — números HONESTOS:
      // lembretes = só mensagens de cadência de confirmação; confirmações = só
      // as que a PRÓPRIA cliente respondeu no WhatsApp (1 por agendamento)
      const sentToday = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.messages)
        .where(
          and(
            eq(schema.messages.author, "automation"),
            inArray(schema.messages.automationId, [
              "reminder_24h",
              "confirm_2h",
              "reminder_45min",
              "pre_care",
            ]),
            inArray(schema.messages.status, ["sent", "delivered", "read"]),
            gte(schema.messages.sentAt, dayStart),
          ),
        );
      const pendingApprovals = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.approvals)
        .where(eq(schema.approvals.status, "pending"));
      const confirmedByCadence = await tx
        .select({ count: sql<number>`count(DISTINCT appointment_id)::int` })
        .from(schema.appointmentStatusHistory)
        .where(
          and(
            eq(schema.appointmentStatusHistory.toStatus, "confirmed"),
            eq(schema.appointmentStatusHistory.source, "customer_whatsapp"),
            gte(schema.appointmentStatusHistory.createdAt, dayStart),
          ),
        );

      // Atividade recente: o diário de bordo da clínica — marcações,
      // confirmações, remarcações, cancelamentos e presenças de QUALQUER dia
      // (a agenda acima é só a de hoje), com a origem de cada uma
      const activityRaw = await tx.execute(sql`
        SELECT h.from_status, h.to_status, h.source, h.created_at,
               a.starts_at, cu.full_name AS customer_name,
               COALESCE(p.name, 'atendimento') AS procedure_name
        FROM appointment_status_history h
        JOIN appointments a ON a.id = h.appointment_id
        JOIN customers cu ON cu.id = a.customer_id
        LEFT JOIN procedures p ON p.id = a.procedure_id
        ORDER BY h.created_at DESC
        LIMIT 12
      `);
      const activity = (
        activityRaw.rows as unknown as {
          from_status: string | null;
          to_status: string;
          source: string | null;
          created_at: string;
          starts_at: string;
          customer_name: string;
          procedure_name: string;
        }[]
      ).map((r) => {
        const at = utcToZoned(new Date(r.created_at), tz);
        const st = utcToZoned(new Date(r.starts_at), tz);
        const [, sm, sd] = st.dateISO.split("-");
        return {
          createdDateISO: at.dateISO,
          createdTime: at.timeHHMM,
          toStatus: r.to_status,
          isCreation: r.from_status === null,
          source: r.source ?? "",
          customerName: r.customer_name,
          procedureName: r.procedure_name,
          apptLabel: `${sd}/${sm} às ${st.timeHHMM}`,
        };
      });

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

      return {
        appointments,
        activity,
        todayISO: todayISO(tz),
        yesterdayISO: addDaysISO(todayISO(tz), -1),
        horaLocal,
        tz,
        onboardingDone: clinicSettings.onboarding_done === true,
        checklist: {
          whatsappConnected,
          hasProcedures: proceduresCount > 0,
          hasCustomers: customersCount > 0,
          automationsEnabled,
        },
        automationsToday: {
          sent: sentToday[0]?.count ?? 0,
          pending: pendingApprovals[0]?.count ?? 0,
          confirmed: confirmedByCadence[0]?.count ?? 0,
        },
      };
    },
    auth.userId,
  );

  // Primeira entrada da administradora: implantação guiada em tela cheia
  if (auth.role === "owner" && !data.onboardingDone) {
    redirect("/implantacao");
  }

  const { appointments, activity, automationsToday, checklist } = data;

  const ACTIVITY_LINE: Record<string, (a: (typeof activity)[number]) => string> = {
    created: (a) => `📅 ${a.customerName} — ${a.procedureName} marcado para ${a.apptLabel}`,
    confirmed: (a) => `✅ ${a.customerName} confirmou ${a.procedureName} de ${a.apptLabel}`,
    cancelled: (a) => `✖ ${a.customerName} cancelou ${a.procedureName} de ${a.apptLabel}`,
    rescheduled: (a) => `🔁 ${a.customerName} remarcou ${a.procedureName} de ${a.apptLabel}`,
    showed: (a) => `💚 ${a.customerName} compareceu — ${a.procedureName}`,
    no_show: (a) => `⚠ ${a.customerName} faltou — ${a.procedureName} de ${a.apptLabel}`,
  };
  const SOURCE_BADGE: Record<string, { label: string; className: string }> = {
    ai_agent: { label: "✨ assistente", className: "bg-violet-50 text-violet-700" },
    customer_whatsapp: { label: "cliente no WhatsApp", className: "bg-emerald-50 text-emerald-700" },
    online_booking: { label: "agendamento online", className: "bg-sky-50 text-sky-700" },
  };
  const activityItems = activity
    .map((a) => {
      const kind = a.isCreation && a.toStatus === "scheduled" ? "created" : a.toStatus;
      const line = ACTIVITY_LINE[kind];
      if (!line) return null;
      const when =
        a.createdDateISO === data.todayISO
          ? `hoje ${a.createdTime}`
          : a.createdDateISO === data.yesterdayISO
            ? `ontem ${a.createdTime}`
            : `${a.createdDateISO.slice(8, 10)}/${a.createdDateISO.slice(5, 7)} ${a.createdTime}`;
      return { text: line(a), when, badge: SOURCE_BADGE[a.source] ?? null };
    })
    .filter((i): i is NonNullable<typeof i> => i !== null);
  const checklistItems = [
    { done: checklist.whatsappConnected, label: "Conectar o WhatsApp", href: "/configuracoes" },
    { done: checklist.hasProcedures, label: "Cadastrar procedimentos", href: "/servicos" },
    { done: checklist.hasCustomers, label: "Importar suas clientes", href: "/clientes" },
    { done: checklist.automationsEnabled, label: "Ligar as automações", href: "/automacoes" },
  ];
  const checklistPending = checklistItems.filter((i) => !i.done);
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

      {checklistPending.length > 0 && auth.role === "owner" ? (
        <div className="mt-4 rounded-xl border border-teal-200 bg-teal-50 p-4">
          <p className="text-sm font-medium text-teal-900">
            Falta pouco para a clínica rodar sozinha:
          </p>
          <ul className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm">
            {checklistItems.map((item) => (
              <li key={item.label}>
                {item.done ? (
                  <span className="text-teal-700">✅ {item.label}</span>
                ) : (
                  <Link href={item.href} className="text-teal-800 underline hover:text-teal-900">
                    ⬜ {item.label}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

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
        {automationsToday.sent + automationsToday.pending + automationsToday.confirmed ===
        0 ? (
          <p className="mt-4 text-center text-sm text-stone-500">
            Nada ainda por hoje. Com o WhatsApp conectado e as automações ligadas, os
            lembretes de amanhã aparecem aqui sozinhos.
          </p>
        ) : (
          <div className="mt-4 flex flex-wrap gap-6 text-sm">
            <p className="text-stone-700">
              <span className="text-lg font-semibold text-teal-700">
                {automationsToday.sent}
              </span>{" "}
              lembrete{automationsToday.sent === 1 ? "" : "s"} enviado
              {automationsToday.sent === 1 ? "" : "s"}
            </p>
            <p className="text-stone-700">
              <span className="text-lg font-semibold text-emerald-600">
                {automationsToday.confirmed}
              </span>{" "}
              confirmaç{automationsToday.confirmed === 1 ? "ão" : "ões"} sem esforço
            </p>
            {automationsToday.pending > 0 ? (
              <Link href="/aprovacoes" className="text-teal-700 hover:underline">
                <span className="text-lg font-semibold">{automationsToday.pending}</span>{" "}
                aguardando sua aprovação →
              </Link>
            ) : null}
          </div>
        )}
      </section>

      {/* Diário de bordo: tudo que aconteceu, de qualquer dia, com a origem */}
      <section className="mt-6 rounded-xl border border-stone-200 bg-white">
        <div className="border-b border-stone-100 px-6 py-4">
          <h2 className="text-sm font-medium text-stone-700">Aconteceu por aqui</h2>
          <p className="mt-0.5 text-xs text-stone-400">
            Marcações, confirmações e mudanças — inclusive as que a assistente resolveu
            sozinha.
          </p>
        </div>
        {activityItems.length === 0 ? (
          <p className="px-6 py-8 text-center text-sm text-stone-500">
            Ainda nada por aqui — assim que a primeira consulta for marcada, ela aparece
            nesta lista.
          </p>
        ) : (
          <ul>
            {activityItems.map((item, i) => (
              <li
                key={i}
                className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-100 px-6 py-2.5 last:border-0"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <span className="whitespace-nowrap text-xs text-stone-400">{item.when}</span>
                  <span className="truncate text-sm text-stone-700">{item.text}</span>
                </div>
                {item.badge ? (
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${item.badge.className}`}
                  >
                    {item.badge.label}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
