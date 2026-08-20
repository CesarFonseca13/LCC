"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button, FieldError, Input, Label, Modal, Textarea } from "@/components/ui";
import { saveProcedure } from "./actions";

export interface ProcedureInitial {
  id?: string;
  name: string;
  category: string;
  durationMinutes: number;
  price: string;
  returnDays: string;
  touchupDays: string;
  preCare: string;
  postCare: string;
  commissionDefaultPct: string;
}

const EMPTY: ProcedureInitial = {
  name: "",
  category: "",
  durationMinutes: 60,
  price: "",
  returnDays: "",
  touchupDays: "",
  preCare: "",
  postCare: "",
  commissionDefaultPct: "",
};

export function ProcedureFormButton({ initial }: { initial?: ProcedureInitial }) {
  const isEdit = Boolean(initial?.id);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function submit(formData: FormData) {
    setError(undefined);
    startTransition(async () => {
      try {
        const result = await saveProcedure({
          id: initial?.id,
          name: String(formData.get("name") ?? ""),
          category: String(formData.get("category") ?? ""),
          durationMinutes: String(formData.get("durationMinutes") ?? ""),
          price: String(formData.get("price") ?? ""),
          returnDays: String(formData.get("returnDays") ?? ""),
          touchupDays: String(formData.get("touchupDays") ?? ""),
          preCare: String(formData.get("preCare") ?? ""),
          postCare: String(formData.get("postCare") ?? ""),
          commissionDefaultPct: String(formData.get("commissionDefaultPct") ?? ""),
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
        <Button onClick={() => setOpen(true)}>+ Novo procedimento</Button>
      )}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={isEdit ? `Editar ${v.name}` : "Novo procedimento"}
      >
        <form action={submit} className="space-y-4">
          <div>
            <Label htmlFor="p-name">Nome</Label>
            <Input
              id="p-name"
              name="name"
              defaultValue={v.name}
              placeholder="Ex.: Limpeza de Pele"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="p-category" hint="opcional">Categoria</Label>
              <Input
                id="p-category"
                name="category"
                defaultValue={v.category}
                placeholder="Ex.: Facial"
              />
            </div>
            <div>
              <Label htmlFor="p-duration">Duração (minutos)</Label>
              <Input
                id="p-duration"
                name="durationMinutes"
                type="number"
                min={5}
                max={600}
                defaultValue={v.durationMinutes}
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="p-price">Preço (R$)</Label>
              <Input
                id="p-price"
                name="price"
                inputMode="decimal"
                defaultValue={v.price}
                placeholder="180,00"
                required
              />
            </div>
            <div>
              <Label htmlFor="p-commission" hint="opcional">Comissão padrão (%)</Label>
              <Input
                id="p-commission"
                name="commissionDefaultPct"
                inputMode="decimal"
                defaultValue={v.commissionDefaultPct}
                placeholder="30"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="p-return" hint="dias — opcional">Prazo de retorno</Label>
              <Input
                id="p-return"
                name="returnDays"
                type="number"
                min={1}
                defaultValue={v.returnDays}
                placeholder="Ex.: 120"
              />
              <p className="mt-1 text-xs text-stone-400">
                Quando vencer, a cliente entra na reativação automática.
              </p>
            </div>
            <div>
              <Label htmlFor="p-touchup" hint="dias — opcional">Retoque</Label>
              <Input
                id="p-touchup"
                name="touchupDays"
                type="number"
                min={1}
                defaultValue={v.touchupDays}
                placeholder="Ex.: 15"
              />
              <p className="mt-1 text-xs text-stone-400">
                Após o atendimento, o sistema oferece o retoque sozinho.
              </p>
            </div>
          </div>

          <div>
            <Label htmlFor="p-precare" hint="opcional">Pré-cuidados</Label>
            <Textarea
              id="p-precare"
              name="preCare"
              rows={2}
              defaultValue={v.preCare}
              placeholder="Enviado à cliente antes do atendimento. Ex.: Evite álcool 24h antes."
            />
          </div>

          <div>
            <Label htmlFor="p-postcare" hint="opcional">Pós-cuidados</Label>
            <Textarea
              id="p-postcare"
              name="postCare"
              rows={2}
              defaultValue={v.postCare}
              placeholder="Enviado após o atendimento. Ex.: Evite sol nas próximas 24h."
            />
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
