"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { signDocument } from "./actions";

export function SignPad({ token, bodyHtml }: { token: string; bodyHtml: string }) {
  const router = useRouter();
  const [readToEnd, setReadToEnd] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [kind, setKind] = useState<"drawn" | "typed">("drawn");
  const [typedName, setTypedName] = useState("");
  const [signerName, setSignerName] = useState("");
  const [hasDrawing, setHasDrawing] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const articleRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);

  // Documento curto (sem rolagem) já conta como lido
  useEffect(() => {
    const el = articleRef.current;
    if (el && el.scrollHeight <= el.clientHeight + 8) setReadToEnd(true);
  }, []);

  function onScroll() {
    const el = articleRef.current;
    if (!el) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 12) setReadToEnd(true);
  }

  // Canvas de assinatura
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || kind !== "drawn") return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = "#1c1917";
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
  }, [kind]);

  function pos(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * canvas.height,
    };
  }

  function clearCanvas() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    setHasDrawing(false);
  }

  const canSign =
    readToEnd &&
    agreed &&
    signerName.trim().length >= 5 &&
    (kind === "drawn" ? hasDrawing : typedName.trim().length >= 5);

  function submit() {
    setError(undefined);
    startTransition(async () => {
      const result = await signDocument({
        token,
        signerName: signerName.trim(),
        signatureKind: kind,
        signatureImage:
          kind === "drawn" ? canvasRef.current?.toDataURL("image/png") : undefined,
        typedSignature: kind === "typed" ? typedName.trim() : undefined,
        evidence: {
          viewport: `${window.innerWidth}x${window.innerHeight}`,
          deviceTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
      });
      if (result.ok) {
        router.refresh();
      } else {
        setError(result.error ?? "Não foi possível assinar. Tente de novo.");
      }
    });
  }

  return (
    <div className="mt-4 space-y-4">
      <div
        ref={articleRef}
        onScroll={onScroll}
        className="term-body max-h-80 overflow-y-auto rounded-lg border border-stone-200 bg-stone-50 p-4 text-sm leading-relaxed text-stone-700"
        dangerouslySetInnerHTML={{ __html: bodyHtml }}
      />
      {!readToEnd ? (
        <p className="text-center text-xs text-amber-600">
          ↓ Role até o fim do termo para assinar
        </p>
      ) : null}

      <label className="flex cursor-pointer items-start gap-2 text-sm text-stone-700">
        <input
          type="checkbox"
          checked={agreed}
          onChange={(e) => setAgreed(e.target.checked)}
          disabled={!readToEnd}
          className="mt-0.5 h-4 w-4 accent-teal-700"
        />
        Li e concordo com o termo acima.
      </label>

      <div>
        <label htmlFor="sg-name" className="text-sm font-medium text-stone-700">
          Seu nome completo
        </label>
        <input
          id="sg-name"
          value={signerName}
          onChange={(e) => setSignerName(e.target.value)}
          placeholder="Como está no seu documento"
          className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-100"
        />
      </div>

      <div>
        <div className="flex gap-1 rounded-lg border border-stone-200 bg-stone-50 p-1">
          <button
            type="button"
            onClick={() => setKind("drawn")}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm ${
              kind === "drawn" ? "bg-white font-medium text-teal-800 shadow-sm" : "text-stone-500"
            }`}
          >
            Desenhar assinatura
          </button>
          <button
            type="button"
            onClick={() => setKind("typed")}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm ${
              kind === "typed" ? "bg-white font-medium text-teal-800 shadow-sm" : "text-stone-500"
            }`}
          >
            Digitar nome
          </button>
        </div>

        {kind === "drawn" ? (
          <div className="mt-2">
            <canvas
              ref={canvasRef}
              width={560}
              height={180}
              className="w-full touch-none rounded-lg border border-dashed border-stone-300 bg-white"
              onPointerDown={(e) => {
                drawing.current = true;
                setHasDrawing(true);
                const ctx = canvasRef.current!.getContext("2d")!;
                const p = pos(e);
                ctx.beginPath();
                ctx.moveTo(p.x, p.y);
                e.currentTarget.setPointerCapture(e.pointerId);
              }}
              onPointerMove={(e) => {
                if (!drawing.current) return;
                const ctx = canvasRef.current!.getContext("2d")!;
                const p = pos(e);
                ctx.lineTo(p.x, p.y);
                ctx.stroke();
              }}
              onPointerUp={() => {
                drawing.current = false;
              }}
            />
            <button
              type="button"
              onClick={clearCanvas}
              className="mt-1 text-xs text-stone-400 underline"
            >
              limpar e desenhar de novo
            </button>
          </div>
        ) : (
          <div className="mt-2 rounded-lg border border-dashed border-stone-300 bg-white p-4">
            <input
              value={typedName}
              onChange={(e) => setTypedName(e.target.value)}
              placeholder="Digite seu nome"
              className="w-full border-0 text-center text-2xl outline-none"
              style={{ fontFamily: "'Segoe Script', 'Brush Script MT', cursive" }}
            />
          </div>
        )}
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <button
        type="button"
        onClick={submit}
        disabled={!canSign || pending}
        className="w-full rounded-lg bg-teal-700 px-4 py-3 text-sm font-semibold text-white transition hover:bg-teal-800 disabled:opacity-50"
      >
        {pending ? "Assinando..." : "Assinar termo"}
      </button>
    </div>
  );
}
