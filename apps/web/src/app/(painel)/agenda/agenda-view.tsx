"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition } from "react";
import { addDaysISO } from "@clinicaos/core/timezone";
import { Button, FieldError, Input, Label, Modal, Select, Textarea } from "@/components/ui";
import {
  changeAppointmentStatus,
  createAppointment,
  createBlock,
  deleteBlock,
  rescheduleAppointment,
  searchCustomers,
} from "./actions";

const SLOT_PX = 44;

export interface AgendaAppointment {
  id: string;
  customerId: string;
  customerName: string;
  professionalId: string;
  procedureName: string | null;
  dateISO: string;
  startMin: number;
  endMin: number;
  timeHHMM: string;
  endHHMM: string;
  status: string;
  notes: string | null;
  allowOverlap: boolean;
}

export interface AgendaBlock {
  id: string;
  professionalId: string | null;
  dateISO: string;
  startMin: number;
  endMin: number;
  reason: string | null;
}

export interface AgendaData {
  view: "dia" | "semana" | "lista";
  dateISO: string;
  todayISO: string;
  nowMin: number;
  weekStartISO: string;
  timezone: string;
  openMin: number;
  closeMin: number;
  professionals: { id: string; name: string; color: string }[];
  selectedProfessionalId: string | null;
  procedures: { id: string; name: string; durationMinutes: number }[];
  rooms: { id: string; name: string }[];
  appointments: AgendaAppointment[];
  blocks: AgendaBlock[];
}

const STATUS_META: Record<string, { label: string; chip: string }> = {
  scheduled: { label: "A confirmar", chip: "bg-amber-50 text-amber-700" },
  confirmed: { label: "Confirmada", chip: "bg-emerald-50 text-emerald-700" },
  showed: { label: "Compareceu", chip: "bg-emerald-600 text-white" },
  no_show: { label: "Faltou", chip: "bg-red-50 text-red-700" },
  cancelled: { label: "Cancelada", chip: "bg-stone-100 text-stone-500" },
};

function minToHHMM(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

function fmtDateBR(dateISO: string): string {
  const [y, m, d] = dateISO.split("-");
  return `${d}/${m}/${y}`;
}

export function AgendaView({ data }: { data: AgendaData }) {
  const router = useRouter();
  const [createAt, setCreateAt] = useState<{
    dateISO: string;
    timeHHMM: string;
    professionalId: string;
  } | null>(null);
  const [details, setDetails] = useState<AgendaAppointment | null>(null);
  const [blockOpen, setBlockOpen] = useState(false);

  const urlFor = (over: Partial<{ view: string; date: string; prof: string }>) => {
    const params = new URLSearchParams({
      view: over.view ?? data.view,
      date: over.date ?? data.dateISO,
    });
    const prof = over.prof ?? data.selectedProfessionalId;
    if (prof) params.set("prof", prof);
    return `/agenda?${params.toString()}`;
  };

  const weekDates = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDaysISO(data.weekStartISO, i)),
    [data.weekStartISO],
  );

  const dateLabel = new Intl.DateTimeFormat("pt-BR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(new Date(`${data.dateISO}T12:00:00Z`));

  return (
    <div className="flex h-full flex-col p-8 pb-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-stone-800">Agenda</h1>
          <p className="mt-0.5 text-sm capitalize text-stone-500">{dateLabel}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={() => setBlockOpen(true)}>
            Bloquear horário
          </Button>
          <Button
            onClick={() =>
              setCreateAt({
                dateISO: data.dateISO,
                timeHHMM: minToHHMM(data.openMin),
                professionalId: data.professionals[0]?.id ?? "",
              })
            }
          >
            + Agendamento
          </Button>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 rounded-lg border border-stone-200 bg-white p-1">
          {(
            [
              ["dia", "Dia"],
              ["semana", "Semana"],
              ["lista", "Lista"],
            ] as const
          ).map(([key, label]) => (
            <Link
              key={key}
              href={urlFor({ view: key })}
              className={
                data.view === key
                  ? "rounded-md bg-teal-700 px-3 py-1.5 text-sm font-medium text-white"
                  : "rounded-md px-3 py-1.5 text-sm text-stone-600 hover:bg-stone-100"
              }
            >
              {label}
            </Link>
          ))}
        </div>

        <div className="flex items-center gap-2">
          {data.view === "semana" ? (
            <Select
              value={data.selectedProfessionalId ?? ""}
              onChange={(e) => router.push(urlFor({ prof: e.target.value }))}
              className="w-52"
            >
              {data.professionals.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          ) : null}
          <Link
            href={urlFor({ date: addDaysISO(data.dateISO, data.view === "semana" ? -7 : -1) })}
            className="rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-sm text-stone-600 hover:bg-stone-50"
          >
            ←
          </Link>
          <Link
            href={urlFor({ date: data.todayISO })}
            className="rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-sm font-medium text-teal-700 hover:bg-stone-50"
          >
            Hoje
          </Link>
          <Link
            href={urlFor({ date: addDaysISO(data.dateISO, data.view === "semana" ? 7 : 1) })}
            className="rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-sm text-stone-600 hover:bg-stone-50"
          >
            →
          </Link>
        </div>
      </div>

      <div className="mt-4 min-h-0 flex-1 overflow-auto rounded-xl border border-stone-200 bg-white">
        {data.view === "lista" ? (
          <ListView data={data} onOpen={setDetails} />
        ) : data.view === "semana" ? (
          <TimeGrid
            data={data}
            columns={weekDates.map((d) => ({
              key: d,
              title: new Intl.DateTimeFormat("pt-BR", {
                weekday: "short",
                day: "2-digit",
                month: "2-digit",
                timeZone: "UTC",
              }).format(new Date(`${d}T12:00:00Z`)),
              color:
                data.professionals.find((p) => p.id === data.selectedProfessionalId)
                  ?.color ?? "#0f766e",
              filter: (a: AgendaAppointment) =>
                a.dateISO === d && a.professionalId === data.selectedProfessionalId,
              blockFilter: (b: AgendaBlock) =>
                b.dateISO === d &&
                (b.professionalId === null ||
                  b.professionalId === data.selectedProfessionalId),
              isToday: d === data.todayISO,
              slotTarget: { dateISO: d, professionalId: data.selectedProfessionalId ?? "" },
            }))}
            onSlotClick={setCreateAt}
            onOpen={setDetails}
          />
        ) : (
          <TimeGrid
            data={data}
            columns={data.professionals.map((p) => ({
              key: p.id,
              title: p.name,
              color: p.color,
              filter: (a: AgendaAppointment) =>
                a.dateISO === data.dateISO && a.professionalId === p.id,
              blockFilter: (b: AgendaBlock) =>
                b.dateISO === data.dateISO &&
                (b.professionalId === null || b.professionalId === p.id),
              isToday: data.dateISO === data.todayISO,
              slotTarget: { dateISO: data.dateISO, professionalId: p.id },
            }))}
            onSlotClick={setCreateAt}
            onOpen={setDetails}
          />
        )}
      </div>

      <CreateModal
        data={data}
        at={createAt}
        onClose={() => setCreateAt(null)}
      />
      <DetailsModal
        appointment={details}
        onClose={() => setDetails(null)}
      />
      <BlockModal
        data={data}
        open={blockOpen}
        onClose={() => setBlockOpen(false)}
      />
    </div>
  );
}

// ── Grid de horários (dia por profissional / semana) ─────────────────

interface GridColumn {
  key: string;
  title: string;
  color: string;
  filter: (a: AgendaAppointment) => boolean;
  blockFilter: (b: AgendaBlock) => boolean;
  isToday: boolean;
  slotTarget: { dateISO: string; professionalId: string };
}

function TimeGrid({
  data,
  columns,
  onSlotClick,
  onOpen,
}: {
  data: AgendaData;
  columns: GridColumn[];
  onSlotClick: (v: { dateISO: string; timeHHMM: string; professionalId: string }) => void;
  onOpen: (a: AgendaAppointment) => void;
}) {
  const slots: number[] = [];
  for (let m = data.openMin; m < data.closeMin; m += 30) slots.push(m);
  const height = slots.length * SLOT_PX;

  if (columns.length === 0) {
    return (
      <p className="p-8 text-center text-sm text-stone-500">
        Cadastre uma profissional em Equipe para usar a agenda.
      </p>
    );
  }

  return (
    <div
      className="grid min-w-fit"
      style={{ gridTemplateColumns: `64px repeat(${columns.length}, minmax(180px, 1fr))` }}
    >
      {/* Cabeçalho */}
      <div className="sticky top-0 z-20 border-b border-stone-200 bg-white" />
      {columns.map((col) => (
        <div
          key={`h-${col.key}`}
          className={`sticky top-0 z-20 border-b border-l border-stone-200 bg-white px-3 py-2 text-sm font-medium ${
            col.isToday ? "text-teal-800" : "text-stone-700"
          }`}
        >
          <span
            className="mr-1.5 inline-block h-2 w-2 rounded-full"
            style={{ backgroundColor: col.color }}
          />
          {col.title}
        </div>
      ))}

      {/* Gutter de horas */}
      <div className="relative" style={{ height }}>
        {slots.map((m) => (
          <div
            key={m}
            className="absolute right-2 -translate-y-1/2 text-xs text-stone-400"
            style={{ top: ((m - data.openMin) / 30) * SLOT_PX }}
          >
            {m % 60 === 0 ? minToHHMM(m) : ""}
          </div>
        ))}
      </div>

      {/* Colunas */}
      {columns.map((col) => {
        const appts = data.appointments.filter(col.filter);
        const blocks = data.blocks.filter(col.blockFilter);
        return (
          <div
            key={col.key}
            className="relative border-l border-stone-100"
            style={{ height }}
          >
            {/* Linhas + botões de slot */}
            {slots.map((m) => (
              <button
                key={m}
                type="button"
                aria-label={`Agendar ${minToHHMM(m)}`}
                onClick={() =>
                  onSlotClick({
                    dateISO: col.slotTarget.dateISO,
                    timeHHMM: minToHHMM(m),
                    professionalId: col.slotTarget.professionalId,
                  })
                }
                className="absolute inset-x-0 border-t border-stone-100 transition hover:bg-teal-50/60"
                style={{ top: ((m - data.openMin) / 30) * SLOT_PX, height: SLOT_PX }}
              />
            ))}

            {/* Bloqueios */}
            {blocks.map((b) => {
              const top = ((Math.max(b.startMin, data.openMin) - data.openMin) / 30) * SLOT_PX;
              const h =
                ((Math.min(b.endMin, data.closeMin) - Math.max(b.startMin, data.openMin)) / 30) *
                SLOT_PX;
              if (h <= 0) return null;
              return (
                <div
                  key={b.id}
                  className="absolute inset-x-1 z-[5] rounded-md bg-stone-200/70 px-2 py-1 text-xs text-stone-500"
                  style={{ top, height: h }}
                  title={b.reason ?? "Bloqueado"}
                >
                  🔒 {b.reason ?? "Bloqueado"}
                </div>
              );
            })}

            {/* Agendamentos */}
            {appts.map((a) => {
              const top = ((a.startMin - data.openMin) / 30) * SLOT_PX;
              const h = Math.max(((a.endMin - a.startMin) / 30) * SLOT_PX - 2, 22);
              const meta = STATUS_META[a.status] ?? STATUS_META.scheduled!;
              return (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => onOpen(a)}
                  className={`absolute inset-x-1 z-10 overflow-hidden rounded-md border bg-white px-2 py-1 text-left shadow-sm transition hover:shadow ${
                    a.status === "no_show"
                      ? "border-red-200 bg-red-50/60"
                      : a.status === "showed"
                        ? "border-emerald-200 bg-emerald-50/60"
                        : "border-stone-200"
                  }`}
                  style={{ top, height: h, borderLeftWidth: 3, borderLeftColor: col.color }}
                >
                  <span className="block truncate text-xs font-medium text-stone-800">
                    {a.timeHHMM} · {a.customerName}
                  </span>
                  <span className="block truncate text-[11px] text-stone-500">
                    {a.procedureName ?? "—"}
                  </span>
                  {h >= 60 ? (
                    <span
                      className={`mt-0.5 inline-block rounded-full px-1.5 py-px text-[10px] font-medium ${meta.chip}`}
                    >
                      {meta.label}
                    </span>
                  ) : null}
                </button>
              );
            })}

            {/* Linha do agora */}
            {col.isToday && data.nowMin >= data.openMin && data.nowMin <= data.closeMin ? (
              <div
                className="pointer-events-none absolute inset-x-0 z-20 border-t-2 border-red-400"
                style={{ top: ((data.nowMin - data.openMin) / 30) * SLOT_PX }}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

// ── Lista ────────────────────────────────────────────────────────────

function ListView({
  data,
  onOpen,
}: {
  data: AgendaData;
  onOpen: (a: AgendaAppointment) => void;
}) {
  if (data.appointments.length === 0) {
    return (
      <p className="p-8 text-center text-sm text-stone-500">
        Nenhum agendamento nos próximos 14 dias. Toque em um horário vago na visão Dia
        para criar o primeiro.
      </p>
    );
  }
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-stone-200 text-left text-xs uppercase tracking-wide text-stone-400">
          <th className="px-4 py-3 font-medium">Quando</th>
          <th className="px-4 py-3 font-medium">Cliente</th>
          <th className="px-4 py-3 font-medium">Procedimento</th>
          <th className="px-4 py-3 font-medium">Profissional</th>
          <th className="px-4 py-3 font-medium">Status</th>
        </tr>
      </thead>
      <tbody>
        {data.appointments.map((a) => {
          const meta = STATUS_META[a.status] ?? STATUS_META.scheduled!;
          const prof = data.professionals.find((p) => p.id === a.professionalId);
          return (
            <tr
              key={a.id}
              onClick={() => onOpen(a)}
              className="cursor-pointer border-b border-stone-100 last:border-0 hover:bg-stone-50"
            >
              <td className="px-4 py-3 text-stone-700">
                {fmtDateBR(a.dateISO)} · {a.timeHHMM}
              </td>
              <td className="px-4 py-3 font-medium text-stone-800">{a.customerName}</td>
              <td className="px-4 py-3 text-stone-600">{a.procedureName ?? "—"}</td>
              <td className="px-4 py-3 text-stone-600">{prof?.name ?? "—"}</td>
              <td className="px-4 py-3">
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${meta.chip}`}>
                  {meta.label}
                </span>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ── Modal: criação rápida ────────────────────────────────────────────

function CreateModal({
  data,
  at,
  onClose,
}: {
  data: AgendaData;
  at: { dateISO: string; timeHHMM: string; professionalId: string } | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [conflict, setConflict] = useState(false);
  const [pending, startTransition] = useTransition();
  const [newCustomer, setNewCustomer] = useState(false);
  const [customer, setCustomer] = useState<{ id: string; label: string } | null>(null);
  const [options, setOptions] = useState<{ id: string; label: string }[]>([]);
  const [query, setQuery] = useState("");
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  // Payload da última tentativa — o retry de encaixe NUNCA relê o DOM
  const lastPayload = useRef<Parameters<typeof createAppointment>[0] | null>(null);

  function close() {
    onClose();
    setError(undefined);
    setConflict(false);
    setCustomer(null);
    setOptions([]);
    setQuery("");
    setNewCustomer(false);
  }

  function onQueryChange(value: string) {
    setQuery(value);
    setCustomer(null);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (value.trim().length < 2) {
      setOptions([]);
      return;
    }
    searchTimer.current = setTimeout(() => {
      void searchCustomers({ q: value }).then(setOptions).catch(() => setOptions([]));
    }, 250);
  }

  function run(payload: Parameters<typeof createAppointment>[0]) {
    setError(undefined);
    setConflict(false);
    lastPayload.current = payload;
    startTransition(async () => {
      try {
        const result = await createAppointment(payload);
        if (result.ok) {
          close();
          router.refresh();
        } else {
          setError(result.error ?? "Não foi possível agendar.");
          setConflict(Boolean(result.conflict));
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Não foi possível agendar.");
      }
    });
  }

  function submit(formData: FormData) {
    run({
      customerId: newCustomer ? undefined : (customer?.id ?? undefined),
      newCustomerName: newCustomer ? String(formData.get("newName") ?? "") : undefined,
      newCustomerPhone: newCustomer ? String(formData.get("newPhone") ?? "") : undefined,
      professionalId: String(formData.get("professionalId") ?? ""),
      procedureId: String(formData.get("procedureId") ?? ""),
      roomId: String(formData.get("roomId") ?? "none"),
      dateISO: String(formData.get("dateISO") ?? ""),
      timeHHMM: String(formData.get("timeHHMM") ?? ""),
      notes: String(formData.get("notes") ?? ""),
      allowOverlap: false,
    });
  }

  if (!at) return <Modal open={false} onClose={close} title="">{null}</Modal>;

  return (
    <Modal open={Boolean(at)} onClose={close} title="Novo agendamento">
      <form
        ref={formRef}
        onSubmit={(e) => {
          e.preventDefault();
          submit(new FormData(e.currentTarget));
        }}
        className="space-y-4"
      >
        {/* Cliente */}
        {!newCustomer ? (
          <div>
            <Label htmlFor="ag-customer">Cliente</Label>
            {customer ? (
              <div className="flex items-center justify-between rounded-lg border border-teal-200 bg-teal-50 px-3 py-2 text-sm text-teal-900">
                <span>{customer.label}</span>
                <button
                  type="button"
                  className="text-xs text-teal-700 underline"
                  onClick={() => setCustomer(null)}
                >
                  trocar
                </button>
              </div>
            ) : (
              <>
                <Input
                  id="ag-customer"
                  value={query}
                  onChange={(e) => onQueryChange(e.target.value)}
                  placeholder="Busque por nome ou telefone..."
                  autoComplete="off"
                />
                {options.length > 0 ? (
                  <ul className="mt-1 overflow-hidden rounded-lg border border-stone-200 bg-white shadow-sm">
                    {options.map((o) => (
                      <li key={o.id}>
                        <button
                          type="button"
                          className="w-full px-3 py-2 text-left text-sm hover:bg-teal-50"
                          onClick={() => {
                            setCustomer(o);
                            setOptions([]);
                          }}
                        >
                          {o.label}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </>
            )}
            <button
              type="button"
              className="mt-1.5 text-xs font-medium text-teal-700 underline"
              onClick={() => setNewCustomer(true)}
            >
              + Cliente nova (só nome e WhatsApp)
            </button>
          </div>
        ) : (
          <div className="rounded-lg border border-stone-200 p-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="ag-newname">Nome</Label>
                <Input id="ag-newname" name="newName" required />
              </div>
              <div>
                <Label htmlFor="ag-newphone">WhatsApp</Label>
                <Input id="ag-newphone" name="newPhone" placeholder="(11) 98862-1152" required />
              </div>
            </div>
            <button
              type="button"
              className="mt-2 text-xs text-stone-500 underline"
              onClick={() => setNewCustomer(false)}
            >
              ← buscar cliente existente
            </button>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="ag-procedure">Procedimento</Label>
            <Select id="ag-procedure" name="procedureId" defaultValue="" required>
              <option value="" disabled>
                Escolha...
              </option>
              {data.procedures.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.durationMinutes} min)
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="ag-prof">Profissional</Label>
            <Select id="ag-prof" name="professionalId" defaultValue={at.professionalId} required>
              {data.professionals.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <Label htmlFor="ag-date">Data</Label>
            <Input id="ag-date" name="dateISO" type="date" defaultValue={at.dateISO} required />
          </div>
          <div>
            <Label htmlFor="ag-time">Hora</Label>
            <Input id="ag-time" name="timeHHMM" type="time" defaultValue={at.timeHHMM} required />
          </div>
          <div>
            <Label htmlFor="ag-room" hint="opcional">Sala</Label>
            <Select id="ag-room" name="roomId" defaultValue="none">
              <option value="none">Sem sala</option>
              {data.rooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <div>
          <Label htmlFor="ag-notes" hint="opcional">Observação</Label>
          <Textarea id="ag-notes" name="notes" rows={2} />
        </div>

        <FieldError message={error} />
        {conflict && lastPayload.current ? (
          <Button
            type="button"
            variant="secondary"
            onClick={() => run({ ...lastPayload.current!, allowOverlap: true })}
            disabled={pending}
          >
            Encaixar mesmo assim
          </Button>
        ) : null}

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="secondary" onClick={close}>
            Cancelar
          </Button>
          <Button type="submit" disabled={pending || (!newCustomer && !customer)}>
            {pending ? "Agendando..." : "Agendar"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ── Modal: detalhes + ações de status + remarcar ─────────────────────

function DetailsModal({
  appointment,
  onClose,
}: {
  appointment: AgendaAppointment | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const [rescheduling, setRescheduling] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [conflict, setConflict] = useState(false);
  const lastResched = useRef<{ dateISO: string; timeHHMM: string } | null>(null);

  function close() {
    onClose();
    setError(undefined);
    setRescheduling(false);
    setCancelling(false);
    setConflict(false);
  }

  function changeStatus(to: "confirmed" | "showed" | "no_show" | "cancelled", reason?: string) {
    setError(undefined);
    startTransition(async () => {
      const result = await changeAppointmentStatus({ id: appointment!.id, to, reason });
      if (result.ok) {
        close();
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  function runReschedule(payload: { dateISO: string; timeHHMM: string }, allowOverlap: boolean) {
    setError(undefined);
    setConflict(false);
    lastResched.current = payload;
    startTransition(async () => {
      const result = await rescheduleAppointment({
        id: appointment!.id,
        ...payload,
        allowOverlap,
      });
      if (result.ok) {
        close();
        router.refresh();
      } else {
        setError(result.error);
        setConflict(Boolean(result.conflict));
      }
    });
  }

  if (!appointment) return <Modal open={false} onClose={close} title="">{null}</Modal>;
  const meta = STATUS_META[appointment.status] ?? STATUS_META.scheduled!;
  const s = appointment.status;

  return (
    <Modal open onClose={close} title={appointment.customerName}>
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-sm text-stone-600">
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${meta.chip}`}>
            {meta.label}
          </span>
          <span>
            {fmtDateBR(appointment.dateISO)} · {appointment.timeHHMM}–{appointment.endHHMM}
          </span>
        </div>
        <p className="text-sm text-stone-700">
          <span className="font-medium">{appointment.procedureName ?? "Procedimento"}</span>
          {appointment.notes ? (
            <span className="block text-stone-500">Obs.: {appointment.notes}</span>
          ) : null}
        </p>

        {!rescheduling && !cancelling ? (
          <div className="flex flex-wrap gap-2">
            {(s === "scheduled") && (
              <Button onClick={() => changeStatus("confirmed")} disabled={pending}>
                Confirmar
              </Button>
            )}
            {(s === "scheduled" || s === "confirmed") && (
              <>
                <Button onClick={() => changeStatus("showed")} disabled={pending}>
                  Compareceu
                </Button>
                <Button variant="secondary" onClick={() => changeStatus("no_show")} disabled={pending}>
                  Faltou
                </Button>
                <Button variant="secondary" onClick={() => setRescheduling(true)} disabled={pending}>
                  Remarcar
                </Button>
                <Button variant="danger" onClick={() => setCancelling(true)} disabled={pending}>
                  Cancelar
                </Button>
              </>
            )}
            {s === "showed" && (
              <Button variant="secondary" onClick={() => changeStatus("no_show")} disabled={pending}>
                Corrigir para Faltou
              </Button>
            )}
            {s === "no_show" && (
              <>
                <Button onClick={() => changeStatus("showed")} disabled={pending}>
                  Corrigir para Compareceu
                </Button>
                <Button variant="secondary" onClick={() => setRescheduling(true)} disabled={pending}>
                  Remarcar
                </Button>
              </>
            )}
          </div>
        ) : null}

        {rescheduling ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              runReschedule(
                {
                  dateISO: String(fd.get("dateISO") ?? ""),
                  timeHHMM: String(fd.get("timeHHMM") ?? ""),
                },
                false,
              );
            }}
            className="space-y-3 rounded-lg border border-stone-200 p-3"
          >
            <p className="text-sm font-medium text-stone-700">Novo horário</p>
            <div className="grid grid-cols-2 gap-3">
              <Input name="dateISO" type="date" defaultValue={appointment.dateISO} required />
              <Input name="timeHHMM" type="time" defaultValue={appointment.timeHHMM} required />
            </div>
            {conflict && lastResched.current ? (
              <Button
                type="button"
                variant="secondary"
                onClick={() => runReschedule(lastResched.current!, true)}
                disabled={pending}
              >
                Encaixar mesmo assim
              </Button>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setRescheduling(false)}>
                Voltar
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Remarcando..." : "Remarcar"}
              </Button>
            </div>
          </form>
        ) : null}

        {cancelling ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              changeStatus("cancelled", String(fd.get("reason") ?? ""));
            }}
            className="space-y-3 rounded-lg border border-stone-200 p-3"
          >
            <p className="text-sm font-medium text-stone-700">Cancelar agendamento</p>
            <Input name="reason" placeholder="Motivo (opcional)" />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setCancelling(false)}>
                Voltar
              </Button>
              <Button type="submit" variant="danger" disabled={pending}>
                {pending ? "Cancelando..." : "Confirmar cancelamento"}
              </Button>
            </div>
          </form>
        ) : null}

        <FieldError message={error} />
      </div>
    </Modal>
  );
}

// ── Modal: bloqueio de horário ───────────────────────────────────────

function BlockModal({
  data,
  open,
  onClose,
}: {
  data: AgendaData;
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  function submit(fd: FormData) {
    setError(undefined);
    startTransition(async () => {
      const result = await createBlock({
        professionalId: String(fd.get("professionalId") ?? "all"),
        dateISO: String(fd.get("dateISO") ?? ""),
        startHHMM: String(fd.get("startHHMM") ?? ""),
        endHHMM: String(fd.get("endHHMM") ?? ""),
        reason: String(fd.get("reason") ?? ""),
      });
      if (result.ok) {
        onClose();
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  const todaysBlocks = data.blocks.filter((b) => b.dateISO === data.dateISO);

  return (
    <Modal open={open} onClose={onClose} title="Bloquear horário">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(new FormData(e.currentTarget));
        }}
        className="space-y-4"
      >
        <p className="text-xs text-stone-500">
          Use para almoço, folga, feriado ou manutenção — nada pode ser agendado no
          período bloqueado.
        </p>
        <div>
          <Label htmlFor="bl-prof">Quem</Label>
          <Select id="bl-prof" name="professionalId" defaultValue="all">
            <option value="all">Clínica inteira</option>
            {data.professionals.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <Label htmlFor="bl-date">Data</Label>
            <Input id="bl-date" name="dateISO" type="date" defaultValue={data.dateISO} required />
          </div>
          <div>
            <Label htmlFor="bl-start">Início</Label>
            <Input id="bl-start" name="startHHMM" type="time" required />
          </div>
          <div>
            <Label htmlFor="bl-end">Fim</Label>
            <Input id="bl-end" name="endHHMM" type="time" required />
          </div>
        </div>
        <div>
          <Label htmlFor="bl-reason" hint="opcional">Motivo</Label>
          <Input id="bl-reason" name="reason" placeholder="Almoço, curso, feriado..." />
        </div>

        {todaysBlocks.length > 0 ? (
          <div className="rounded-lg bg-stone-50 p-3">
            <p className="mb-1 text-xs font-medium text-stone-500">Bloqueios do dia</p>
            <ul className="space-y-1">
              {todaysBlocks.map((b) => (
                <li key={b.id} className="flex items-center justify-between text-xs text-stone-600">
                  <span>
                    {minToHHMM(b.startMin)}–{minToHHMM(b.endMin)} ·{" "}
                    {b.professionalId
                      ? data.professionals.find((p) => p.id === b.professionalId)?.name
                      : "Clínica inteira"}
                    {b.reason ? ` · ${b.reason}` : ""}
                  </span>
                  <button
                    type="button"
                    className="text-red-500 underline"
                    onClick={() =>
                      startTransition(async () => {
                        await deleteBlock({ id: b.id });
                        router.refresh();
                      })
                    }
                  >
                    remover
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <FieldError message={error} />
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="secondary" onClick={onClose}>
            Fechar
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? "Bloqueando..." : "Bloquear"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
