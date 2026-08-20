"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button, FieldError, Label, Modal, Select } from "@/components/ui";
import { mergeCustomers, toggleAutomationsBlocked } from "../actions";

export function HeaderActions({
  customerId,
  blocked,
  others,
}: {
  customerId: string;
  blocked: boolean;
  others: { id: string; label: string }[];
}) {
  const [mergeOpen, setMergeOpen] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function toggleBlock() {
    startTransition(async () => {
      await toggleAutomationsBlocked({ id: customerId, blocked: !blocked });
      router.refresh();
    });
  }

  function submitMerge(formData: FormData) {
    setError(undefined);
    const sourceId = String(formData.get("sourceId") ?? "");
    startTransition(async () => {
      try {
        const result = await mergeCustomers({ sourceId, targetId: customerId });
        if (result.ok) {
          setMergeOpen(false);
          router.refresh();
        } else {
          setError(result.error ?? "Não foi possível mesclar.");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Não foi possível mesclar.");
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <label className="flex cursor-pointer items-center gap-2 text-sm text-stone-600">
        <input
          type="checkbox"
          checked={blocked}
          onChange={toggleBlock}
          disabled={pending}
          className="h-4 w-4 rounded border-stone-300 accent-red-600"
        />
        Bloqueada para automações
      </label>
      <p className="max-w-56 text-right text-xs text-stone-400">
        {blocked
          ? "Nenhuma mensagem automática será enviada. Conversas manuais continuam."
          : "Recebe lembretes e mensagens automáticas normalmente."}
      </p>
      <Button variant="ghost" onClick={() => setMergeOpen(true)}>
        Mesclar duplicata
      </Button>

      <Modal
        open={mergeOpen}
        onClose={() => setMergeOpen(false)}
        title="Mesclar cliente duplicada"
      >
        <form action={submitMerge} className="space-y-4">
          <p className="text-sm text-stone-600">
            Escolha o cadastro <strong>duplicado</strong>: o histórico, a anamnese e os
            telefones dele passam para <strong>esta ficha</strong>, e a duplicata é
            arquivada. Essa ação não pode ser desfeita.
          </p>
          <div>
            <Label htmlFor="mg-source">Cadastro duplicado</Label>
            <Select id="mg-source" name="sourceId" defaultValue="" required>
              <option value="" disabled>
                Escolha...
              </option>
              {others.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </Select>
          </div>

          <FieldError message={error} />

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={() => setMergeOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Mesclando..." : "Mesclar nesta ficha"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
