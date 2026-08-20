"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button, FieldError, Input, Label, Modal, Select } from "@/components/ui";
import {
  createStockItem,
  createStockMovement,
  deleteProcedureSupply,
  saveProcedureSupply,
} from "./actions";

interface Option {
  id: string;
  name: string;
}

export function NewItemButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  function submit(fd: FormData) {
    setError(undefined);
    startTransition(async () => {
      const result = await createStockItem({
        name: String(fd.get("name") ?? ""),
        unit: String(fd.get("unit") ?? "un"),
        minQuantity: String(fd.get("minQuantity") ?? "0"),
        cost: String(fd.get("cost") ?? ""),
      });
      if (result.ok) {
        setOpen(false);
        router.refresh();
      } else setError(result.error);
    });
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>Novo item</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Novo item de estoque">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit(new FormData(e.currentTarget));
          }}
          className="space-y-3"
        >
          <div>
            <Label htmlFor="si-name">Nome</Label>
            <Input id="si-name" name="name" placeholder="Toxina botulínica 100U" required />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label htmlFor="si-unit" hint="un, ml, g...">Unidade</Label>
              <Input id="si-unit" name="unit" defaultValue="un" required />
            </div>
            <div>
              <Label htmlFor="si-min" hint="alerta abaixo disso">Mínimo</Label>
              <Input id="si-min" name="minQuantity" inputMode="decimal" defaultValue="0" />
            </div>
            <div>
              <Label htmlFor="si-cost" hint="para o custo de materiais">Custo unit.</Label>
              <Input id="si-cost" name="cost" inputMode="decimal" placeholder="0,00" />
            </div>
          </div>
          <FieldError message={error} />
          <div className="flex justify-end">
            <Button type="submit" disabled={pending}>
              {pending ? "Salvando..." : "Salvar item"}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

export function MovementButton({ items }: { items: Option[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"purchase" | "adjustment" | "loss">("purchase");
  const [payable, setPayable] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  function submit(fd: FormData) {
    setError(undefined);
    startTransition(async () => {
      const result = await createStockMovement({
        stockItemId: String(fd.get("stockItemId") ?? ""),
        kind,
        quantity: String(fd.get("quantity") ?? ""),
        unitCost: String(fd.get("unitCost") ?? ""),
        notes: String(fd.get("notes") ?? ""),
        createPayable: payable,
        supplier: String(fd.get("supplier") ?? ""),
      });
      if (result.ok) {
        setOpen(false);
        router.refresh();
      } else setError(result.error);
    });
  }

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Lançar movimento
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Movimento de estoque">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit(new FormData(e.currentTarget));
          }}
          className="space-y-3"
        >
          <div>
            <Label htmlFor="mv-item">Item</Label>
            <Select id="mv-item" name="stockItemId" required>
              {items.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex gap-3 text-sm">
            {(
              [
                ["purchase", "Compra (entra)"],
                ["loss", "Perda (sai)"],
                ["adjustment", "Ajuste (+/-)"],
              ] as const
            ).map(([value, label]) => (
              <label key={value} className="flex cursor-pointer items-center gap-1.5 text-stone-700">
                <input
                  type="radio"
                  name="mv-kind"
                  checked={kind === value}
                  onChange={() => setKind(value)}
                  className="h-4 w-4 accent-teal-700"
                />
                {label}
              </label>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="mv-qty" hint={kind === "adjustment" ? "negativo = saída" : undefined}>
                Quantidade
              </Label>
              <Input id="mv-qty" name="quantity" inputMode="decimal" required />
            </div>
            {kind === "purchase" ? (
              <div>
                <Label htmlFor="mv-cost">Custo unitário</Label>
                <Input
                  id="mv-cost"
                  name="unitCost"
                  inputMode="decimal"
                  placeholder="0,00"
                  required={payable}
                />
              </div>
            ) : null}
          </div>
          {kind === "purchase" ? (
            <div className="space-y-2 rounded-lg bg-stone-50 px-3 py-2.5">
              <label className="flex cursor-pointer items-center gap-2 text-sm text-stone-700">
                <input
                  type="checkbox"
                  checked={payable}
                  onChange={(e) => setPayable(e.target.checked)}
                  className="h-4 w-4 accent-teal-700"
                />
                Gerar conta a pagar no financeiro (vence em 14 dias)
              </label>
              {payable ? (
                <Input name="supplier" placeholder="Fornecedor (opcional)" />
              ) : null}
            </div>
          ) : null}
          <div>
            <Label htmlFor="mv-notes">Observação</Label>
            <Input id="mv-notes" name="notes" placeholder="opcional" />
          </div>
          <FieldError message={error} />
          <div className="flex justify-end">
            <Button type="submit" disabled={pending}>
              {pending ? "Lançando..." : "Lançar"}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

export function SupplyEditor({
  procedures,
  items,
  supplies,
}: {
  procedures: Option[];
  items: Option[];
  supplies: { id: string; procedureName: string; itemName: string; quantity: string; unit: string }[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  function submit(fd: FormData, form: HTMLFormElement) {
    setError(undefined);
    startTransition(async () => {
      const result = await saveProcedureSupply({
        procedureId: String(fd.get("procedureId") ?? ""),
        stockItemId: String(fd.get("stockItemId") ?? ""),
        quantityPerSession: String(fd.get("quantity") ?? ""),
      });
      if (result.ok) {
        form.reset();
        router.refresh();
      } else setError(result.error);
    });
  }

  return (
    <div className="space-y-3">
      {supplies.length === 0 ? (
        <p className="text-sm text-stone-500">
          Nenhum consumo configurado ainda — diga quanto cada procedimento gasta por
          sessão e o estoque baixa sozinho no “Compareceu”.
        </p>
      ) : (
        <ul className="divide-y divide-stone-100 rounded-lg border border-stone-200 bg-white">
          {supplies.map((s) => (
            <li key={s.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
              <span className="text-stone-700">
                <span className="font-medium">{s.procedureName}</span> consome{" "}
                {Number(s.quantity)} {s.unit} de {s.itemName}
              </span>
              <button
                type="button"
                className="text-xs text-red-500 hover:underline"
                onClick={() =>
                  startTransition(async () => {
                    await deleteProcedureSupply({ id: s.id });
                    router.refresh();
                  })
                }
              >
                remover
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(new FormData(e.currentTarget), e.currentTarget);
        }}
        className="flex flex-wrap items-end gap-2"
      >
        <div className="min-w-44 flex-1">
          <Label htmlFor="sp-proc">Procedimento</Label>
          <Select id="sp-proc" name="procedureId" required>
            {procedures.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="min-w-44 flex-1">
          <Label htmlFor="sp-item">Item</Label>
          <Select id="sp-item" name="stockItemId" required>
            {items.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-28">
          <Label htmlFor="sp-qty">Por sessão</Label>
          <Input id="sp-qty" name="quantity" inputMode="decimal" required />
        </div>
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending ? "..." : "Adicionar"}
        </Button>
      </form>
      <FieldError message={error} />
    </div>
  );
}
