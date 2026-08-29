"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button, FieldError } from "@/components/ui";
import { deleteKbEntry, saveKbEntry, saveKnowledgeFacts } from "./actions";

export interface FactsView {
  comoChegar: string;
  estacionamento: string;
  pagamento: string;
  convenios: string;
  cancelamento: string;
  observacoes: string;
}

export interface KbEntryView {
  id: string;
  kind: "faq" | "servico" | "politica" | "outro";
  title: string;
  content: string;
  active: boolean;
}

const KIND_LABEL: Record<KbEntryView["kind"], string> = {
  faq: "Pergunta frequente",
  servico: "Sobre um serviço",
  politica: "Política da clínica",
  outro: "Outro",
};

const FACT_FIELDS: { key: keyof FactsView; label: string; hint: string }[] = [
  {
    key: "comoChegar",
    label: "Endereço e como chegar",
    hint: "Ex.: Rua das Flores, 120 — Vila Mariana. A 5 min a pé do metrô Santa Cruz.",
  },
  {
    key: "estacionamento",
    label: "Estacionamento",
    hint: "Ex.: Convênio com o estacionamento ao lado (R$ 10 as 2 primeiras horas).",
  },
  {
    key: "pagamento",
    label: "Pagamento e parcelamento",
    hint: "Ex.: Pix, débito e crédito em até 6x sem juros acima de R$ 500.",
  },
  {
    key: "convenios",
    label: "Convênios aceitos",
    hint: "Ex.: Não atendemos por convênio; emitimos recibo para reembolso.",
  },
  {
    key: "cancelamento",
    label: "Cancelamento e atraso",
    hint: "Ex.: Cancelamento gratuito até 24h antes. Atrasos acima de 15 min podem precisar remarcar.",
  },
  {
    key: "observacoes",
    label: "Outras informações",
    hint: "Qualquer outra coisa que a assistente deva saber (acessibilidade, crianças, pets...).",
  },
];

/** Ficha da clínica: fatos essenciais que entram INTEIROS no cérebro da
 *  assistente — sem busca, sem chance de "não achei". */
export function KnowledgeFacts({ initial }: { initial: FactsView }) {
  const [form, setForm] = useState<FactsView>(initial);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  function save() {
    setError(undefined);
    setSaved(false);
    startTransition(async () => {
      const r = await saveKnowledgeFacts(form);
      if (!r.ok) setError(r.error ?? "Não deu certo — tente de novo.");
      else setSaved(true);
    });
  }

  return (
    <section className="rounded-xl border border-stone-200 bg-white p-6">
      <h2 className="text-sm font-semibold text-stone-700">Ficha da clínica</h2>
      <p className="mt-1 text-sm text-stone-500">
        Fatos essenciais que a assistente sabe de cor, sempre. Escreva do jeito que ela
        deve falar com as clientes.
      </p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {FACT_FIELDS.map((f) => (
          <label key={f.key} className={f.key === "observacoes" ? "sm:col-span-2" : ""}>
            <span className="text-xs font-medium text-stone-600">{f.label}</span>
            <textarea
              value={form[f.key]}
              onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
              placeholder={f.hint}
              rows={f.key === "observacoes" ? 3 : 2}
              maxLength={f.key === "observacoes" ? 1200 : 600}
              className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm placeholder:text-stone-300"
            />
          </label>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-3">
        <Button onClick={save} disabled={pending}>
          {pending ? "Salvando..." : "Salvar ficha"}
        </Button>
        {saved ? <span className="text-sm text-emerald-600">Salvo! A assistente já sabe. ✓</span> : null}
      </div>
      <FieldError message={error} />
    </section>
  );
}

const EMPTY_DRAFT = { id: undefined as string | undefined, kind: "faq" as KbEntryView["kind"], title: "", content: "", active: true };

/** Cards de conhecimento: a "cauda longa" que a assistente busca sob demanda. */
export function KnowledgeCards({ initial }: { initial: KbEntryView[] }) {
  const router = useRouter();
  const [entries, setEntries] = useState<KbEntryView[]>(initial);
  const [draft, setDraft] = useState<typeof EMPTY_DRAFT | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  function save(force: boolean) {
    if (!draft) return;
    setError(undefined);
    if (!force) setWarnings([]);
    startTransition(async () => {
      const r = await saveKbEntry({ ...draft, force });
      if (r.ok) {
        setDraft(null);
        setWarnings([]);
        router.refresh();
        const view: KbEntryView = {
          id: r.entryId ?? draft.id ?? crypto.randomUUID(),
          kind: draft.kind,
          title: draft.title,
          content: draft.content,
          active: draft.active,
        };
        setEntries((prev) =>
          draft.id ? prev.map((e) => (e.id === draft.id ? view : e)) : [view, ...prev],
        );
      } else if (r.warnings?.length) {
        setWarnings(r.warnings);
      } else {
        setError(r.error ?? "Não deu certo — tente de novo.");
      }
    });
  }

  function remove(id: string) {
    if (!window.confirm("Excluir este card? A assistente deixa de usar essa informação.")) return;
    startTransition(async () => {
      const r = await deleteKbEntry({ id });
      if (r.ok) {
        setEntries((prev) => prev.filter((e) => e.id !== id));
        router.refresh();
      }
    });
  }

  return (
    <section className="rounded-xl border border-stone-200 bg-white p-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-stone-700">Cards de conhecimento</h2>
          <p className="mt-1 text-sm text-stone-500">
            Um assunto por card, curto e direto — cuidados antes de um procedimento,
            dúvidas frequentes, políticas. Antes de salvar, o sistema confere se o card
            não briga com os Serviços nem com outro card.
          </p>
        </div>
        {!draft ? (
          <Button onClick={() => { setDraft({ ...EMPTY_DRAFT }); setWarnings([]); }}>
            + Novo card
          </Button>
        ) : null}
      </div>

      {draft ? (
        <div className="mt-4 rounded-lg border border-stone-200 bg-stone-50 p-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <input
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              placeholder="Título — ex.: Cuidados antes do peeling"
              maxLength={120}
              className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
              autoFocus
            />
            <select
              value={draft.kind}
              onChange={(e) => setDraft({ ...draft, kind: e.target.value as KbEntryView["kind"] })}
              className="rounded-lg border border-stone-300 px-3 py-2 text-sm"
            >
              {Object.entries(KIND_LABEL).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <textarea
            value={draft.content}
            onChange={(e) => setDraft({ ...draft, content: e.target.value })}
            placeholder="O que a assistente deve responder sobre isso — escreva como ela falaria."
            rows={4}
            maxLength={2000}
            className="mt-3 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
          />

          {warnings.length > 0 ? (
            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
              <p className="text-sm font-medium text-amber-800">
                ⚠ Encontrei possíveis conflitos — vale conferir antes de salvar:
              </p>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-amber-700">
                {warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {warnings.length > 0 ? (
              <>
                <Button variant="secondary" onClick={() => save(true)} disabled={pending}>
                  Salvar mesmo assim
                </Button>
                <Button onClick={() => setWarnings([])} disabled={pending}>
                  Vou corrigir
                </Button>
              </>
            ) : (
              <Button onClick={() => save(false)} disabled={pending}>
                {pending ? "Conferindo e salvando..." : "Salvar card"}
              </Button>
            )}
            <Button variant="ghost" onClick={() => { setDraft(null); setWarnings([]); }} disabled={pending}>
              Cancelar
            </Button>
          </div>
          <FieldError message={error} />
        </div>
      ) : null}

      <div className="mt-4 space-y-2">
        {entries.length === 0 && !draft ? (
          <div className="rounded-lg border border-dashed border-stone-300 p-6 text-center text-sm text-stone-500">
            Nenhum card ainda. Comece pelos assuntos que as clientes mais perguntam no
            WhatsApp — estacionamento, formas de pagamento, cuidados pré e pós.
          </div>
        ) : (
          entries.map((e) => (
            <div key={e.id} className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-stone-200 p-4">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold text-stone-800">{e.title}</p>
                  <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-500">
                    {KIND_LABEL[e.kind]}
                  </span>
                  {!e.active ? (
                    <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-400">
                      inativo
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 line-clamp-2 text-sm text-stone-500">{e.content}</p>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  disabled={pending}
                  onClick={() => { setDraft({ id: e.id, kind: e.kind, title: e.title, content: e.content, active: e.active }); setWarnings([]); }}
                >
                  Editar
                </Button>
                <Button variant="ghost" disabled={pending} onClick={() => remove(e.id)}>
                  Excluir
                </Button>
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
