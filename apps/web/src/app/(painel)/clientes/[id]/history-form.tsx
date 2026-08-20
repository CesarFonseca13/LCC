"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button, FieldError, Input, Label, Modal, Select, Textarea } from "@/components/ui";
import { addHistoryEntry } from "../actions";

export function HistoryFormButton({
  customerId,
  procedures,
}: {
  customerId: string;
  procedures: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string>();
  const [procedureId, setProcedureId] = useState("none");
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function submit(formData: FormData) {
    setError(undefined);
    startTransition(async () => {
      try {
        const result = await addHistoryEntry({
          customerId,
          occurredOn: String(formData.get("occurredOn") ?? ""),
          procedureId: String(formData.get("procedureId") ?? "none"),
          procedureName: String(formData.get("procedureName") ?? ""),
          amount: String(formData.get("amount") ?? ""),
          notes: String(formData.get("notes") ?? ""),
        });
        if (result.ok) {
          setOpen(false);
          router.refresh();
        } else {
          setError(result.error ?? "Não foi possível salvar.");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Não foi possível salvar.");
      }
    });
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>+ Inserir histórico</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Inserir atendimento antigo">
        <form action={submit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="h-date">Data do atendimento</Label>
              <Input id="h-date" name="occurredOn" placeholder="dd/mm/aaaa" required />
            </div>
            <div>
              <Label htmlFor="h-amount" hint="opcional">Valor (R$)</Label>
              <Input id="h-amount" name="amount" inputMode="decimal" placeholder="180,00" />
            </div>
          </div>

          <div>
            <Label htmlFor="h-procedure">Procedimento</Label>
            <Select
              id="h-procedure"
              name="procedureId"
              value={procedureId}
              onChange={(e) => setProcedureId(e.target.value)}
            >
              <option value="none">Outro (descrever abaixo)</option>
              {procedures.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </div>

          {procedureId === "none" ? (
            <div>
              <Label htmlFor="h-procname">Descrição do procedimento</Label>
              <Input
                id="h-procname"
                name="procedureName"
                placeholder="Ex.: Microagulhamento"
              />
            </div>
          ) : null}

          <div>
            <Label htmlFor="h-notes" hint="opcional">Observações</Label>
            <Textarea id="h-notes" name="notes" rows={2} />
          </div>

          <FieldError message={error} />

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Salvando..." : "Salvar"}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
