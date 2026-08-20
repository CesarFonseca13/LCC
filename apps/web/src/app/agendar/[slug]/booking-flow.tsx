"use client";

import { useState, useTransition } from "react";
import { bookOnline, getBookingSlots } from "./actions";
import type { FreeSlot } from "@clinicaos/db";

interface ProcedureOption {
  id: string;
  name: string;
  durationMinutes: number;
  priceLabel: string;
}

export function BookingFlow({
  slug,
  procedures,
}: {
  slug: string;
  procedures: ProcedureOption[];
}) {
  const [step, setStep] = useState<"procedure" | "slot" | "identify" | "done">("procedure");
  const [procedure, setProcedure] = useState<ProcedureOption | null>(null);
  const [slots, setSlots] = useState<FreeSlot[]>([]);
  const [slot, setSlot] = useState<FreeSlot | null>(null);
  const [whenLabel, setWhenLabel] = useState("");
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  function chooseProcedure(p: ProcedureOption) {
    setProcedure(p);
    setError(undefined);
    startTransition(async () => {
      const result = await getBookingSlots(slug, p.id);
      if (result.ok && result.slots) {
        setSlots(result.slots);
        setStep("slot");
      } else {
        setError(result.error);
      }
    });
  }

  function submitIdentify(fd: FormData) {
    setError(undefined);
    startTransition(async () => {
      const result = await bookOnline({
        slug,
        procedureId: procedure!.id,
        slotId: slot!.slotId,
        name: String(fd.get("name") ?? ""),
        phone: String(fd.get("phone") ?? ""),
      });
      if (result.ok) {
        setWhenLabel(result.whenLabel ?? "");
        setStep("done");
      } else if (result.conflict) {
        setError(result.error);
        // Recarrega os horários e volta um passo
        const fresh = await getBookingSlots(slug, procedure!.id);
        if (fresh.ok && fresh.slots) setSlots(fresh.slots);
        setSlot(null);
        setStep("slot");
      } else {
        setError(result.error);
      }
    });
  }

  if (step === "done") {
    return (
      <div className="space-y-3 text-center">
        <p className="text-4xl">🎉</p>
        <h1 className="text-lg font-semibold text-stone-800">Horário reservado!</h1>
        <p className="text-sm capitalize text-stone-600">{whenLabel}</p>
        <p className="text-sm text-stone-500">
          Você vai receber a confirmação e os lembretes pelo WhatsApp. Até lá! 💛
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Passos */}
      <div className="flex items-center gap-1.5 text-xs text-stone-400">
        <span className={step === "procedure" ? "font-semibold text-teal-800" : ""}>
          1. Procedimento
        </span>
        <span>›</span>
        <span className={step === "slot" ? "font-semibold text-teal-800" : ""}>2. Horário</span>
        <span>›</span>
        <span className={step === "identify" ? "font-semibold text-teal-800" : ""}>
          3. Seus dados
        </span>
      </div>

      {step === "procedure" ? (
        <div className="space-y-2">
          {procedures.map((p) => (
            <button
              key={p.id}
              type="button"
              disabled={pending}
              onClick={() => chooseProcedure(p)}
              className="w-full rounded-xl border border-stone-200 px-4 py-3 text-left transition hover:border-teal-300 hover:bg-teal-50 disabled:opacity-60"
            >
              <p className="text-sm font-semibold text-stone-800">{p.name}</p>
              <p className="text-xs text-stone-500">
                {p.durationMinutes} min · a partir de {p.priceLabel}
              </p>
            </button>
          ))}
        </div>
      ) : null}

      {step === "slot" ? (
        <div className="space-y-2">
          <p className="text-sm text-stone-600">
            <strong>{procedure?.name}</strong> — escolha o melhor horário:
          </p>
          {slots.length === 0 ? (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
              Sem horários livres nos próximos dias — chame a clínica no WhatsApp que a
              gente dá um jeitinho!
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-2">
              {slots.map((s) => (
                <button
                  key={s.slotId}
                  type="button"
                  onClick={() => {
                    setSlot(s);
                    setStep("identify");
                  }}
                  className="rounded-xl border border-stone-200 px-4 py-2.5 text-left text-sm text-stone-700 transition hover:border-teal-300 hover:bg-teal-50"
                >
                  {s.label}
                </button>
              ))}
            </div>
          )}
          <button
            type="button"
            className="text-xs text-stone-400 underline"
            onClick={() => setStep("procedure")}
          >
            ← trocar procedimento
          </button>
        </div>
      ) : null}

      {step === "identify" ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submitIdentify(new FormData(e.currentTarget));
          }}
          className="space-y-3"
        >
          <p className="rounded-lg bg-teal-50 px-3 py-2 text-sm text-teal-900">
            {procedure?.name} · {slot?.label}
          </p>
          <div>
            <label htmlFor="bk-name" className="text-sm font-medium text-stone-700">
              Seu nome completo
            </label>
            <input
              id="bk-name"
              name="name"
              required
              className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-100"
            />
          </div>
          <div>
            <label htmlFor="bk-phone" className="text-sm font-medium text-stone-700">
              Seu WhatsApp
            </label>
            <input
              id="bk-phone"
              name="phone"
              inputMode="tel"
              placeholder="(11) 98862-1152"
              required
              className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-100"
            />
          </div>
          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-lg bg-teal-700 px-4 py-3 text-sm font-semibold text-white transition hover:bg-teal-800 disabled:opacity-60"
          >
            {pending ? "Reservando..." : "Confirmar horário"}
          </button>
          <button
            type="button"
            className="w-full text-xs text-stone-400 underline"
            onClick={() => setStep("slot")}
          >
            ← escolher outro horário
          </button>
        </form>
      ) : null}

      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </div>
  );
}
