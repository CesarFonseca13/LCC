"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Button, FieldError } from "@/components/ui";
import { disconnectWhatsApp, pollWhatsApp, setupWhatsApp } from "./actions";

export function WhatsAppCard({
  initialStatus,
  initialQr,
  initialPhone,
}: {
  initialStatus: string;
  initialQr: string | null;
  initialPhone: string | null;
}) {
  const [status, setStatus] = useState(initialStatus);
  const [qr, setQr] = useState<string | null>(initialQr);
  const [phone, setPhone] = useState<string | null>(initialPhone);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const polling = useRef<ReturnType<typeof setInterval> | null>(null);

  // Enquanto aguarda o QR ser lido, consulta o status a cada 3s
  useEffect(() => {
    const active = ["created", "qr_pending", "connecting"].includes(status);
    if (active && !polling.current) {
      polling.current = setInterval(() => {
        void pollWhatsApp({}).then((r) => {
          if (!r.ok) return;
          if (r.status) setStatus(r.status);
          setQr(r.qrCode ?? null);
          if (r.phone) setPhone(r.phone);
        });
      }, 3000);
    }
    if (!active && polling.current) {
      clearInterval(polling.current);
      polling.current = null;
    }
    return () => {
      if (polling.current) {
        clearInterval(polling.current);
        polling.current = null;
      }
    };
  }, [status]);

  function connect() {
    setError(undefined);
    startTransition(async () => {
      const r = await setupWhatsApp({});
      if (r.ok) {
        setStatus(r.status ?? "qr_pending");
        setQr(r.qrCode ?? null);
      } else {
        setError(r.error);
      }
    });
  }

  function disconnect() {
    setError(undefined);
    startTransition(async () => {
      const r = await disconnectWhatsApp({});
      if (r.ok) {
        setStatus("disconnected");
        setQr(null);
      } else {
        setError(r.error);
      }
    });
  }

  return (
    <section className="rounded-xl border border-stone-200 bg-white p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-stone-700">Número do WhatsApp</h2>
        {status === "connected" ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            Conectado
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-stone-100 px-2.5 py-1 text-xs text-stone-500">
            <span className="h-1.5 w-1.5 rounded-full bg-stone-400" />
            {status === "qr_pending" || status === "connecting"
              ? "Aguardando leitura do código"
              : "Não conectado"}
          </span>
        )}
      </div>

      {status === "connected" ? (
        <div className="mt-4 space-y-3">
          <p className="text-sm text-stone-600">
            Número conectado{phone ? `: ${phone}` : ""}. Os lembretes e conversas passam
            por ele.
          </p>
          <Button variant="secondary" onClick={disconnect} disabled={pending}>
            Desconectar
          </Button>
        </div>
      ) : status === "qr_pending" || status === "connecting" || status === "created" ? (
        <div className="mt-4 flex flex-wrap items-start gap-6">
          <div className="rounded-xl border border-stone-200 p-3">
            {qr ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={qr.startsWith("data:") ? qr : `data:image/png;base64,${qr}`}
                alt="QR Code para conectar o WhatsApp"
                className="h-52 w-52"
              />
            ) : (
              <div className="flex h-52 w-52 items-center justify-center text-sm text-stone-400">
                Gerando código...
              </div>
            )}
          </div>
          <ol className="max-w-xs list-decimal space-y-2 pl-5 text-sm text-stone-600">
            <li>
              No celular da clínica, abra o <strong>WhatsApp</strong>.
            </li>
            <li>
              Toque em <strong>⋮ → Dispositivos conectados → Conectar dispositivo</strong>.
            </li>
            <li>Aponte a câmera para o código ao lado.</li>
          </ol>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          <p className="text-sm text-stone-600">
            Conecte o número da clínica para ativar lembretes automáticos, confirmações e
            o atendimento pelo painel. Leva 1 minuto e não desconecta o celular.
          </p>
          <Button onClick={connect} disabled={pending}>
            {pending ? "Preparando..." : "Conectar WhatsApp"}
          </Button>
        </div>
      )}

      <FieldError message={error} />
    </section>
  );
}
