"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button, FieldError, Input, Label } from "@/components/ui";
import { saveBookingSettings } from "./actions";

export function BookingCard({
  appUrl,
  initial,
}: {
  appUrl: string;
  initial: { enabled: boolean; slug: string };
}) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initial.enabled);
  const [slug, setSlug] = useState(initial.slug);
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  const link = `${appUrl}/agendar/${slug || "sua-clinica"}`;

  function save() {
    setError(undefined);
    setSaved(false);
    startTransition(async () => {
      const result = await saveBookingSettings({ enabled, slug });
      if (result.ok) {
        setSaved(true);
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <section className="rounded-xl border border-stone-200 bg-white p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-stone-700">Agendamento online</h2>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label={enabled ? "Desligar agendamento online" : "Ligar agendamento online"}
          onClick={() => setEnabled((v) => !v)}
          className={`relative h-6 w-11 shrink-0 rounded-full transition ${
            enabled ? "bg-teal-600" : "bg-stone-300"
          }`}
        >
          <span
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
              enabled ? "left-[22px]" : "left-0.5"
            }`}
          />
        </button>
      </div>
      <p className="mt-1 text-sm text-stone-500">
        Um link para a bio do Instagram: a cliente escolhe o procedimento, vê os horários
        realmente livres e reserva sozinha — direto na sua agenda.
      </p>

      <div className="mt-4 space-y-3">
        <div>
          <Label htmlFor="bk-slug">Endereço da sua página</Label>
          <div className="mt-1 flex items-center gap-2">
            <span className="text-sm text-stone-400">/agendar/</span>
            <Input
              id="bk-slug"
              value={slug}
              onChange={(e) => setSlug(e.target.value.toLowerCase())}
              placeholder="clinica-demo"
              className="flex-1"
            />
          </div>
        </div>
        {enabled && initial.enabled && initial.slug ? (
          <div className="flex items-center gap-2">
            <Input readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                void navigator.clipboard.writeText(link).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                });
              }}
            >
              {copied ? "Copiado!" : "Copiar"}
            </Button>
          </div>
        ) : null}

        <FieldError message={error} />
        {saved ? <p className="text-sm text-emerald-600">Agendamento online salvo!</p> : null}

        <div className="flex justify-end">
          <Button onClick={save} disabled={pending || slug.length < 3}>
            {pending ? "Salvando..." : "Salvar"}
          </Button>
        </div>
      </div>
    </section>
  );
}
