"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button, FieldError } from "@/components/ui";
import { deleteOnboardingForm, setOnboardingFormStatus } from "../actions";

export function FormAdminActions({ id, status }: { id: string; status: "new" | "done" }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();
  const [confirmDelete, setConfirmDelete] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <a href={`/admin/formularios/${id}/pdf`} className="rounded-lg bg-teal-700 px-3.5 py-2 text-sm font-medium text-white shadow-sm hover:bg-teal-800">
        Baixar PDF
      </a>
      <Button
        variant="secondary"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const r = await setOnboardingFormStatus({ id, status: status === "new" ? "done" : "new" });
            if (!r.ok) setError(r.error);
            else router.refresh();
          })
        }
      >
        {status === "new" ? "Marcar como configurada" : "Voltar para novo"}
      </Button>
      {confirmDelete ? (
        <>
          <Button
            variant="danger"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const r = await deleteOnboardingForm({ id });
                if (!r.ok) setError(r.error);
                else router.push("/admin/formularios");
              })
            }
          >
            Confirmar exclusão
          </Button>
          <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
            Cancelar
          </Button>
        </>
      ) : (
        <Button variant="ghost" onClick={() => setConfirmDelete(true)}>
          Apagar
        </Button>
      )}
      <FieldError message={error} />
    </div>
  );
}
