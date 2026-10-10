"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { clearDemoConversations, enterClinic } from "./actions";

export function DemoActions({ clinicId }: { clinicId: string }) {
  const router = useRouter();
  const [msg, setMsg] = useState<string>();
  const [confirm, setConfirm] = useState(false);
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => start(async () => { await enterClinic({ clinicId }); })}
          className="rounded-lg bg-amber-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-800 disabled:opacity-50"
        >
          Abrir painel da demo
        </button>
        {confirm ? (
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await clearDemoConversations({ clinicId });
                setMsg(r.ok ? r.message : r.error);
                setConfirm(false);
                router.refresh();
              })
            }
            className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
          >
            Confirmar limpeza
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setConfirm(true)}
            className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-sm text-amber-900 hover:bg-amber-100"
          >
            Limpar conversas
          </button>
        )}
      </div>
      {confirm ? <p className="text-[11px] text-amber-900">Apaga todas as conversas e aprovações da demo. Clientes, agenda e catálogo ficam.</p> : null}
      {msg ? <p className="text-xs text-amber-900">{msg}</p> : null}
    </div>
  );
}
