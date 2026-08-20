"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button, FieldError, Modal, Textarea } from "@/components/ui";
import { saveAutomationSetting } from "./actions";

interface DefinitionView {
  id: string;
  name: string;
  description: string;
  defaultTemplate: string;
}

interface SettingView {
  enabled: boolean;
  requiresApproval: boolean;
  messageTemplate: string | null;
}

const SAMPLE = {
  nome: "Maria",
  clinica: "Clínica Demo",
  data: "21/08/2026",
  hora: "14:00",
  profissional: "Dra. Paula",
  procedimento: "Limpeza de Pele",
};

function preview(template: string): string {
  return template.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_, key: string) =>
    key in SAMPLE ? SAMPLE[key as keyof typeof SAMPLE] : `{{${key}}}`,
  );
}

export function AutomationCard({
  definition,
  setting,
}: {
  definition: DefinitionView;
  setting: SettingView;
}) {
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const [template, setTemplate] = useState(
    setting.messageTemplate ?? definition.defaultTemplate,
  );
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  function save(patch: {
    enabled?: boolean;
    requiresApproval?: boolean;
    messageTemplate?: string;
  }) {
    setError(undefined);
    startTransition(async () => {
      const result = await saveAutomationSetting({
        automationId: definition.id,
        // Preserva os valores atuais nos campos não alterados
        enabled: patch.enabled ?? setting.enabled,
        requiresApproval: patch.requiresApproval ?? setting.requiresApproval,
        ...(patch.messageTemplate !== undefined
          ? { messageTemplate: patch.messageTemplate }
          : {}),
      });
      if (result.ok) {
        setEditOpen(false);
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <div className="rounded-xl border border-stone-200 bg-white p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-stone-800">{definition.name}</p>
          <p className="mt-0.5 text-sm text-stone-500">{definition.description}</p>
        </div>
        {/* Toggle liga/desliga */}
        <button
          type="button"
          role="switch"
          aria-checked={setting.enabled}
          aria-label={`${setting.enabled ? "Desligar" : "Ligar"} ${definition.name}`}
          disabled={pending}
          onClick={() => save({ enabled: !setting.enabled })}
          className={`relative h-6 w-11 shrink-0 rounded-full transition ${
            setting.enabled ? "bg-teal-600" : "bg-stone-300"
          }`}
        >
          <span
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
              setting.enabled ? "left-[22px]" : "left-0.5"
            }`}
          />
        </button>
      </div>

      {setting.enabled ? (
        <div className="mt-4 space-y-3 border-t border-stone-100 pt-4">
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <label className="flex cursor-pointer items-center gap-2 text-stone-700">
              <input
                type="radio"
                name={`mode-${definition.id}`}
                checked={setting.requiresApproval}
                onChange={() => save({ requiresApproval: true })}
                className="h-4 w-4 accent-teal-700"
              />
              Revisar antes de enviar
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-stone-700">
              <input
                type="radio"
                name={`mode-${definition.id}`}
                checked={!setting.requiresApproval}
                onChange={() => save({ requiresApproval: false })}
                className="h-4 w-4 accent-teal-700"
              />
              Enviar automaticamente
            </label>
            <Button variant="ghost" onClick={() => setEditOpen(true)}>
              Editar mensagem
            </Button>
          </div>
          <p className="rounded-lg bg-stone-50 px-3 py-2 text-sm text-stone-600">
            {preview(setting.messageTemplate ?? definition.defaultTemplate)}
          </p>
        </div>
      ) : null}

      <FieldError message={error} />

      <Modal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title={`Mensagem — ${definition.name}`}
      >
        <div className="space-y-4">
          <Textarea
            value={template}
            onChange={(e) => setTemplate(e.target.value)}
            rows={4}
          />
          <p className="text-xs text-stone-500">
            Variáveis disponíveis:{" "}
            <code className="rounded bg-stone-100 px-1">{"{{nome}}"}</code>{" "}
            <code className="rounded bg-stone-100 px-1">{"{{procedimento}}"}</code>{" "}
            <code className="rounded bg-stone-100 px-1">{"{{data}}"}</code>{" "}
            <code className="rounded bg-stone-100 px-1">{"{{hora}}"}</code>{" "}
            <code className="rounded bg-stone-100 px-1">{"{{profissional}}"}</code>{" "}
            <code className="rounded bg-stone-100 px-1">{"{{clinica}}"}</code>
          </p>
          <div className="rounded-lg bg-teal-50 px-3 py-2.5">
            <p className="text-xs font-medium text-teal-800">Como a cliente vai receber:</p>
            <p className="mt-1 whitespace-pre-wrap text-sm text-teal-900">
              {preview(template)}
            </p>
          </div>

          <FieldError message={error} />

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setTemplate(definition.defaultTemplate);
              }}
            >
              Voltar ao padrão
            </Button>
            <Button
              onClick={() => save({ messageTemplate: template })}
              disabled={pending || template.trim().length === 0}
            >
              {pending ? "Salvando..." : "Salvar mensagem"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
