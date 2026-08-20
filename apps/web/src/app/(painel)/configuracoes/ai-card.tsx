"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button, FieldError, Input, Label } from "@/components/ui";
import { saveAiSettings } from "./actions";

const TONES = [
  { value: "acolhedora", label: "Acolhedora 💛", hint: "Calorosa e próxima" },
  { value: "elegante", label: "Elegante", hint: "Sóbria e profissional" },
  { value: "animada", label: "Animada", hint: "Jovem e leve" },
] as const;

export function AiCard({
  hasApiKey,
  initial,
}: {
  hasApiKey: boolean;
  initial: { enabled: boolean; assistantName: string; tone: string };
}) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initial.enabled);
  const [tone, setTone] = useState(initial.tone);
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit(fd: FormData) {
    setError(undefined);
    setSaved(false);
    startTransition(async () => {
      const result = await saveAiSettings({
        enabled,
        assistantName: String(fd.get("assistantName") ?? ""),
        tone,
      });
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
        <h2 className="text-sm font-semibold text-stone-700">Assistente virtual</h2>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label={enabled ? "Desligar assistente" : "Ligar assistente"}
          disabled={!hasApiKey}
          onClick={() => setEnabled((v) => !v)}
          className={`relative h-6 w-11 shrink-0 rounded-full transition disabled:opacity-40 ${
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
        Responde as clientes no WhatsApp com o tom da sua clínica: consulta horários
        reais, agenda, confirma e passa para você tudo que for delicado.
      </p>

      {!hasApiKey ? (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Para ligar a assistente, configure a chave da IA (ANTHROPIC_API_KEY) no servidor.
        </p>
      ) : null}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(new FormData(e.currentTarget));
        }}
        className="mt-4 space-y-4"
      >
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="ai-name">Nome da assistente</Label>
            <Input
              id="ai-name"
              name="assistantName"
              defaultValue={initial.assistantName}
              placeholder="Ana"
            />
            <p className="mt-1 text-xs text-stone-400">
              É assim que ela se apresenta nas conversas.
            </p>
          </div>
          <div>
            <Label>Tom de voz</Label>
            <div className="mt-1 space-y-1.5">
              {TONES.map((t) => (
                <label
                  key={t.value}
                  className="flex cursor-pointer items-center gap-2 text-sm text-stone-700"
                >
                  <input
                    type="radio"
                    name="tone"
                    checked={tone === t.value}
                    onChange={() => setTone(t.value)}
                    className="h-4 w-4 accent-teal-700"
                  />
                  {t.label}
                  <span className="text-xs text-stone-400">— {t.hint}</span>
                </label>
              ))}
            </div>
          </div>
        </div>

        <FieldError message={error} />
        {saved ? <p className="text-sm text-emerald-600">Assistente configurada!</p> : null}

        <div className="flex justify-end">
          <Button type="submit" disabled={pending || !hasApiKey}>
            {pending ? "Salvando..." : "Salvar assistente"}
          </Button>
        </div>
      </form>
    </section>
  );
}
