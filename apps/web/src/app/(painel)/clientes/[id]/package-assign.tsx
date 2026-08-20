"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button, FieldError, Label, Modal, Select } from "@/components/ui";
import { assignPackage } from "../actions";

export function AssignPackageButton({
  customerId,
  packages,
}: {
  customerId: string;
  packages: { id: string; name: string; priceLabel: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  function submit(fd: FormData) {
    setError(undefined);
    startTransition(async () => {
      const result = await assignPackage({
        customerId,
        packageId: String(fd.get("packageId") ?? ""),
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
      <Button onClick={() => setOpen(true)}>+ Atribuir pacote</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Atribuir pacote">
        {packages.length === 0 ? (
          <p className="text-sm text-stone-600">
            Cadastre um pacote em Serviços → Pacotes primeiro.
          </p>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit(new FormData(e.currentTarget));
            }}
            className="space-y-4"
          >
            <div>
              <Label htmlFor="ap-package">Pacote</Label>
              <Select id="ap-package" name="packageId" defaultValue="" required>
                <option value="" disabled>
                  Escolha...
                </option>
                {packages.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} — {p.priceLabel}
                  </option>
                ))}
              </Select>
            </div>
            <p className="rounded-lg bg-stone-50 p-3 text-xs text-stone-500">
              Ao atribuir, o valor do pacote entra no Financeiro como “a receber”, e os
              próximos agendamentos desse procedimento debitam as sessões automaticamente.
            </p>
            <FieldError message={error} />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Atribuindo..." : "Atribuir"}
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </>
  );
}
