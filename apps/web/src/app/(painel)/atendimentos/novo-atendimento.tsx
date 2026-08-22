"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { Button, FieldError, Input, Label, Modal, Textarea } from "@/components/ui";
import { createAppointment } from "../agenda/actions";
import { saveCustomer } from "../clientes/actions";

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
  // Ficha criada num submit anterior (ex.: deu conflito de horário no passo
  // seguinte): reusa em vez de tentar criar de novo e esbarrar em duplicata
  const createdCustomerRef = useRef<string | null>(null);
  const router = useRouter();

  function submit(formData: FormData) {
    setError(undefined);
    startTransition(async () => {
      try {
        const get = (k: string) => String(formData.get(k) ?? "");

        // Cliente nova: cria a ficha primeiro (rápida OU completa) pela mesma
        // engrenagem da tela de Clientes — validação de data/telefone inclusa
        let customerId = newCustomer ? createdCustomerRef.current : get("customerId");
        if (newCustomer && !customerId) {
          const created = await saveCustomer({
            fullName: get("newCustomerName"),
            phone: get("newCustomerPhone"),
            email: get("nc-email"),
            cpf: get("nc-cpf"),
            rg: get("nc-rg"),
            birthDate: get("nc-birthDate"),
            sex: get("nc-sex") as "feminino" | "masculino" | "outro" | "",
            insuranceName: get("nc-insuranceName"),
            insurancePlan: get("nc-insurancePlan"),
            socialName: "",
            instagram: "",
            source: "agenda",
            addressStreet: get("nc-addressStreet"),
            addressNumber: get("nc-addressNumber"),
            addressDistrict: get("nc-addressDistrict"),
            addressCity: get("nc-addressCity"),
            addressState: get("nc-addressState"),
            addressZip: get("nc-addressZip"),
            notes: "",
          });
          if (!created.ok || !created.customerId) {
            setError(
              created.error?.includes("Já existe")
                ? "Já existe uma cliente com esse WhatsApp — escolha ela na lista."
                : (created.error ?? "Não foi possível criar a ficha."),
            );
            return;
          }
          customerId = created.customerId;
          createdCustomerRef.current = created.customerId;
        }
        if (!customerId) {
          setError("Escolha a cliente.");
          return;
        }

        const result = await createAppointment({
          customerId,
          professionalId: get("professionalId"),
          procedureId: get("procedureId"),
          roomId: get("roomId") || "none",
          dateISO: get("dateISO"),
          timeHHMM: get("timeHHMM"),
          notes: get("notes"),
          allowOverlap: false,
        });
        if (result.ok) {
          createdCustomerRef.current = null;
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
      <Button
        onClick={() => {
          // Modal sempre abre zerado (modo lista, sem erro antigo)
          setNewCustomer(false);
          setError(undefined);
          createdCustomerRef.current = null;
          setOpen(true);
        }}
      >
        + Novo atendimento
      </Button>
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
              <div className="mt-1 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <Input name="newCustomerName" placeholder="Nome completo" required autoFocus />
                  <Input
                    name="newCustomerPhone"
                    inputMode="tel"
                    placeholder="(11) 98862-1152"
                    required
                  />
                </div>
                {/* Rápido por padrão; completo quando a recepção quiser */}
                <details className="rounded-lg border border-stone-200 px-3 py-2">
                  <summary className="cursor-pointer text-xs font-medium text-stone-600">
                    Ficha completa (opcional) — documentos, convênio e endereço
                  </summary>
                  <div className="mt-3 space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label htmlFor="nc-email">E-mail</Label>
                        <Input id="nc-email" name="nc-email" type="email" />
                      </div>
                      <div>
                        <Label htmlFor="nc-birth">Nascimento</Label>
                        <Input id="nc-birth" name="nc-birthDate" placeholder="dd/mm/aaaa" />
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <Label htmlFor="nc-cpf">CPF</Label>
                        <Input id="nc-cpf" name="nc-cpf" />
                      </div>
                      <div>
                        <Label htmlFor="nc-rg">RG</Label>
                        <Input id="nc-rg" name="nc-rg" />
                      </div>
                      <div>
                        <Label htmlFor="nc-sex">Sexo</Label>
                        <select id="nc-sex" name="nc-sex" defaultValue="" className={selectCls}>
                          <option value="">—</option>
                          <option value="feminino">Feminino</option>
                          <option value="masculino">Masculino</option>
                          <option value="outro">Outro</option>
                        </select>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label htmlFor="nc-insurance">Convênio</Label>
                        <Input id="nc-insurance" name="nc-insuranceName" placeholder="Unimed, Amil..." />
                      </div>
                      <div>
                        <Label htmlFor="nc-plan">Plano</Label>
                        <Input id="nc-plan" name="nc-insurancePlan" />
                      </div>
                    </div>
                    <div className="grid grid-cols-6 gap-3">
                      <div className="col-span-4">
                        <Label htmlFor="nc-street">Rua</Label>
                        <Input id="nc-street" name="nc-addressStreet" />
                      </div>
                      <div className="col-span-2">
                        <Label htmlFor="nc-number">Número</Label>
                        <Input id="nc-number" name="nc-addressNumber" />
                      </div>
                      <div className="col-span-2">
                        <Label htmlFor="nc-district">Bairro</Label>
                        <Input id="nc-district" name="nc-addressDistrict" />
                      </div>
                      <div className="col-span-2">
                        <Label htmlFor="nc-city">Cidade</Label>
                        <Input id="nc-city" name="nc-addressCity" />
                      </div>
                      <div className="col-span-1">
                        <Label htmlFor="nc-state">UF</Label>
                        <Input id="nc-state" name="nc-addressState" maxLength={2} />
                      </div>
                      <div className="col-span-1">
                        <Label htmlFor="nc-zip">CEP</Label>
                        <Input id="nc-zip" name="nc-addressZip" />
                      </div>
                    </div>
                  </div>
                </details>
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
