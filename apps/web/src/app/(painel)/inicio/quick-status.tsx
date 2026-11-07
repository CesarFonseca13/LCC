"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { changeAppointmentStatus } from "@/app/(painel)/agenda/actions";

export function QuickStatusButtons({
  appointmentId,
  status,
  needsPrice = false,
}: {
  appointmentId: string;
  status: string;
  /** Serviço sob avaliação sem valor: o Compareceu pergunta o valor cobrado (opcional). */
  needsPrice?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();
  const [askingPrice, setAskingPrice] = useState(false);
  const [charged, setCharged] = useState("");

  function change(to: "confirmed" | "showed" | "no_show", chargedPrice?: string) {
    setError(undefined);
    startTransition(async () => {
      const result = await changeAppointmentStatus({ id: appointmentId, to, chargedPrice });
      if (!result.ok) setError(result.error);
      else setAskingPrice(false);
      router.refresh();
    });
  }

  const btn =
    "rounded-md px-2 py-1 text-xs font-medium transition disabled:opacity-50";

  if (askingPrice) {
    return (
      <span className="inline-flex flex-wrap items-center gap-1.5">
        {error ? <span className="text-xs text-red-600">{error}</span> : null}
        <input
          aria-label="Valor cobrado (R$)"
          inputMode="decimal"
          value={charged}
          onChange={(e) => setCharged(e.target.value)}
          placeholder="Valor cobrado (R$)"
          className="w-32 rounded-md border border-stone-300 px-2 py-1 text-xs"
          autoFocus
        />
        <button
          type="button"
          onClick={() => change("showed", charged)}
          disabled={pending}
          className={`${btn} bg-emerald-50 text-emerald-700 hover:bg-emerald-100`}
          title="Em branco se não houve cobrança"
        >
          Confirmar compareceu
        </button>
        <button
          type="button"
          onClick={() => setAskingPrice(false)}
          disabled={pending}
          className={`${btn} text-stone-500 hover:bg-stone-100`}
        >
          Voltar
        </button>
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      {error ? <span className="text-xs text-red-600">{error}</span> : null}
      {status === "scheduled" ? (
        <button
          type="button"
          onClick={() => change("confirmed")}
          disabled={pending}
          className={`${btn} bg-teal-50 text-teal-700 hover:bg-teal-100`}
        >
          Confirmar
        </button>
      ) : null}
      {status === "scheduled" || status === "confirmed" ? (
        <>
          <button
            type="button"
            onClick={() => (needsPrice ? setAskingPrice(true) : change("showed"))}
            disabled={pending}
            className={`${btn} bg-emerald-50 text-emerald-700 hover:bg-emerald-100`}
          >
            Compareceu
          </button>
          <button
            type="button"
            onClick={() => change("no_show")}
            disabled={pending}
            className={`${btn} bg-red-50 text-red-600 hover:bg-red-100`}
          >
            Faltou
          </button>
        </>
      ) : null}
    </span>
  );
}
