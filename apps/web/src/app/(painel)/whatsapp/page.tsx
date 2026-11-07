import { and, asc, desc, eq, gt, inArray, sql } from "drizzle-orm";
import Link from "next/link";
import { Fragment } from "react";
import { can } from "@clinicaos/core/permissions";
import { formatPhoneBR } from "@clinicaos/core/phone";
import { appendSlotsToMessage, findMentionedProcedures, suggestOffers } from "@clinicaos/core/offers";
import { todayISO, utcToZoned } from "@clinicaos/core/timezone";
import { eligibleProfessionalIds, findSlots, schema, withTenant } from "@clinicaos/db";
import { EmptyState } from "@/components/ui";
import { requireAuth } from "@/lib/auth-action";
import { formatBRL } from "@/lib/format";
import { NEEDS_HUMAN_TYPES } from "@/lib/needs-human";
import {
  AlertToggle,
  AutoRefresh,
  Composer,
  ModeBanner,
  OfferPanel,
  type OfferView,
  PinSelection,
  ReadOnOpen,
} from "./inbox-client";

/** Balão sem texto (mídia, figurinha, histórico importado do app): o que mostrar no lugar. */
const MEDIA_LABEL: Record<string, string> = {
  image: "📷 Foto",
  audio: "🎤 Áudio",
  video: "🎬 Vídeo",
  document: "📎 Documento",
  sticker: "Figurinha",
  location: "📍 Localização",
  other: "Mídia ou anexo",
};
/** Tipos de anexo de verdade: com legenda, o balão mostra o tipo acima do texto. */
const ATTACHMENT_TYPES = new Set(["image", "audio", "video", "document", "sticker", "location"]);
const MEDIA_PREFIX = "§media:";

function listPreview(lastBody: string | null): string {
  if (!lastBody) return "—";
  if (lastBody.startsWith(MEDIA_PREFIX)) {
    const type = lastBody.slice(MEDIA_PREFIX.length);
    return type === "text" ? "Mensagem sem texto" : (MEDIA_LABEL[type] ?? "Mídia ou anexo");
  }
  return lastBody;
}

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
  searchParams: Promise<{ c?: string; f?: string; n?: string }>;
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

      // Abas por número (multi-número): só aparecem quando há mais de um
      const instances = await tx
        .select({
          id: schema.whatsappInstances.id,
          label: schema.whatsappInstances.label,
          status: schema.whatsappInstances.status,
          isPrimary: schema.whatsappInstances.isPrimary,
        })
        .from(schema.whatsappInstances)
        .where(eq(schema.whatsappInstances.clinicId, auth.clinicId!))
        .orderBy(schema.whatsappInstances.createdAt);
      const activeInstanceId = instances.some((i) => i.id === sp.n) ? sp.n! : null;

      const conversations = await tx
        .select({
          id: schema.conversations.id,
          mode: schema.conversations.mode,
          unreadCount: schema.conversations.unreadCount,
          lastMessageAt: schema.conversations.lastMessageAt,
          remoteJid: schema.conversations.remoteJid,
          customerId: schema.conversations.customerId,
          instanceId: schema.conversations.instanceId,
          customerName: schema.customers.fullName,
          customerStatus: schema.customers.status,
          // Anexo sem legenda vem como "§media:<tipo>" (a lista mostra "🎤 Áudio" em vez de "—")
          lastBody: sql<string | null>`(
            SELECT COALESCE(m.body, ${MEDIA_PREFIX}::text || m.type) FROM messages m
            WHERE m.conversation_id = conversations.id
            ORDER BY m.created_at DESC LIMIT 1
          )`,
        })
        .from(schema.conversations)
        .leftJoin(schema.customers, eq(schema.customers.id, schema.conversations.customerId))
        // conversa sem mensagem entregue ainda (só aprovação pendente) não
        // pode furar a fila: NULL iria pro topo no DESC padrão do Postgres
        .orderBy(sql`${schema.conversations.lastMessageAt} DESC NULLS LAST`);

      // Por que cada conversa está esperando a equipe: o aviso mais recente dela
      // (motivo da atendente, anexo, limite de gastos...) e se é urgente
      const waitingIds = conversations.filter((c) => c.mode === "waiting_human").map((c) => c.id);
      const reasons = new Map<string, { text: string; urgent: boolean; when: string }>();
      if (waitingIds.length > 0) {
        const todayKey = utcToZoned(new Date(), tz).dateISO;
        const rows = await tx
          .selectDistinctOn([schema.notifications.refId], {
            refId: schema.notifications.refId,
            type: schema.notifications.type,
            title: schema.notifications.title,
            body: schema.notifications.body,
            createdAt: schema.notifications.createdAt,
          })
          .from(schema.notifications)
          .where(
            and(
              eq(schema.notifications.refTable, "conversations"),
              inArray(schema.notifications.refId, waitingIds),
              inArray(schema.notifications.type, [...NEEDS_HUMAN_TYPES]),
            ),
          )
          .orderBy(schema.notifications.refId, desc(schema.notifications.createdAt));
        for (const r of rows) {
          if (!r.refId) continue;
          const z = utcToZoned(new Date(r.createdAt), tz);
          const [, mm, dd] = z.dateISO.split("-");
          // Título genérico ("Fulana precisa de você no WhatsApp") não diz nada: vale o
          // corpo. Título com causa (feedback negativo, limite) entra junto do corpo
          const body = r.body?.trim() ?? "";
          const genericTitle = /precisa de você no WhatsApp/.test(r.title);
          reasons.set(r.refId, {
            text: genericTitle ? body || r.title : body ? `${r.title} — ${body}` : r.title,
            urgent: r.type === "conversation_urgent",
            when: z.dateISO === todayKey ? `hoje às ${z.timeHHMM}` : `${dd}/${mm} às ${z.timeHHMM}`,
          });
        }
      }

      // Aba de número primeiro; badge "precisa de você" conta POR ABA
      const byInstance = activeInstanceId
        ? conversations.filter((c) => c.instanceId === activeInstanceId)
        : conversations;
      const needByInstance = new Map<string, number>();
      for (const c of conversations) {
        if (c.mode === "waiting_human") {
          needByInstance.set(c.instanceId, (needByInstance.get(c.instanceId) ?? 0) + 1);
        }
      }

      const filtered = byInstance
        .filter((c) => {
          if (filter === "precisam") return c.mode === "waiting_human";
          if (filter === "humano") return c.mode === "human";
          if (filter === "auto") return c.mode === "ai";
          return true;
        })
        .map((c) => ({ ...c, reason: reasons.get(c.id) ?? null }));
      // "Precisam de você": urgentes primeiro (sort estável mantém a ordem por recência)
      if (filter === "precisam") {
        filtered.sort((a, b) => Number(b.reason?.urgent ?? false) - Number(a.reason?.urgent ?? false));
      }

      const selectedId =
        sp.c && byInstance.some((c) => c.id === sp.c)
          ? sp.c
          : (filtered[0]?.id ?? null);

      let thread: {
        id: string;
        direction: string;
        author: string;
        type: string;
        body: string | null;
        status: string;
        error: string | null;
        time: string;
        /** Dia da mensagem (ISO) e rótulo "Hoje" / "Ontem" / dd/mm/aaaa — histórico importado tem meses. */
        date: string;
        dateLabel: string;
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
      let offers: OfferView[] = [];

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
        const todayKey = utcToZoned(new Date(), tz).dateISO;
        const yesterdayKey = utcToZoned(new Date(Date.now() - 86_400_000), tz).dateISO;
        thread = messages.map((m) => {
          const z = utcToZoned(new Date(m.createdAt), tz);
          return {
            id: m.id,
            direction: m.direction,
            author: m.author,
            type: m.type,
            body: m.body,
            status: m.status,
            error: m.error ?? null,
            time: z.timeHHMM,
            date: z.dateISO,
            dateLabel:
              z.dateISO === todayKey ? "Hoje" : z.dateISO === yesterdayKey ? "Ontem" : z.dateISO.split("-").reverse().join("/"),
            automationId: m.automationId,
          };
        });

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

          // ── Sugestões de oferta (só o que a clínica autorizou em "combina com") ──
          const catalogRows = await tx
            .select({
              id: schema.procedures.id,
              name: schema.procedures.name,
              price: schema.procedures.price,
              active: schema.procedures.active,
              returnDays: schema.procedures.returnDays,
              offerNote: schema.procedures.offerNote,
              promoText: schema.procedures.promoText,
              promoUntil: schema.procedures.promoUntil,
              durationMinutes: schema.procedures.durationMinutes,
            })
            .from(schema.procedures);
          const catalog = catalogRows.map((p) => ({ ...p, price: Number(p.price) }));
          const pairings = await tx
            .select({ procedureId: schema.procedurePairings.procedureId, relatedId: schema.procedurePairings.relatedId })
            .from(schema.procedurePairings);
          const upcoming = await tx
            .select({ procedureId: schema.appointments.procedureId })
            .from(schema.appointments)
            .where(
              and(
                eq(schema.appointments.customerId, selected.customerId),
                inArray(schema.appointments.status, ["scheduled", "confirmed"]),
                gt(schema.appointments.startsAt, new Date()),
              ),
            );
          const upcomingIds = upcoming.map((a) => a.procedureId).filter((x): x is string => Boolean(x));
          const doneAppts = await tx
            .select({ procedureId: schema.appointments.procedureId, startsAt: schema.appointments.startsAt })
            .from(schema.appointments)
            .where(and(eq(schema.appointments.customerId, selected.customerId), eq(schema.appointments.status, "showed")));
          const doneHist = await tx
            .select({ procedureId: schema.customerHistoryEntries.procedureId, occurredOn: schema.customerHistoryEntries.occurredOn })
            .from(schema.customerHistoryEntries)
            .where(eq(schema.customerHistoryEntries.customerId, selected.customerId));
          const history = [
            ...doneAppts
              .filter((a) => a.procedureId)
              .map((a) => ({ procedureId: a.procedureId!, lastOn: utcToZoned(new Date(a.startsAt), tz).dateISO })),
            ...doneHist.filter((h) => h.procedureId).map((h) => ({ procedureId: h.procedureId!, lastOn: h.occurredOn })),
          ];
          const recentInbound = messages
            .filter((m) => m.direction === "inbound" && m.body)
            .slice(-10)
            .map((m) => m.body as string)
            .join("\n");
          const askedIds = [...new Set([...findMentionedProcedures(recentInbound, catalog), ...upcomingIds])];
          const suggestions = suggestOffers({
            askedIds,
            upcomingIds,
            history,
            catalog,
            pairings,
            today: todayISO(tz),
            customerFirstName: selected.customerName?.trim().split(/\s+/)[0] ?? null,
          });
          // Horários REALMENTE livres para cada sugestão: só profissionais aptas ao
          // procedimento, duração certa, agenda e bloqueios. Combinação = mesma visita.
          const durationOf = new Map(catalogRows.map((p) => [p.id, p.durationMinutes]));
          offers = [];
          for (const s of suggestions) {
            const comboIds = s.pairedWithId ? [s.pairedWithId, s.procedure.id] : [s.procedure.id];
            let combined = comboIds.length > 1;
            let pros = await eligibleProfessionalIds(tx, auth.clinicId!, comboIds);
            let slots = await findSlots(
              tx,
              auth.clinicId!,
              tz,
              comboIds.reduce((acc, id) => acc + (durationOf.get(id) ?? 60), 0),
              3,
              pros,
            );
            if (slots.length === 0 && combined) {
              // Ninguém faz os dois na mesma visita (ou sem vaga): oferece o serviço sozinho
              combined = false;
              pros = await eligibleProfessionalIds(tx, auth.clinicId!, [s.procedure.id]);
              slots = await findSlots(tx, auth.clinicId!, tz, durationOf.get(s.procedure.id) ?? 60, 3, pros);
            }
            const labels = slots.map((x) => x.label);
            offers.push({
              procedureName: s.procedure.name,
              price: s.procedure.price,
              reason: s.reason,
              why: s.why,
              message: appendSlotsToMessage(s.message, labels, combined),
              slots: labels,
              combined,
              noProfessional: pros.length === 0,
            });
          }
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

      return {
        conversations: filtered,
        allCount: byInstance.length,
        instances,
        activeInstanceId,
        needByInstance: Object.fromEntries(needByInstance),
        selectedId,
        selected,
        selectedReason: selected ? (reasons.get(selected.id) ?? null) : null,
        thread,
        panel,
        offers,
        tz,
      };
    },
    auth.userId,
  );

  const { instances, activeInstanceId } = data;
  const instanceLabel = (id: string) =>
    instances.find((i) => i.id === id)?.label ??
    (instances.find((i) => i.id === id)?.isPrimary ? "Principal" : "Número");
  const nParam = activeInstanceId ? `&n=${activeInstanceId}` : "";
  const totalNeed = Object.values(data.needByInstance).reduce((a, b) => a + b, 0);

  return (
    <div className="flex h-full flex-col">
      <AutoRefresh seconds={8} />

      {/* Abas por número — estilo navegador (só com 2+ números) */}
      {instances.length > 1 ? (
        <div className="flex items-end gap-1 border-b border-stone-200 bg-stone-100 px-4 pt-2">
          <a
            href={`/whatsapp?f=${filter}`}
            className={`flex items-center gap-2 rounded-t-lg px-4 py-2 text-sm ${
              !activeInstanceId
                ? "-mb-px border border-b-0 border-stone-200 bg-white font-medium text-stone-800"
                : "text-stone-500 hover:text-stone-700"
            }`}
          >
            Todos os números
            {totalNeed > 0 ? (
              <span className="rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white">
                {totalNeed}
              </span>
            ) : null}
          </a>
          {instances.map((inst, i) => {
            const need = data.needByInstance[inst.id] ?? 0;
            return (
              <a
                key={inst.id}
                href={`/whatsapp?f=${filter}&n=${inst.id}`}
                className={`flex items-center gap-2 rounded-t-lg px-4 py-2 text-sm ${
                  activeInstanceId === inst.id
                    ? "-mb-px border border-b-0 border-stone-200 bg-white font-medium text-stone-800"
                    : "text-stone-500 hover:text-stone-700"
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    inst.status === "connected" ? "bg-emerald-500" : "bg-red-400"
                  }`}
                />
                {inst.label ?? (inst.isPrimary ? "Principal" : `Número ${i + 1}`)}
                {need > 0 ? (
                  <span className="rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white">
                    {need}
                  </span>
                ) : null}
              </a>
            );
          })}
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1">
      {/* Coluna 1: conversas */}
      <div className="flex w-80 shrink-0 flex-col border-r border-stone-200 bg-white">
        <div className="border-b border-stone-100 p-4">
          <div className="flex items-center justify-between gap-2">
            <h1 className="text-base font-semibold text-stone-800">WhatsApp</h1>
            <AlertToggle />
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {FILTERS.map(([key, label]) => (
              <Link
                key={key}
                href={`/whatsapp?f=${key}${nParam}`}
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
                  href={`/whatsapp?f=${filter}${nParam}&c=${c.id}`}
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
                    {listPreview(c.lastBody)}
                  </p>
                  {c.mode === "waiting_human" && c.reason ? (
                    <p className={`mt-0.5 truncate text-xs ${c.reason.urgent ? "font-semibold text-red-700" : "text-red-600/90"}`}>
                      {c.reason.text}
                    </p>
                  ) : null}
                  <p className="mt-0.5 text-[10px] uppercase tracking-wide text-stone-400">
                    {c.mode === "waiting_human" ? (
                      c.reason?.urgent ? (
                        <span className="font-bold text-red-600">urgente · precisa de você</span>
                      ) : (
                        "precisa de você"
                      )
                    ) : c.mode === "human" ? (
                      "com atendente"
                    ) : (
                      "automático"
                    )}
                    {instances.length > 1 && !activeInstanceId
                      ? ` · ${instanceLabel(c.instanceId)}`
                      : ""}
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
            {/* Conversa escolhida sozinha (sem &c na URL): fixa na URL, para o
                auto-refresh nunca trocar de paciente com um rascunho no meio */}
            {!sp.c || sp.c !== data.selected.id ? (
              <PinSelection href={`/whatsapp?f=${filter}${nParam}&c=${data.selected.id}`} />
            ) : null}
            <ModeBanner
              key={`mode-${data.selected.id}`}
              conversationId={data.selected.id}
              mode={data.selected.mode}
              reason={data.selected.mode === "waiting_human" ? data.selectedReason : null}
            />
            {/* col-reverse: o navegador ancora o scroll no FIM nativamente —
                conversa abre na última mensagem, como todo app de mensagem */}
            <div className="flex flex-1 flex-col-reverse gap-2 overflow-y-auto p-6">
              {[...data.thread].reverse().map((m, i, arr) => {
                const mine = m.direction === "outbound";
                // col-reverse: o item SEGUINTE no array é o anterior no tempo —
                // troca de dia ganha um separador acima do balão
                const newDay = i === arr.length - 1 || arr[i + 1]!.date !== m.date;
                return (
                  <Fragment key={m.id}>
                    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
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
                      {m.body && ATTACHMENT_TYPES.has(m.type) ? (
                        <p className="text-[11px] font-medium italic opacity-80">{MEDIA_LABEL[m.type]}</p>
                      ) : null}
                      <p className={`whitespace-pre-wrap ${m.body ? "" : "italic opacity-80"}`}>
                        {m.body ?? MEDIA_LABEL[m.type] ?? "Mensagem sem texto"}
                      </p>
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
                      {mine && m.status === "failed" ? (
                        <p className="mt-1 rounded bg-white/90 px-2 py-1 text-left text-[11px] text-red-700">
                          Não foi entregue: {m.error ?? "motivo não informado pelo WhatsApp"}
                        </p>
                      ) : null}
                    </div>
                    </div>
                    {newDay ? (
                      <p className="my-1 text-center">
                        <span className="rounded-full bg-stone-200/80 px-2.5 py-0.5 text-[11px] font-medium text-stone-600">
                          {m.dateLabel}
                        </span>
                      </p>
                    ) : null}
                  </Fragment>
                );
              })}
            </div>
            {/* key: rascunho é de UMA conversa — trocou de conversa, o campo começa vazio */}
            <Composer key={`composer-${data.selected.id}`} conversationId={data.selected.id} />
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

          <OfferPanel offers={data.offers} />

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
    </div>
  );
}
