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
  const areaRef = useRef<HTMLTextAreaElement>(null);

  // Frase pronta vinda do painel "Sugerir também" — entra no campo, nunca é enviada sozinha
  useEffect(() => {
    const onCompose = (e: Event) => {
      const text = (e as CustomEvent<string>).detail;
      if (typeof text !== "string") return;
      setBody((prev) => (prev.trim() ? `${prev.trimEnd()}\n${text}` : text));
      areaRef.current?.focus();
    };
    window.addEventListener(COMPOSE_EVENT, onCompose);
    return () => window.removeEventListener(COMPOSE_EVENT, onCompose);
  }, []);

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
          ref={areaRef}
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

// ── Sugestões de oferta (venda complementar) ─────────────────────────

export interface OfferView {
  procedureName: string;
  price: number;
  reason: "combina" | "retorno" | "promocao";
  why: string;
  message: string;
}

const REASON_LABEL: Record<OfferView["reason"], string> = {
  combina: "Combina com o pedido",
  promocao: "Promoção vigente",
  retorno: "Retorno vencido",
};

/** Evento que o painel dispara para preencher o campo de mensagem com a frase pronta. */
export const COMPOSE_EVENT = "vx:compose";

export function OfferPanel({ offers }: { offers: OfferView[] }) {
  if (offers.length === 0) return null;
  return (
    <div className="mt-5 border-t border-stone-100 pt-4">
      <p className="text-xs uppercase tracking-wide text-stone-400">Sugerir também</p>
      <p className="mt-1 text-[11px] leading-snug text-stone-400">
        Só o que a clínica marcou em Serviços → &quot;Oferecer junto&quot;, ou retorno do que ela já fez.
      </p>
      <div className="mt-2 space-y-2">
        {offers.map((o) => (
          <div key={o.procedureName} className="rounded-lg border border-stone-200 p-2.5">
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-medium text-stone-800">{o.procedureName}</p>
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                  o.reason === "promocao"
                    ? "bg-amber-100 text-amber-800"
                    : o.reason === "retorno"
                      ? "bg-stone-100 text-stone-600"
                      : "bg-teal-50 text-teal-700"
                }`}
              >
                {REASON_LABEL[o.reason]}
              </span>
            </div>
            <p className="mt-1 text-[11px] leading-snug text-stone-500">{o.why}</p>
            <button
              type="button"
              onClick={() => window.dispatchEvent(new CustomEvent(COMPOSE_EVENT, { detail: o.message }))}
              className="mt-2 w-full rounded-md bg-teal-50 px-2 py-1.5 text-xs font-medium text-teal-800 hover:bg-teal-100"
            >
              Usar frase pronta
            </button>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-stone-400">A frase vai para o campo de mensagem; revise antes de enviar.</p>
    </div>
  );
}
