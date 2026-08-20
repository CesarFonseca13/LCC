"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { AnamnesisAnswers, AnamnesisSchema } from "@clinicaos/core/anamnesis";
import { Button, FieldError, Label, Textarea } from "@/components/ui";
import { saveAnamnesis } from "../actions";

export function AnamnesisForm({
  customerId,
  templateVersionId,
  templateName,
  schema,
  initialAnswers,
  filledAt,
}: {
  customerId: string;
  templateVersionId: string;
  templateName: string;
  schema: AnamnesisSchema;
  initialAnswers: AnamnesisAnswers | null;
  filledAt: string | null;
}) {
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function submit(formData: FormData) {
    setError(undefined);
    setSaved(false);
    const answers: AnamnesisAnswers = {};
    for (const section of schema) {
      for (const field of section.fields) {
        if (field.type === "boolean") {
          answers[field.key] = formData.get(field.key) === "on";
        } else {
          answers[field.key] = String(formData.get(field.key) ?? "").trim();
        }
      }
    }
    startTransition(async () => {
      try {
        const result = await saveAnamnesis({ customerId, templateVersionId, answers });
        if (result.ok) {
          setSaved(true);
          router.refresh();
        } else {
          setError(result.error ?? "Não foi possível salvar.");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Não foi possível salvar.");
      }
    });
  }

  return (
    <form action={submit} className="space-y-6 rounded-xl border border-stone-200 bg-white p-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-stone-500">
          Modelo: <span className="font-medium text-stone-700">{templateName}</span>
        </p>
        {filledAt ? (
          <p className="text-xs text-stone-400">Última atualização em {filledAt}</p>
        ) : (
          <p className="text-xs text-amber-600">Ainda sem anamnese — leva 2 minutos.</p>
        )}
      </div>

      {schema.map((section) => (
        <fieldset key={section.section} className="rounded-lg border border-stone-200 p-4">
          <legend className="px-1 text-xs font-medium uppercase tracking-wide text-stone-400">
            {section.section}
          </legend>
          <div className="space-y-3">
            {section.fields
              .filter((f) => f.type === "text")
              .map((field) => (
                <div key={field.key}>
                  <Label htmlFor={`an-${field.key}`}>
                    {field.label}
                    {field.risk ? <span className="ml-1 text-red-400">•</span> : null}
                  </Label>
                  <Textarea
                    id={`an-${field.key}`}
                    name={field.key}
                    rows={2}
                    placeholder={field.placeholder}
                    defaultValue={
                      typeof initialAnswers?.[field.key] === "string"
                        ? (initialAnswers[field.key] as string)
                        : ""
                    }
                  />
                </div>
              ))}
            <div className="flex flex-wrap gap-x-6 gap-y-2 pt-1">
              {section.fields
                .filter((f) => f.type === "boolean")
                .map((field) => (
                  <label
                    key={field.key}
                    className="flex cursor-pointer items-center gap-2 text-sm text-stone-700"
                  >
                    <input
                      type="checkbox"
                      name={field.key}
                      defaultChecked={initialAnswers?.[field.key] === true}
                      className="h-4 w-4 rounded border-stone-300 accent-teal-700"
                    />
                    {field.label}
                    {field.risk ? <span className="text-red-400">•</span> : null}
                  </label>
                ))}
            </div>
          </div>
        </fieldset>
      ))}

      <p className="text-xs text-stone-400">
        <span className="text-red-400">•</span> campos que geram o alerta clínico no topo da
        ficha. As respostas são guardadas cifradas — só a equipe clínica tem acesso.
      </p>

      <FieldError message={error} />
      {saved ? <p className="text-sm text-emerald-600">Anamnese salva!</p> : null}

      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? "Salvando..." : "Salvar anamnese"}
        </Button>
      </div>
    </form>
  );
}
