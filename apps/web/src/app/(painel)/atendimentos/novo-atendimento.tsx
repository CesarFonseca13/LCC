"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button, FieldError, Input, Label, Modal, Textarea } from "@/components/ui";
import { createAppointment } from "../agenda/actions";

export interface Option {
  id: string;
  name: string;
}

/** Criação manual de atendimento — mesma engrenagem da Agenda (cadências,
 *  funil e conflitos de horário inclusos), acessível da lista completa. */
export function NovoAtendimentoButton({
  customers,
  procedures,
  professionals,
  rooms,
  todayISO,
}: {
  customers: Option[];
  procedures: Option[];
  professionals: Option[];
  rooms: Option[];
  todayISO: string;
}) {
  const [open, setOpen] = useState(false);
  const [newCustomer, setNewCustomer] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function submit(formData: FormData) {
    setError(undefined);
    startTransition(async () => {
      try {
        const get = (k: string) => String(formData.get(k) ?? "");
        const result = await createAppointment({
          customerId: newCustomer ? undefined : get("customerId") || undefined,
          newCustomerName: newCustomer ? get("newCustomerName") : undefined,
          newCustomerPhone: newCustomer ? get("newCustomerPhone") : undefined,
          professionalId: get("professionalId"),
          procedureId: get("procedureId"),
          roomId: get("roomId") || "none",
          dateISO: get("dateISO"),
          timeHHMM: get("timeHHMM"),
          notes: get("notes"),
          allowOverlap: false,
        });
        if (result.ok) {
          setOpen(false);
          router.refresh();
        } else {
          setError(result.error ?? "Não foi possível criar o atendimento.");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Não foi possível criar.");
      }
    });
  }

  const selectCls =
    "mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-800 focus:border-teal-600 focus:outline-none";

  return (
    <>
      <Button onClick={() => setOpen(true)}>+ Novo atendimento</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Novo atendimento">
        <form action={submit} className="space-y-4">
          <div>
            <div className="flex items-center justify-between">
              <Label htmlFor="na-customer">Cliente</Label>
              <button
                type="button"
                className="text-xs text-teal-700 hover:underline"
                onClick={() => setNewCustomer((v) => !v)}
              >
                {newCustomer ? "escolher da lista" : "é cliente nova?"}
              </button>
            </div>
            {newCustomer ? (
              <div className="mt-1 grid grid-cols-2 gap-3">
                <Input name="newCustomerName" placeholder="Nome completo" required autoFocus />
                <Input
                  name="newCustomerPhone"
                  inputMode="tel"
                  placeholder="(11) 98862-1152"
                  required
                />
              </div>
            ) : (
              <select id="na-customer" name="customerId" required className={selectCls}>
                <option value="">Escolha a cliente...</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="na-procedure">Procedimento</Label>
              <select id="na-procedure" name="procedureId" required className={selectCls}>
                <option value="">Escolha...</option>
                {procedures.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="na-professional">Profissional</Label>
              <select id="na-professional" name="professionalId" required className={selectCls}>
                <option value="">Escolha...</option>
                {professionals.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label htmlFor="na-date">Data</Label>
              <Input id="na-date" name="dateISO" type="date" defaultValue={todayISO} required />
            </div>
            <div>
              <Label htmlFor="na-time">Hora</Label>
              <Input id="na-time" name="timeHHMM" type="time" required />
            </div>
            <div>
              <Label htmlFor="na-room" hint="opcional">Sala</Label>
              <select id="na-room" name="roomId" className={selectCls} defaultValue="">
                <option value="">—</option>
                {rooms.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <Label htmlFor="na-notes" hint="opcional">Observações</Label>
            <Textarea id="na-notes" name="notes" rows={2} />
          </div>

          <FieldError message={error} />

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Criando..." : "Criar atendimento"}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
