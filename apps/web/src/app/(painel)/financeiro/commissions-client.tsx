"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button, FieldError, Input, Label, Modal, Select } from "@/components/ui";
import { deleteCommissionRule, payCommissions, saveCommissionRule } from "./actions";

interface Option {
  id: string;
  name: string;
}

export function RuleButton({
  professionals,
  procedures,
}: {
  professionals: Option[];
  procedures: Option[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  function submit(fd: FormData) {
    setError(undefined);
    startTransition(async () => {
      const result = await saveCommissionRule({
        professionalId: String(fd.get("professionalId") ?? ""),
        procedureId: String(fd.get("procedureId") ?? "all"),
        value: String(fd.get("value") ?? ""),
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
        Nova regra
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Regra de comissão">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit(new FormData(e.currentTarget));
          }}
          className="space-y-3"
        >
          <div>
            <Label htmlFor="cr-prof">Profissional</Label>
            <Select id="cr-prof" name="professionalId" required>
              {professionals.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="cr-proc" hint="a regra específica vence a geral">
              Procedimento
            </Label>
            <Select id="cr-proc" name="procedureId">
              <option value="all">Todos os procedimentos</option>
              {procedures.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="cr-value" hint="% sobre o valor do atendimento">
              Percentual
            </Label>
            <Input id="cr-value" name="value" inputMode="decimal" placeholder="30" required />
          </div>
          <FieldError message={error} />
          <div className="flex justify-end">
            <Button type="submit" disabled={pending}>
              {pending ? "Salvando..." : "Salvar regra"}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

export function DeleteRuleButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      className="text-xs text-red-500 hover:underline disabled:opacity-50"
      onClick={() =>
        startTransition(async () => {
          await deleteCommissionRule({ id });
          router.refresh();
        })
      }
    >
      remover
    </button>
  );
}

export function PayCommissionsButton({
  professionalId,
  professionalName,
  total,
  entryIds,
}: {
  professionalId: string;
  professionalName: string;
  total: string;
  entryIds: string[];
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  if (!confirming) {
    return (
      <span className="inline-flex flex-col items-end gap-1">
        <Button variant="secondary" onClick={() => setConfirming(true)}>
          Marcar como pago
        </Button>
        {error ? <span className="text-xs text-red-600">{error}</span> : null}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-2 text-sm">
      <span className="text-stone-600">
        Pagar {total} para {professionalName}? Vira despesa paga no financeiro.
      </span>
      <Button
        disabled={pending}
        onClick={() => {
          setError(undefined);
          startTransition(async () => {
            const result = await payCommissions({ professionalId, entryIds });
            if (result.ok) {
              setConfirming(false);
              router.refresh();
            } else {
              setConfirming(false);
              setError(result.error);
            }
          });
        }}
      >
        {pending ? "Pagando..." : "Confirmar"}
      </Button>
      <Button variant="ghost" onClick={() => setConfirming(false)}>
        Cancelar
      </Button>
    </span>
  );
}
