"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { changeAppointmentStatus } from "@/app/(painel)/agenda/actions";

export function QuickStatusButtons({
  appointmentId,
  status,
}: {
  appointmentId: string;
  status: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();

  function change(to: "confirmed" | "showed" | "no_show") {
    setError(undefined);
    startTransition(async () => {
      const result = await changeAppointmentStatus({ id: appointmentId, to });
      if (!result.ok) setError(result.error);
      router.refresh();
    });
  }

  const btn =
    "rounded-md px-2 py-1 text-xs font-medium transition disabled:opacity-50";

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
            onClick={() => change("showed")}
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
