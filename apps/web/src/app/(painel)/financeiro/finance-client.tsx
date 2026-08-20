"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button, FieldError, Input, Label, Modal, Select } from "@/components/ui";
import { confirmReceivable, createPayable, markPayablePaid } from "./actions";

const METHODS = [
  ["pix", "Pix"],
  ["cash", "Dinheiro"],
  ["credit", "Cartão de crédito"],
  ["debit", "Cartão de débito"],
  ["transfer", "Transferência"],
  ["boleto", "Boleto"],
] as const;

export function ReceiveButton({ id }: { id: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  function confirm(fd: FormData) {
    setError(undefined);
    startTransition(async () => {
      const result = await confirmReceivable({
        id,
        method: String(fd.get("method") ?? "pix"),
      });
      if (result.ok) {
        setOpen(false);
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Confirmar recebimento
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Confirmar recebimento">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            confirm(new FormData(e.currentTarget));
          }}
          className="space-y-4"
        >
          <div>
            <Label htmlFor="rc-method">Como a cliente pagou?</Label>
            <Select id="rc-method" name="method" defaultValue="pix">
              {METHODS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </div>
          <FieldError message={error} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Confirmando..." : "Confirmar"}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

export function PayButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="secondary"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await markPayablePaid({ id });
          router.refresh();
        })
      }
    >
      {pending ? "..." : "Marcar paga"}
    </Button>
  );
}

const EXPENSE_CATEGORIES = ["Aluguel", "Materiais", "Salários", "Marketing", "Impostos", "Outros"];

export function PayableFormButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  function submit(fd: FormData) {
    setError(undefined);
    startTransition(async () => {
      const result = await createPayable({
        description: String(fd.get("description") ?? ""),
        supplier: String(fd.get("supplier") ?? ""),
        amount: String(fd.get("amount") ?? ""),
        dueDate: String(fd.get("dueDate") ?? ""),
        categoryName: String(fd.get("categoryName") ?? "Outros"),
      });
      if (result.ok) {
        setOpen(false);
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>+ Nova despesa</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Nova despesa">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit(new FormData(e.currentTarget));
          }}
          className="space-y-4"
        >
          <div>
            <Label htmlFor="pd-desc">Descrição</Label>
            <Input id="pd-desc" name="description" placeholder="Ex.: Aluguel de agosto" required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="pd-amount">Valor (R$)</Label>
              <Input id="pd-amount" name="amount" inputMode="decimal" placeholder="2.000,00" required />
            </div>
            <div>
              <Label htmlFor="pd-due">Vencimento</Label>
              <Input id="pd-due" name="dueDate" type="date" required />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="pd-cat">Categoria</Label>
              <Select id="pd-cat" name="categoryName" defaultValue="Outros">
                {EXPENSE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="pd-supplier" hint="opcional">Fornecedor</Label>
              <Input id="pd-supplier" name="supplier" />
            </div>
          </div>
          <FieldError message={error} />
          <div className="flex justify-end gap-2">
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
