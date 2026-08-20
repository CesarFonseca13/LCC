"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { prepareOutreach } from "@/app/(painel)/inteligencia/actions";

/**
 * "Preparar mensagem" — transforma a sugestão da Inteligência em um item
 * da fila de Aprovações. Nada é enviado sem revisão humana.
 */
export function PrepareMessageButton({ customerId }: { customerId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string>();

  if (done) {
    return (
      <span className="text-xs font-medium text-emerald-600">
        Enviada para Aprovações ✓
      </span>
    );
  }

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setError(undefined);
          startTransition(async () => {
            const result = await prepareOutreach({ customerId });
            if (result.ok) {
              setDone(true);
              router.refresh();
            } else {
              setError(result.error);
            }
          });
        }}
        className="rounded-lg border border-teal-200 bg-teal-50 px-3 py-1.5 text-xs font-medium text-teal-800 transition hover:bg-teal-100 disabled:opacity-60"
      >
        {pending ? "Preparando..." : "✨ Preparar mensagem"}
      </button>
      {error ? <span className="max-w-56 text-right text-xs text-red-600">{error}</span> : null}
    </span>
  );
}
