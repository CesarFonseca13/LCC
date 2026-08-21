import { and, asc, desc, eq, gt, inArray, sql } from "drizzle-orm";
import Link from "next/link";
import { can } from "@clinicaos/core/permissions";
import { formatPhoneBR } from "@clinicaos/core/phone";
import { utcToZoned } from "@clinicaos/core/timezone";
import { schema, withTenant } from "@clinicaos/db";
import { EmptyState } from "@/components/ui";
import { requireAuth } from "@/lib/auth-action";
import { formatBRL } from "@/lib/format";
import { Composer, ModeBanner, ReadOnOpen, AutoRefresh } from "./inbox-client";

export const metadata = { title: "WhatsApp" };

type Filter = "todas" | "precisam" | "humano" | "auto";

const FILTERS: [Filter, string][] = [
  ["todas", "Todas"],
  ["precisam", "Precisam de você"],
  ["humano", "Com atendente"],
  ["auto", "Automático"],
];

export default async function WhatsAppPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string; f?: string }>;
}) {
  const auth = await requireAuth();
  if (!auth.clinicId || !auth.role) return null;

  if (!can(auth.role, "inbox.access")) {
    return (
      <div className="p-8">
        <h1 className="text-xl font-semibold text-stone-800">WhatsApp</h1>
        <div className="mt-6">
          <EmptyState title="O inbox do WhatsApp é operado pela administração e pela recepção." />
        </div>
      </div>
    );
  }

  const sp = await searchParams;
  const filter: Filter = (FILTERS.find(([k]) => k === sp.f)?.[0] ?? "todas") as Filter;

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

      const conversations = await tx
        .select({
          id: schema.conversations.id,
          mode: schema.conversations.mode,
          unreadCount: schema.conversations.unreadCount,
          lastMessageAt: schema.conversations.lastMessageAt,
          remoteJid: schema.conversations.remoteJid,
          customerId: schema.conversations.customerId,
          customerName: schema.customers.fullName,
          customerStatus: schema.customers.status,
          lastBody: sql<string | null>`(
            SELECT m.body FROM messages m
            WHERE m.conversation_id = conversations.id
            ORDER BY m.created_at DESC LIMIT 1
          )`,
        })
        .from(schema.conversations)
        .leftJoin(schema.customers, eq(schema.customers.id, schema.conversations.customerId))
        .orderBy(desc(schema.conversations.lastMessageAt));

      const filtered = conversations.filter((c) => {
        if (filter === "precisam") return c.mode === "waiting_human";
        if (filter === "humano") return c.mode === "human";
        if (filter === "auto") return c.mode === "ai";
        return true;
      });

      const selectedId =
        sp.c && conversations.some((c) => c.id === sp.c)
          ? sp.c
          : (filtered[0]?.id ?? null);

      let thread: {
        id: string;
        direction: string;
        author: string;
        body: string | null;
        status: string;
        time: string;
        automationId: string | null;
      }[] = [];
      let panel: {
        customerId: string | null;
        name: string;
        phone: string;
        status: string | null;
        nextAppointment: string | null;
        totalSpent: string | null;
        visits: number;
      } | null = null;

      const selected = conversations.find((c) => c.id === selectedId);
      if (selected) {
        const messages = await tx
          .select()
          .from(schema.messages)
          .where(eq(schema.messages.conversationId, selected.id))
          // As 200 mais RECENTES (senão conversa longa nunca mostra o presente)
          .orderBy(desc(schema.messages.createdAt))
          .limit(200);
        messages.reverse();
        thread = messages.map((m) => ({
          id: m.id,
          direction: m.direction,
          author: m.author,
          body: m.body,
          status: m.status,
          time: utcToZoned(new Date(m.createdAt), tz).timeHHMM,
          automationId: m.automationId,
        }));

        const phone = selected.remoteJid.replace(/@.*$/, "");
        let nextAppointment: string | null = null;
        let totalSpent: string | null = null;
        let visits = 0;
        if (selected.customerId) {
          const next = (
            await tx
              .select({
                startsAt: schema.appointments.startsAt,
                status: schema.appointments.status,
                procedureName: sql<string | null>`(SELECT p.name FROM procedures p WHERE p.id = appointments.procedure_id)`,
              })
              .from(schema.appointments)
              .where(
                and(
                  eq(schema.appointments.customerId, selected.customerId),
                  inArray(schema.appointments.status, ["scheduled", "confirmed"]),
                  gt(schema.appointments.startsAt, new Date()),
                ),
              )
              .orderBy(asc(schema.appointments.startsAt))
              .limit(1)
          )[0];
          if (next) {
            const z = utcToZoned(new Date(next.startsAt), tz);
            const [, m, d] = z.dateISO.split("-");
            nextAppointment = `${d}/${m} às ${z.timeHHMM} · ${next.procedureName ?? "atendimento"}${next.status === "confirmed" ? " ✓" : ""}`;
          }
          const hist = (
            await tx
              .select({
                visits: sql<number>`count(*)::int`,
                total: sql<string | null>`sum(amount)`,
              })
              .from(schema.customerHistoryEntries)
              .where(eq(schema.customerHistoryEntries.customerId, selected.customerId))
          )[0];
          visits = hist?.visits ?? 0;
          totalSpent = hist?.total ?? null;
        }
        panel = {
          customerId: selected.customerId,
          name: selected.customerName ?? formatPhoneBR(`+${phone}`),
          phone: formatPhoneBR(`+${phone}`),
          status: selected.customerStatus,
          nextAppointment,
          totalSpent,
          visits,
        };
      }

      return { conversations: filtered, allCount: conversations.length, selectedId, selected, thread, panel, tz };
    },
    auth.userId,
  );

  const needCount = data.conversations.filter((c) => c.mode === "waiting_human").length;
  void needCount;

  return (
    <div className="flex h-full">
      <AutoRefresh seconds={8} />

      {/* Coluna 1: conversas */}
      <div className="flex w-80 shrink-0 flex-col border-r border-stone-200 bg-white">
        <div className="border-b border-stone-100 p-4">
          <h1 className="text-base font-semibold text-stone-800">WhatsApp</h1>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {FILTERS.map(([key, label]) => (
              <Link
                key={key}
                href={`/whatsapp?f=${key}`}
                className={
                  filter === key
                    ? "rounded-full bg-teal-700 px-2.5 py-1 text-xs font-medium text-white"
                    : "rounded-full border border-stone-200 px-2.5 py-1 text-xs text-stone-600 hover:border-stone-300"
                }
              >
                {label}
              </Link>
            ))}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {data.conversations.length === 0 ? (
            <p className="p-6 text-center text-sm text-stone-500">
              {data.allCount === 0
                ? "As conversas aparecem aqui assim que o número estiver conectado e alguém escrever."
                : "Nenhuma conversa neste filtro."}
            </p>
          ) : (
            data.conversations.map((c) => {
              const phone = c.remoteJid.replace(/@.*$/, "");
              const name = c.customerName ?? formatPhoneBR(`+${phone}`);
              const active = c.id === data.selectedId;
              return (
                <Link
                  key={c.id}
                  href={`/whatsapp?f=${filter}&c=${c.id}`}
                  className={`block border-b border-stone-100 px-4 py-3 transition ${
                    active ? "bg-teal-50/60" : "hover:bg-stone-50"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium text-stone-800">
                      {c.mode === "waiting_human" ? "🔴 " : ""}
                      {name}
                    </span>
                    {c.unreadCount > 0 ? (
                      <span className="rounded-full bg-teal-600 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white">
                        {c.unreadCount}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-0.5 truncate text-xs text-stone-500">
                    {c.lastBody ?? "—"}
                  </p>
                  <p className="mt-0.5 text-[10px] uppercase tracking-wide text-stone-400">
                    {c.mode === "waiting_human"
                      ? "precisa de você"
                      : c.mode === "human"
                        ? "com atendente"
                        : "automático"}
                  </p>
                </Link>
              );
            })
          )}
        </div>
      </div>

      {/* Coluna 2: conversa */}
      <div className="flex min-w-0 flex-1 flex-col bg-stone-50">
        {!data.selected ? (
          <div className="flex flex-1 items-center justify-center p-8">
            <EmptyState title="Escolha uma conversa ao lado — ou aguarde a primeira mensagem chegar." />
          </div>
        ) : (
          <>
            <ReadOnOpen conversationId={data.selected.id} unread={data.selected.unreadCount} />
            <ModeBanner
              conversationId={data.selected.id}
              mode={data.selected.mode}
            />
            <div className="flex-1 space-y-2 overflow-y-auto p-6">
              {data.thread.map((m) => {
                const mine = m.direction === "outbound";
                return (
                  <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                    <div
                      className={`max-w-[70%] rounded-2xl px-3.5 py-2 text-sm shadow-sm ${
                        mine
                          ? "rounded-br-md bg-teal-700 text-white"
                          : "rounded-bl-md border border-stone-200 bg-white text-stone-800"
                      }`}
                    >
                      {mine && m.author === "automation" ? (
                        <p className="mb-0.5 text-[10px] font-medium uppercase tracking-wide text-teal-100">
                          ✨ automação
                        </p>
                      ) : null}
                      <p className="whitespace-pre-wrap">{m.body ?? `[${m.status}]`}</p>
                      <p
                        className={`mt-1 text-right text-[10px] ${
                          mine ? "text-teal-100" : "text-stone-400"
                        }`}
                      >
                        {m.time}
                        {mine
                          ? m.status === "read"
                            ? " ✓✓"
                            : m.status === "delivered"
                              ? " ✓✓"
                              : m.status === "sent"
                                ? " ✓"
                                : m.status === "failed"
                                  ? " ⚠"
                                  : " ⏳"
                          : ""}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
            <Composer conversationId={data.selected.id} />
          </>
        )}
      </div>

      {/* Coluna 3: mini-ficha */}
      {data.panel ? (
        <div className="hidden w-72 shrink-0 border-l border-stone-200 bg-white p-5 lg:block">
          <p className="text-sm font-semibold text-stone-800">{data.panel.name}</p>
          <p className="text-xs text-stone-500">{data.panel.phone}</p>
          {data.panel.status ? (
            <span className="mt-2 inline-block rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-600 capitalize">
              {data.panel.status === "lead"
                ? "Lead"
                : data.panel.status === "active"
                  ? "Ativa"
                  : data.panel.status}
            </span>
          ) : null}

          <div className="mt-5 space-y-3 border-t border-stone-100 pt-4 text-sm">
            <div>
              <p className="text-xs uppercase tracking-wide text-stone-400">Próximo horário</p>
              <p className="mt-0.5 text-stone-700">
                {data.panel.nextAppointment ?? "Nenhum agendado"}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-stone-400">Histórico</p>
              <p className="mt-0.5 text-stone-700">
                {data.panel.visits} visita{data.panel.visits === 1 ? "" : "s"}
                {data.panel.totalSpent ? ` · ${formatBRL(data.panel.totalSpent)}` : ""}
              </p>
            </div>
          </div>

          <div className="mt-5 flex flex-col gap-2 border-t border-stone-100 pt-4">
            <Link
              href="/agenda"
              className="rounded-lg bg-teal-700 px-3 py-2 text-center text-sm font-medium text-white hover:bg-teal-800"
            >
              Agendar
            </Link>
            {data.panel.customerId ? (
              <Link
                href={`/clientes/${data.panel.customerId}`}
                className="rounded-lg border border-stone-300 px-3 py-2 text-center text-sm text-stone-700 hover:bg-stone-50"
              >
                Abrir ficha
              </Link>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
