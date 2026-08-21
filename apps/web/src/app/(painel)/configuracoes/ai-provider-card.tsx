"use client";

import { useState, useTransition } from "react";
import { Button, FieldError, Input, Label } from "@/components/ui";
import { saveAiProvider, testAiProvider } from "./actions";

export interface AiProviderInitial {
  mode: "default" | "custom";
  provider: "anthropic" | "openai";
  baseURL: string;
  agentModel: string;
  classifierModel: string;
  keyHint: string | null;
}

type Preset = "anthropic" | "openai" | "groq" | "ollama" | "custom";

const PRESETS: Record<
  Preset,
  {
    label: string;
    provider: "anthropic" | "openai";
    baseURL: string;
    baseEditable: boolean;
    modelPlaceholder: string;
    keyPlaceholder: string;
    hint: string;
  }
> = {
  anthropic: {
    label: "Claude (Anthropic)",
    provider: "anthropic",
    baseURL: "",
    baseEditable: false,
    modelPlaceholder: "claude-sonnet-5",
    keyPlaceholder: "sk-ant-...",
    hint: "A chave sai de console.anthropic.com → API Keys.",
  },
  openai: {
    label: "OpenAI (GPT)",
    provider: "openai",
    baseURL: "",
    baseEditable: false,
    modelPlaceholder: "gpt-4o",
    keyPlaceholder: "sk-...",
    hint: "A chave sai de platform.openai.com → API Keys.",
  },
  groq: {
    label: "Groq (Llama e Qwen, rápido e barato)",
    provider: "openai",
    baseURL: "https://api.groq.com/openai/v1",
    baseEditable: false,
    modelPlaceholder: "llama-3.3-70b-versatile",
    keyPlaceholder: "gsk_...",
    hint: "A chave sai de console.groq.com → API Keys (tem plano grátis).",
  },
  ollama: {
    label: "Ollama (modelo aberto no meu servidor)",
    provider: "openai",
    baseURL: "http://localhost:11434/v1",
    baseEditable: true,
    modelPlaceholder: "qwen3:32b",
    keyPlaceholder: "(não precisa de chave)",
    hint: "O endereço precisa estar acessível pelo SERVIDOR do sistema, não só pelo seu computador.",
  },
  custom: {
    label: "Outro compatível com OpenAI",
    provider: "openai",
    baseURL: "",
    baseEditable: true,
    modelPlaceholder: "nome-exato-do-modelo",
    keyPlaceholder: "chave do provedor",
    hint: "Serve para Together, OpenRouter, Fireworks, vLLM e afins.",
  },
};

function presetFromInitial(initial: AiProviderInitial): Preset {
  if (initial.provider === "anthropic") return "anthropic";
  if (!initial.baseURL || initial.baseURL.includes("api.openai.com")) return "openai";
  if (initial.baseURL.includes("groq.com")) return "groq";
  if (initial.baseURL.includes("11434")) return "ollama";
  return "custom";
}

export function AiProviderCard({
  initial,
  systemDefaultLabel,
}: {
  initial: AiProviderInitial;
  /** null = servidor sem provedor padrão configurado. */
  systemDefaultLabel: string | null;
}) {
  const [mode, setMode] = useState<"default" | "custom">(initial.mode);
  const [preset, setPreset] = useState<Preset>(presetFromInitial(initial));
  const [apiKey, setApiKey] = useState("");
  const [baseURL, setBaseURL] = useState(initial.baseURL);
  const [agentModel, setAgentModel] = useState(initial.agentModel);
  const [classifierModel, setClassifierModel] = useState(initial.classifierModel);
  const [error, setError] = useState<string>();
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string }>();
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const p = PRESETS[preset];

  function applyPreset(next: Preset) {
    setPreset(next);
    setBaseURL(PRESETS[next].baseURL);
    setAgentModel("");
    setClassifierModel("");
    setTestResult(undefined);
  }

  function payload() {
    return {
      mode,
      provider: p.provider,
      apiKey,
      baseURL: mode === "custom" ? baseURL : "",
      agentModel,
      classifierModel,
    };
  }

  function runTest() {
    setError(undefined);
    setTestResult(undefined);
    setSaved(false);
    startTransition(async () => {
      const result = await testAiProvider(payload());
      if (result.ok) {
        setTestResult({ ok: true, text: result.sample ?? "conexão OK" });
      } else {
        setTestResult({ ok: false, text: result.error ?? "Falha no teste." });
      }
    });
  }

  function save() {
    setError(undefined);
    setSaved(false);
    startTransition(async () => {
      const result = await saveAiProvider(payload());
      if (result.ok) {
        setSaved(true);
        setApiKey("");
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <section className="rounded-xl border border-stone-200 bg-white p-6">
      <h2 className="text-sm font-semibold text-stone-700">Modelo de inteligência artificial</h2>
      <p className="mt-1 text-sm text-stone-500">
        Qual IA escreve as conversas da assistente. As regras de segurança (nunca inventar
        preço ou horário, passar assunto de saúde para a equipe) valem para qualquer opção.
      </p>

      <div className="mt-4 space-y-2">
        <label className="flex cursor-pointer items-start gap-2 text-sm text-stone-700">
          <input
            type="radio"
            name="ai-mode"
            checked={mode === "default"}
            onChange={() => {
              setMode("default");
              setTestResult(undefined);
            }}
            className="mt-0.5 h-4 w-4 accent-teal-700"
          />
          <span>
            Padrão do ClinicaOS <span className="text-stone-400">(recomendado)</span>
            <span className="block text-xs text-stone-400">
              {systemDefaultLabel
                ? `Hoje: ${systemDefaultLabel} — sem configuração nenhuma da sua parte.`
                : "O servidor ainda não tem provedor padrão — configure o seu abaixo."}
            </span>
          </span>
        </label>
        <label className="flex cursor-pointer items-start gap-2 text-sm text-stone-700">
          <input
            type="radio"
            name="ai-mode"
            checked={mode === "custom"}
            onChange={() => {
              setMode("custom");
              setTestResult(undefined);
            }}
            className="mt-0.5 h-4 w-4 accent-teal-700"
          />
          <span>
            Configuração própria
            <span className="block text-xs text-stone-400">
              Use sua chave de API (a cobrança vai direto para você) ou um modelo aberto no
              seu servidor.
            </span>
          </span>
        </label>
      </div>

      {mode === "custom" ? (
        <div className="mt-4 space-y-3 border-t border-stone-100 pt-4">
          <div>
            <Label htmlFor="aip-preset">Provedor</Label>
            <select
              id="aip-preset"
              value={preset}
              onChange={(e) => applyPreset(e.target.value as Preset)}
              className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-800 focus:border-teal-600 focus:outline-none"
            >
              {(Object.keys(PRESETS) as Preset[]).map((key) => (
                <option key={key} value={key}>
                  {PRESETS[key].label}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-stone-400">{p.hint}</p>
          </div>

          <div>
            <Label htmlFor="aip-key" hint={preset === "ollama" ? "opcional" : undefined}>
              Chave da API
            </Label>
            <Input
              id="aip-key"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={
                initial.keyHint
                  ? `já salva (termina em ${initial.keyHint}) — cole outra para trocar`
                  : p.keyPlaceholder
              }
              autoComplete="off"
            />
            <p className="mt-1 text-xs text-stone-400">
              Fica guardada cifrada e nunca aparece inteira de novo.
            </p>
          </div>

          {p.baseEditable ? (
            <div>
              <Label htmlFor="aip-base">Endereço do servidor</Label>
              <Input
                id="aip-base"
                value={baseURL}
                onChange={(e) => setBaseURL(e.target.value)}
                placeholder="http://localhost:11434/v1"
              />
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="aip-model">Modelo das conversas</Label>
              <Input
                id="aip-model"
                value={agentModel}
                onChange={(e) => setAgentModel(e.target.value)}
                placeholder={p.modelPlaceholder}
              />
            </div>
            <div>
              <Label htmlFor="aip-classifier" hint="opcional">
                Modelo das classificações
              </Label>
              <Input
                id="aip-classifier"
                value={classifierModel}
                onChange={(e) => setClassifierModel(e.target.value)}
                placeholder="vazio = um mais barato"
              />
            </div>
          </div>
        </div>
      ) : null}

      {testResult ? (
        <p
          className={`mt-3 rounded-lg px-3 py-2 text-sm ${
            testResult.ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"
          }`}
        >
          {testResult.ok ? `✓ Funcionou! O modelo respondeu: “${testResult.text}”` : testResult.text}
        </p>
      ) : null}
      <FieldError message={error} />
      {saved ? (
        <p className="mt-2 text-sm text-emerald-600">
          Salvo! A assistente já usa essa configuração nas próximas conversas.
        </p>
      ) : null}

      <div className="mt-4 flex items-center justify-end gap-2">
        <Button variant="ghost" onClick={runTest} disabled={pending}>
          {pending ? "Aguarde..." : "Testar conexão"}
        </Button>
        <Button onClick={save} disabled={pending}>
          Salvar
        </Button>
      </div>
    </section>
  );
}
