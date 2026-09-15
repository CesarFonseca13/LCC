"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { acceptTermsAction } from "./actions";

function SubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={disabled || pending}
      className="rounded-lg bg-teal-700 px-5 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-teal-800 disabled:opacity-50"
    >
      {pending ? "Registrando..." : "Aceitar e continuar"}
    </button>
  );
}

export function AceiteForm() {
  const [checked, setChecked] = useState(false);
  return (
    <form action={acceptTermsAction} className="space-y-4">
      <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-stone-200 bg-stone-50 p-4 text-sm text-stone-700">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => setChecked(e.target.checked)}
          className="mt-0.5 h-4 w-4 accent-teal-700"
        />
        <span>Li e concordo com os Termos de Uso.</span>
      </label>
      <div className="flex justify-end">
        <SubmitButton disabled={!checked} />
      </div>
    </form>
  );
}
