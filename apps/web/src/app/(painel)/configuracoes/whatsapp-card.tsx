"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Button, FieldError } from "@/components/ui";
import {
  disconnectWhatsApp,
  makePrimaryWhatsApp,
  pollWhatsApp,
  renameWhatsApp,
  setupWhatsApp,
} from "./actions";

export interface InstanceView {
  id: string;
  label: string;
  phone: string | null;
  status: string;
  qr: string | null;
  isPrimary: boolean;
}

const CONNECTING = ["created", "qr_pending", "connecting"];

function StatusPill({ status }: { status: string }) {
  if (status === "connected") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
        Conectado
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-stone-100 px-2.5 py-1 text-xs text-stone-500">
      <span className="h-1.5 w-1.5 rounded-full bg-stone-400" />
      {CONNECTING.includes(status) ? "Aguardando leitura do código" : "Não conectado"}
    </span>
  );
}

function InstanceRow({
  instance,
  onChange,
  canRemoveConnect,
}: {
  instance: InstanceView;
  onChange: (next: InstanceView) => void;
  canRemoveConnect: boolean;
}) {
  const [error, setError] = useState<string>();
  const [editingLabel, setEditingLabel] = useState(false);
  const [labelDraft, setLabelDraft] = useState(instance.label);
  const [pending, startTransition] = useTransition();
  const polling = useRef<ReturnType<typeof setInterval> | null>(null);

  // Enquanto aguarda o QR ser lido, consulta o status a cada 3s
  useEffect(() => {
    const active = CONNECTING.includes(instance.status);
    if (active && !polling.current) {
      polling.current = setInterval(() => {
        void pollWhatsApp({ instanceId: instance.id }).then((r) => {
          if (!r.ok) return;
          onChange({
            ...instance,
            status: r.status ?? instance.status,
            qr: r.qrCode ?? null,
            phone: r.phone ?? instance.phone,
          });
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instance.status, instance.id]);

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) {
    setError(undefined);
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) setError(r.error ?? "Não deu certo — tente de novo.");
      else after?.();
    });
  }

  return (
    <div className="rounded-lg border border-stone-200 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {editingLabel ? (
            <form
              className="flex items-center gap-1"
              action={() =>
                run(
                  () => renameWhatsApp({ instanceId: instance.id, label: labelDraft }),
                  () => {
                    setEditingLabel(false);
                    onChange({ ...instance, label: labelDraft });
                  },
                )
              }
            >
              <input
                value={labelDraft}
                onChange={(e) => setLabelDraft(e.target.value)}
                className="w-36 rounded border border-stone-300 px-2 py-1 text-sm"
                maxLength={40}
                autoFocus
              />
              <Button type="submit" variant="ghost" disabled={pending}>
                ok
              </Button>
            </form>
          ) : (
            <button
              type="button"
              className="text-sm font-semibold text-stone-800 hover:underline"
              title="Renomear (ex.: Recepção, Campanhas)"
              onClick={() => setEditingLabel(true)}
            >
              {instance.label} ✏️
            </button>
          )}
          {instance.isPrimary ? (
            <span className="rounded-full bg-teal-50 px-2 py-0.5 text-xs font-medium text-teal-700">
              principal
            </span>
          ) : null}
          {instance.phone ? (
            <span className="text-xs text-stone-400">{instance.phone}</span>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <StatusPill status={instance.status} />
          {instance.status === "connected" ? (
            <>
              {!instance.isPrimary ? (
                <Button
                  variant="ghost"
                  disabled={pending}
                  onClick={() =>
                    run(
                      () => makePrimaryWhatsApp({ instanceId: instance.id }),
                      () => onChange({ ...instance, isPrimary: true }),
                    )
                  }
                >
                  Tornar principal
                </Button>
              ) : null}
              <Button
                variant="secondary"
                disabled={pending}
                onClick={() =>
                  run(
                    () => disconnectWhatsApp({ instanceId: instance.id }),
                    () => onChange({ ...instance, status: "disconnected", qr: null }),
                  )
                }
              >
                Desconectar
              </Button>
            </>
          ) : !CONNECTING.includes(instance.status) && canRemoveConnect ? (
            <Button
              disabled={pending}
              onClick={() =>
                run(
                  () => setupWhatsApp({ instanceId: instance.id }),
                  () => onChange({ ...instance, status: "qr_pending" }),
                )
              }
            >
              {pending ? "Preparando..." : "Conectar"}
            </Button>
          ) : null}
        </div>
      </div>

      {CONNECTING.includes(instance.status) ? (
        <div className="mt-4 flex flex-wrap items-start gap-6">
          <div className="rounded-xl border border-stone-200 p-3">
            {instance.qr ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={
                  instance.qr.startsWith("data:")
                    ? instance.qr
                    : `data:image/png;base64,${instance.qr}`
                }
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
              No celular <strong>deste número</strong>, abra o <strong>WhatsApp</strong>.
            </li>
            <li>
              Toque em <strong>⋮ → Dispositivos conectados → Conectar dispositivo</strong>.
            </li>
            <li>Aponte a câmera para o código ao lado.</li>
          </ol>
        </div>
      ) : null}

      <FieldError message={error} />
    </div>
  );
}

export function WhatsAppCard({ initialInstances }: { initialInstances: InstanceView[] }) {
  const [instances, setInstances] = useState<InstanceView[]>(initialInstances);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  function addNumber() {
    setError(undefined);
    startTransition(async () => {
      const r = await setupWhatsApp({});
      if (r.ok && r.instanceId) {
        setInstances((prev) => [
          ...prev,
          {
            id: r.instanceId!,
            label: prev.length === 0 ? "Principal" : `Número ${prev.length + 1}`,
            phone: null,
            status: r.status ?? "qr_pending",
            qr: r.qrCode ?? null,
            isPrimary: prev.length === 0,
          },
        ]);
      } else if (!r.ok) {
        setError(r.error);
      }
    });
  }

  return (
    <section className="rounded-xl border border-stone-200 bg-white p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-stone-700">Números do WhatsApp</h2>
        <Button variant="ghost" onClick={addNumber} disabled={pending}>
          {pending ? "Preparando..." : "+ Conectar outro número"}
        </Button>
      </div>
      <p className="mt-1 text-sm text-stone-500">
        Com mais de um número, as campanhas se dividem entre eles (mais alcance por dia,
        menos risco). Cada cliente sempre fala com o mesmo número.
      </p>

      <div className="mt-4 space-y-3">
        {instances.length === 0 ? (
          <div className="rounded-lg border border-dashed border-stone-300 p-6 text-center text-sm text-stone-500">
            Conecte o número da clínica para ativar lembretes, confirmações e o
            atendimento pelo painel. Leva 1 minuto e não desconecta o celular.
            <div className="mt-3">
              <Button onClick={addNumber} disabled={pending}>
                {pending ? "Preparando..." : "Conectar WhatsApp"}
              </Button>
            </div>
          </div>
        ) : (
          instances.map((inst) => (
            <InstanceRow
              key={inst.id}
              instance={inst}
              canRemoveConnect
              onChange={(next) =>
                setInstances((prev) => {
                  const updated = prev.map((p) => (p.id === next.id ? next : p));
                  // "Tornar principal" derruba a marcação dos outros na tela
                  return next.isPrimary
                    ? updated.map((p) => (p.id === next.id ? p : { ...p, isPrimary: false }))
                    : updated;
                })
              }
            />
          ))
        )}
      </div>

      <FieldError message={error} />
    </section>
  );
}
