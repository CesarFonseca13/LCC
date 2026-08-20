"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { acceptQuote } from "./actions";

export function AcceptQuoteButton({ token }: { token: string }) {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  return (
    <div>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await acceptQuote(token);
            if (result.ok) router.refresh();
            else setError(result.error);
          })
        }
        className="w-full rounded-lg bg-teal-700 px-4 py-3 text-sm font-semibold text-white transition hover:bg-teal-800 disabled:opacity-60"
      >
        {pending ? "Confirmando..." : "Aceitar orçamento ✓"}
      </button>
      {error ? <p className="mt-2 text-center text-sm text-red-600">{error}</p> : null}
    </div>
  );
}
