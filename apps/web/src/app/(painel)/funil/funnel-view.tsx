"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button, FieldError, Input, Label, Modal, Select } from "@/components/ui";
import { formatBRL } from "@/lib/format";
import { closeDeal, createDeal, moveDeal, updateDealValue } from "./actions";
import { FUNNEL_STAGES, type FunnelStage } from "./stages";

export interface DealCard {
  id: string;
  customerName: string;
  phone: string;
  stageName: string;
  value: string | null;
  source: string | null;
  notes: string | null;
  daysOpen: number;
}

export function NewDealButton({
  customers,
}: {
  customers: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  function submit(fd: FormData) {
    setError(undefined);
    startTransition(async () => {
      const result = await createDeal({
        customerId: String(fd.get("customerId") ?? ""),
        value: String(fd.get("value") ?? ""),
        notes: String(fd.get("notes") ?? ""),
      });
      if (result.ok) {
        setOpen(false);
        router.refresh();
      } else setError(result.error);
    });
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>Nova negociação</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Nova negociação">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit(new FormData(e.currentTarget));
          }}
          className="space-y-3"
        >
          <div>
            <Label htmlFor="nd-customer">Cliente</Label>
            <Select id="nd-customer" name="customerId" required>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="nd-value" hint="opcional">Valor estimado</Label>
            <Input id="nd-value" name="value" inputMode="decimal" placeholder="0,00" />
          </div>
          <div>
            <Label htmlFor="nd-notes" hint="opcional">Interesse</Label>
            <Input id="nd-notes" name="notes" placeholder="Ex.: pacote de drenagem" />
          </div>
          <FieldError message={error} />
          <div className="flex justify-end">
            <Button type="submit" disabled={pending}>
              {pending ? "Criando..." : "Criar"}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

function Card({ deal }: { deal: DealCard }) {
  const router = useRouter();
  const [losing, setLosing] = useState(false);
  const [winning, setWinning] = useState(false);
  const [editingValue, setEditingValue] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  const stageIndex = FUNNEL_STAGES.indexOf(deal.stageName as FunnelStage);

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(undefined);
    startTransition(async () => {
      const result = await fn();
      if (result.ok) router.refresh();
      else setError(result.error);
    });
  }

  return (
    <div className="rounded-lg border border-stone-200 bg-white p-3 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 truncate text-sm font-semibold text-stone-800">
          {deal.customerName}
        </p>
        {deal.source === "whatsapp" ? (
          <span
            className="shrink-0 rounded-full bg-purple-50 px-1.5 py-0.5 text-[10px] font-medium text-purple-700"
            title="Chegou sozinho pelo WhatsApp"
          >
            ✨ WhatsApp
          </span>
        ) : null}
      </div>
      <p className="mt-0.5 text-xs text-stone-500">{deal.phone}</p>
      {deal.notes ? <p className="mt-1 truncate text-xs text-stone-600">{deal.notes}</p> : null}
      <div className="mt-1.5 flex items-center justify-between text-xs">
        {editingValue ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              setEditingValue(false);
              run(() => updateDealValue({ dealId: deal.id, value: String(fd.get("value") ?? "") }));
            }}
            className="flex items-center gap-1"
          >
            <input
              name="value"
              aria-label="Valor estimado da negociação"
              defaultValue={deal.value ? String(Number(deal.value)) : ""}
              className="w-20 rounded border border-stone-300 px-1.5 py-0.5 text-xs"
              autoFocus
            />
            <button type="submit" className="text-teal-700">ok</button>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setEditingValue(true)}
            className="text-stone-600 underline-offset-2 hover:underline"
            title="Editar valor estimado"
          >
            {deal.value ? formatBRL(deal.value) : "+ valor"}
          </button>
        )}
        <span className="text-stone-400">
          {deal.daysOpen === 0 ? "hoje" : `${deal.daysOpen}d no funil`}
        </span>
      </div>

      {winning ? (
        <div className="mt-2 flex items-center gap-1.5">
          <span className="text-xs text-stone-600">Fechar como ganha?</span>
          <Button
            disabled={pending}
            onClick={() => {
              setWinning(false);
              run(() => closeDeal({ dealId: deal.id, outcome: "won" }));
            }}
            className="!px-2 !py-1 text-xs"
          >
            Confirmar
          </Button>
          <Button
            variant="ghost"
            onClick={() => setWinning(false)}
            className="!px-2 !py-1 text-xs"
          >
            Voltar
          </Button>
        </div>
      ) : losing ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            run(() =>
              closeDeal({
                dealId: deal.id,
                outcome: "lost",
                lostReason: String(fd.get("reason") ?? ""),
              }),
            );
          }}
          className="mt-2 space-y-1.5"
        >
          <Input name="reason" placeholder="Motivo (opcional)" autoFocus />
          <div className="flex gap-1.5">
            <Button type="submit" variant="danger" disabled={pending} className="!px-2 !py-1 text-xs">
              Confirmar perda
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setLosing(false)}
              className="!px-2 !py-1 text-xs"
            >
              Voltar
            </Button>
          </div>
        </form>
      ) : (
        <div className="mt-2 flex items-center justify-between">
          <div className="flex gap-1">
            <button
              type="button"
              disabled={pending || stageIndex <= 0}
              aria-label="Mover para a etapa anterior"
              onClick={() =>
                run(() => moveDeal({ dealId: deal.id, stageName: FUNNEL_STAGES[stageIndex - 1]! }))
              }
              className="rounded border border-stone-200 px-1.5 py-0.5 text-xs text-stone-500 hover:bg-stone-50 disabled:opacity-30"
            >
              ←
            </button>
            <button
              type="button"
              disabled={pending || stageIndex >= FUNNEL_STAGES.length - 1}
              aria-label="Mover para a próxima etapa"
              onClick={() =>
                run(() => moveDeal({ dealId: deal.id, stageName: FUNNEL_STAGES[stageIndex + 1]! }))
              }
              className="rounded border border-stone-200 px-1.5 py-0.5 text-xs text-stone-500 hover:bg-stone-50 disabled:opacity-30"
            >
              →
            </button>
          </div>
          <div className="flex gap-1">
            <button
              type="button"
              disabled={pending}
              onClick={() => setWinning(true)}
              className="rounded bg-emerald-50 px-1.5 py-0.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100"
            >
              ✓ Ganhou
            </button>
            <button
              type="button"
              disabled={pending}
              aria-label="Marcar como perdida"
              title="Marcar como perdida"
              onClick={() => setLosing(true)}
              className="rounded bg-red-50 px-1.5 py-0.5 text-xs font-medium text-red-600 hover:bg-red-100"
            >
              ✗
            </button>
          </div>
        </div>
      )}
      <FieldError message={error} />
    </div>
  );
}

export function FunnelBoard({ deals }: { deals: DealCard[] }) {
  return (
    <div className="flex gap-4 overflow-x-auto pb-4">
      {FUNNEL_STAGES.map((stage) => {
        const cards = deals.filter((d) => d.stageName === stage);
        return (
          <div key={stage} className="w-64 shrink-0">
            <div className="flex items-center justify-between px-1">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-stone-500">
                {stage}
              </h2>
              <span className="text-xs text-stone-400">{cards.length}</span>
            </div>
            <div className="mt-2 min-h-24 space-y-2 rounded-xl bg-stone-100/60 p-2">
              {cards.length === 0 ? (
                <p className="px-2 py-6 text-center text-xs text-stone-400">
                  {stage === FUNNEL_STAGES[0]
                    ? "Conversas novas do WhatsApp caem aqui sozinhas."
                    : "Mova os cards com as setas ← →"}
                </p>
              ) : (
                cards.map((deal) => <Card key={deal.id} deal={deal} />)
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
