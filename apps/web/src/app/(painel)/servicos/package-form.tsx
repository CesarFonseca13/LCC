"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button, FieldError, Input, Label, Modal, Select } from "@/components/ui";
import { savePackage } from "./actions";

export interface PackageInitial {
  id?: string;
  name: string;
  price: string;
  validityDays: string;
  procedureId: string;
  sessions: number;
}

const EMPTY: PackageInitial = {
  name: "",
  price: "",
  validityDays: "",
  procedureId: "",
  sessions: 10,
};

export function PackageFormButton({
  procedures,
  initial,
}: {
  procedures: { id: string; name: string }[];
  initial?: PackageInitial;
}) {
  const isEdit = Boolean(initial?.id);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function submit(formData: FormData) {
    setError(undefined);
    startTransition(async () => {
      try {
        const result = await savePackage({
          id: initial?.id,
          name: String(formData.get("name") ?? ""),
          price: String(formData.get("price") ?? ""),
          validityDays: String(formData.get("validityDays") ?? ""),
          procedureId: String(formData.get("procedureId") ?? ""),
          sessions: String(formData.get("sessions") ?? ""),
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

  const v = initial ?? EMPTY;

  return (
    <>
      {isEdit ? (
        <Button variant="ghost" onClick={() => setOpen(true)}>
          Editar
        </Button>
      ) : (
        <Button onClick={() => setOpen(true)}>+ Novo pacote</Button>
      )}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={isEdit ? `Editar ${v.name}` : "Novo pacote"}
      >
        {procedures.length === 0 ? (
          <p className="text-sm text-stone-600">
            Cadastre primeiro um procedimento — o pacote é um conjunto de sessões dele.
          </p>
        ) : (
          <form action={submit} className="space-y-4">
            <div>
              <Label htmlFor="pk-name">Nome do pacote</Label>
              <Input
                id="pk-name"
                name="name"
                defaultValue={v.name}
                placeholder="Ex.: Drenagem — 12 sessões"
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="pk-procedure">Procedimento</Label>
                <Select
                  id="pk-procedure"
                  name="procedureId"
                  defaultValue={v.procedureId}
                  required
                >
                  <option value="" disabled>
                    Escolha...
                  </option>
                  {procedures.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="pk-sessions">Sessões</Label>
                <Input
                  id="pk-sessions"
                  name="sessions"
                  type="number"
                  min={1}
                  max={100}
                  defaultValue={v.sessions}
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="pk-price">Preço do pacote (R$)</Label>
                <Input
                  id="pk-price"
                  name="price"
                  inputMode="decimal"
                  defaultValue={v.price}
                  placeholder="1.500,00"
                  required
                />
              </div>
              <div>
                <Label htmlFor="pk-validity" hint="dias — opcional">Validade</Label>
                <Input
                  id="pk-validity"
                  name="validityDays"
                  type="number"
                  min={1}
                  defaultValue={v.validityDays}
                  placeholder="Ex.: 180"
                />
                <p className="mt-1 text-xs text-stone-400">
                  Perto de vencer, a renovação automática avisa a cliente.
                </p>
              </div>
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
        )}
      </Modal>
    </>
  );
}
