"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Button, FieldError } from "@/components/ui";
import { markConversationRead, sendManualMessage, setConversationMode } from "./actions";

export { AutoRefresh } from "@/components/auto-refresh";

/** Zera o contador de não lidas ao abrir a conversa. */
export function ReadOnOpen({
  conversationId,
  unread,
}: {
  conversationId: string;
  unread: number;
}) {
  const router = useRouter();
  const done = useRef<string | null>(null);
  useEffect(() => {
    if (unread > 0 && done.current !== conversationId) {
      done.current = conversationId;
      void markConversationRead({ conversationId }).then(() => router.refresh());
    }
  }, [conversationId, unread, router]);
  return null;
}

export function ModeBanner({
  conversationId,
  mode,
}: {
  conversationId: string;
  mode: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function setMode(newMode: "ai" | "human") {
    startTransition(async () => {
      await setConversationMode({ conversationId, mode: newMode });
      router.refresh();
    });
  }

  const styles =
    mode === "waiting_human"
      ? "bg-red-50 text-red-800"
      : mode === "human"
        ? "bg-sky-50 text-sky-800"
        : "bg-teal-50 text-teal-800";

  return (
    <div className={`flex items-center justify-between gap-3 border-b border-stone-200 px-6 py-2.5 text-sm ${styles}`}>
      <span>
        {mode === "waiting_human"
          ? "🔴 Esta cliente precisa de você — as automações estão aguardando."
          : mode === "human"
            ? "Você está no controle. Nenhuma resposta automática será enviada."
            : "✨ Atendimento automático ativo nesta conversa."}
      </span>
      {mode === "ai" ? (
        <Button variant="secondary" onClick={() => setMode("human")} disabled={pending}>
          Assumir conversa
        </Button>
      ) : (
        <Button variant="secondary" onClick={() => setMode("ai")} disabled={pending}>
          Devolver para o automático
        </Button>
      )}
    </div>
  );
}

export function Composer({ conversationId }: { conversationId: string }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  function send() {
    const text = body.trim();
    if (!text) return;
    setError(undefined);
    startTransition(async () => {
      const result = await sendManualMessage({ conversationId, body: text });
      if (result.ok) {
        setBody("");
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <div className="border-t border-stone-200 bg-white p-4">
      <FieldError message={error} />
      <div className="flex items-end gap-2">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          rows={2}
          placeholder="Escreva a mensagem... (Enter envia, Shift+Enter quebra linha)"
          className="flex-1 resize-none rounded-lg border border-stone-300 px-3 py-2 text-sm outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-100"
        />
        <Button onClick={send} disabled={pending || body.trim().length === 0}>
          {pending ? "..." : "Enviar"}
        </Button>
      </div>
      <p className="mt-1.5 text-[11px] text-stone-400">
        Enviar uma mensagem assume a conversa para você (as automações pausam aqui).
      </p>
    </div>
  );
}
