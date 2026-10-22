"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import {
  MAX_LIST,
  ONBOARDING_DAYS,
  ONBOARDING_MAX_LEN,
  ONBOARDING_SECTIONS,
  isAnswered,
  isRequired,
  missingRequired,
  type OnbAnswers,
  type OnbField,
  type OnbHoursDay,
} from "@clinicaos/core/onboarding-form";
import { Button, Input, Select, Textarea } from "@/components/ui";
import { SALES } from "@/app/vendas/premissas";
import { submitOnboardingForm } from "./actions";

const DRAFT_KEY = "vx-form-implantacao-v1";
type Path = (string | number)[];

function getAt(obj: unknown, path: Path): unknown {
  let cur: unknown = obj;
  for (const k of path) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string | number, unknown>)[k as string];
  }
  return cur;
}
function setAt(obj: OnbAnswers, path: Path, value: unknown): OnbAnswers {
  const next: OnbAnswers = JSON.parse(JSON.stringify(obj));
  let cur: Record<string | number, unknown> = next;
  for (let i = 0; i < path.length - 1; i++) {
    const k = path[i]!;
    if (cur[k] == null || typeof cur[k] !== "object") cur[k] = typeof path[i + 1] === "number" ? [] : {};
    cur = cur[k] as Record<string | number, unknown>;
  }
  cur[path[path.length - 1]!] = value;
  return next;
}
const idOf = (path: Path) => "q-" + path.join("-");
const suggestedHours = (k: string): OnbHoursDay =>
  k === "sab" || k === "dom" ? { on: true, a: "09:00", f: "14:00" } : { on: true, a: "08:00", f: "19:00" };

export function OnboardingForm() {
  const [answers, setAnswers] = useState<OnbAnswers>({});
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({ clinica: true });
  const [error, setError] = useState<string>();
  const [missing, setMissing] = useState<string[]>([]);
  const [doneId, setDoneId] = useState<string>();
  const [jump, setJump] = useState<string>();
  const [pending, startTransition] = useTransition();

  // Rascunho por aparelho (só conveniência: nada sai daqui até "Enviar")
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) setAnswers(JSON.parse(raw));
    } catch {
      /* sem rascunho */
    }
    setLoaded(true);
  }, []);
  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(answers));
    } catch {
      /* armazenamento indisponível */
    }
  }, [answers, loaded]);
  // Leva até o campo pendente depois que a seção abriu
  useEffect(() => {
    if (!jump) return;
    const el = document.getElementById(jump);
    if (el) {
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) el.focus({ preventScroll: true });
    }
    setJump(undefined);
  }, [jump]);

  const update = useCallback((path: Path, value: unknown) => setAnswers((prev) => setAt(prev, path, value)), []);

  // Só as obrigatórias contam: é o que decide se dá para enviar
  const progress = useMemo(() => {
    let total = 0;
    let done = 0;
    const per: Record<string, [number, number]> = {};
    for (const sec of ONBOARDING_SECTIONS) {
      let t = 0;
      let d = 0;
      const s = answers[sec.id];
      for (const f of sec.fields) {
        if (!isRequired(f, s)) continue;
        t++;
        if (isAnswered(f, s?.[f.k])) d++;
      }
      per[sec.id] = [d, t];
      total += t;
      done += d;
    }
    return { total, done, per };
  }, [answers]);

  // "Seção: Pergunta" → id do campo, para o atalho da lista de pendências
  const targets = useMemo(() => {
    const map = new Map<string, { secId: string; id: string }>();
    for (const sec of ONBOARDING_SECTIONS) for (const f of sec.fields) if (f.t !== "sub") map.set(`${sec.title}: ${f.l}`, { secId: sec.id, id: idOf([sec.id, f.k]) });
    return map;
  }, []);
  function goTo(m: string) {
    // "Seção: Pergunta (detalhe)" → campo; "Seção: Serviço 2 sem nome" → a lista daquela seção
    let t = targets.get(m.replace(/ \(.*\)$/, ""));
    if (!t) {
      const sec = ONBOARDING_SECTIONS.find((s) => m.startsWith(s.title + ":"));
      if (!sec) return;
      const list = sec.fields.find((f) => f.t === "list" && f.name && m.startsWith(`${sec.title}: ${f.name} `));
      t = { secId: sec.id, id: list ? idOf([sec.id, list.k]) : `sec-${sec.id}` };
    }
    const target = t;
    setOpen((o) => ({ ...o, [target.secId]: true }));
    setJump(target.id);
  }

  function submit() {
    setError(undefined);
    const miss = missingRequired(answers);
    if (miss.length > 0) {
      setMissing(miss);
      setError("Faltam respostas obrigatórias (marcadas com *). Toque em cada item para ir até o campo.");
      return;
    }
    setMissing([]);
    startTransition(async () => {
      const honeypot = (document.getElementById("q-site") as HTMLInputElement | null)?.value ?? "";
      let r: Awaited<ReturnType<typeof submitOnboardingForm>>;
      try {
        r = await submitOnboardingForm(answers, honeypot);
      } catch {
        setError("Não foi possível enviar agora. Verifique a conexão e tente de novo; suas respostas continuam salvas neste aparelho.");
        return;
      }
      if (r.ok) {
        setDoneId(r.id);
        window.scrollTo({ top: 0 });
      } else {
        setError(r.error);
        if (r.missing) setMissing(r.missing);
      }
    });
  }

  function startNew() {
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch {
      /* ok */
    }
    setAnswers({});
    setMissing([]);
    setError(undefined);
    setDoneId(undefined);
    setOpen({ clinica: true });
  }

  if (doneId) {
    const protocolo = doneId.slice(0, 8);
    const wa = `https://wa.me/${SALES.whatsapp}?text=${encodeURIComponent(`Oi! Enviei o formulário de implantação da clínica ${String(answers.clinica?.nome ?? "")} (protocolo ${protocolo}).`)}`;
    return (
      <div className="mt-8 rounded-2xl border border-teal-200 bg-teal-50 p-6">
        <h2 className="text-xl font-semibold text-teal-900">Recebemos o seu formulário</h2>
        <p className="mt-2 text-teal-900/80">
          Obrigado! A equipe do VesaliusX vai configurar a conta e entra em contato pelo WhatsApp informado para combinar a
          conexão do número e a entrega dos acessos.
        </p>
        <p className="mt-3 text-sm text-teal-900/70">
          Planilha de clientes, logomarca, termos de consentimento ou ficha de anamnese: mande pelo WhatsApp da equipe,{" "}
          <a href={wa} target="_blank" rel="noreferrer" className="font-medium underline">
            {SALES.whatsappDisplay}
          </a>
          . Protocolo <span className="font-mono">{protocolo}</span>.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button type="button" variant="secondary" onClick={() => setDoneId(undefined)}>
            Corrigir algo e enviar de novo
          </Button>
          <Button type="button" variant="ghost" onClick={startNew}>
            Começar um formulário em branco
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-6">
      <div className="sticky top-0 z-10 -mx-4 mb-4 border-b border-stone-200 bg-stone-50/95 px-4 py-2 backdrop-blur sm:mx-0 sm:rounded-lg sm:border sm:px-3">
        <div className="flex items-center justify-between gap-3 text-sm text-stone-600">
          <span className="tabular-nums">
            {progress.done}/{progress.total} obrigatórias respondidas
          </span>
          <span className="h-2 w-32 overflow-hidden rounded-full bg-stone-200">
            <span className="block h-full bg-teal-600 transition-[width]" style={{ width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%` }} />
          </span>
        </div>
      </div>

      <div className="space-y-3">
        {ONBOARDING_SECTIONS.map((sec, i) => {
          const [d, t] = progress.per[sec.id] ?? [0, 0];
          const isOpen = open[sec.id] ?? false;
          return (
            <section key={sec.id} id={`sec-${sec.id}`} className="rounded-xl border border-stone-200 bg-white">
              <button
                type="button"
                aria-expanded={isOpen}
                aria-controls={`body-${sec.id}`}
                onClick={() => setOpen((o) => ({ ...o, [sec.id]: !isOpen }))}
                className="flex w-full items-center gap-3 px-4 py-3 text-left"
              >
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-teal-50 text-xs font-bold text-teal-800">{i + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold text-stone-900">{sec.title}</span>
                  <span className="block text-xs text-stone-500">{sec.desc}</span>
                </span>
                <span className={`text-xs tabular-nums ${t > 0 && d === t ? "font-semibold text-emerald-700" : "text-stone-400"}`}>
                  {t === 0 ? "opcional" : d === t ? "completa" : `faltam ${t - d}`}
                </span>
                <svg viewBox="0 0 20 20" className={`h-4 w-4 shrink-0 text-stone-400 transition ${isOpen ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                  <path d="M5 8l5 5 5-5" />
                </svg>
              </button>
              {isOpen ? (
                <div id={`body-${sec.id}`} className="space-y-4 border-t border-stone-100 px-4 pb-5 pt-3">
                  {sec.intro ? <p className="text-sm text-stone-500">{sec.intro}</p> : null}
                  <Fields fields={sec.fields} base={[sec.id]} answers={answers} update={update} />
                </div>
              ) : null}
            </section>
          );
        })}
      </div>

      {/* Campo-isca para robôs: fica escondido e deve continuar vazio */}
      <div className="hidden" aria-hidden>
        <label htmlFor="q-site">Site</label>
        <input id="q-site" name="site" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      <div className="mt-6 rounded-2xl bg-stone-900 p-5 text-stone-100">
        <h2 className="text-lg font-semibold">Terminou? Envie para a equipe</h2>
        <p className="mt-1 text-sm text-stone-300">Confira se as perguntas com * estão respondidas. Depois de enviar, a equipe entra em contato pelo WhatsApp informado.</p>
        {error ? (
          <div className="mt-3 rounded-lg bg-amber-100 px-3 py-2 text-sm text-amber-900">
            {error}
            {missing.length > 0 ? (
              <ul className="mt-2 space-y-1 text-xs">
                {missing.slice(0, 15).map((m) => (
                  <li key={m}>
                    <button type="button" onClick={() => goTo(m)} className="text-left underline underline-offset-2 hover:text-amber-700">
                      {m}
                    </button>
                  </li>
                ))}
                {missing.length > 15 ? <li>e mais {missing.length - 15}...</li> : null}
              </ul>
            ) : null}
          </div>
        ) : null}
        <div className="mt-4">
          <Button type="button" onClick={submit} disabled={pending} className="!bg-amber-300 !text-stone-900 hover:!bg-amber-200">
            {pending ? "Enviando..." : "Enviar formulário"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Fields({ fields, base, answers, update }: { fields: OnbField[]; base: Path; answers: OnbAnswers; update: (p: Path, v: unknown) => void }) {
  const section = (getAt(answers, [base[0]!]) ?? {}) as Record<string, unknown>;
  const rows: React.ReactNode[] = [];
  let pendingHalf: React.ReactNode | null = null;
  fields.forEach((f) => {
    const node = <Field key={f.k} f={f} path={base.concat(f.k)} answers={answers} section={section} update={update} />;
    if (f.half) {
      if (pendingHalf) {
        rows.push(
          <div key={`${f.k}-pair`} className="grid gap-3 sm:grid-cols-2">
            {pendingHalf}
            {node}
          </div>,
        );
        pendingHalf = null;
      } else pendingHalf = node;
    } else {
      if (pendingHalf) {
        rows.push(<div key={`${f.k}-solo`} className="grid gap-3 sm:grid-cols-2">{pendingHalf}</div>);
        pendingHalf = null;
      }
      rows.push(node);
    }
  });
  if (pendingHalf) rows.push(<div key="tail" className="grid gap-3 sm:grid-cols-2">{pendingHalf}</div>);
  return <>{rows}</>;
}

/** Grade da semana: começa tudo desmarcado; ao marcar um dia, sugere 08:00–19:00 (sáb/dom 09:00–14:00). */
function HoursField({ value, onChange }: { value: unknown; onChange: (all: Record<string, OnbHoursDay>) => void }) {
  const hours = (value && typeof value === "object" ? value : {}) as Record<string, OnbHoursDay>;
  const dayOf = (k: string): OnbHoursDay => hours[k] ?? { on: false, a: "", f: "" };
  const setDay = (k: string, patch: Partial<OnbHoursDay>) => {
    const all: Record<string, OnbHoursDay> = {};
    for (const [dk] of ONBOARDING_DAYS) all[dk] = dayOf(dk);
    const next = { ...all[k]!, ...patch };
    if (next.on && !next.a) next.a = suggestedHours(k).a;
    if (next.on && !next.f) next.f = suggestedHours(k).f;
    all[k] = next;
    onChange(all);
  };
  return (
    <div className="mt-2 space-y-2">
      {ONBOARDING_DAYS.map(([k, n]) => {
        const d = dayOf(k);
        const invalid = d.on && (!d.a || !d.f || d.a >= d.f);
        return (
          <div key={k} className="grid grid-cols-[88px_1fr_1fr] items-center gap-2 sm:grid-cols-[110px_1fr_1fr]">
            <label className="inline-flex items-center gap-2 text-sm font-medium">
              <input type="checkbox" className="accent-teal-700" checked={d.on} onChange={(e) => setDay(k, { on: e.target.checked })} />
              {n}
            </label>
            <Input type="time" aria-label={`${n}: abre`} invalid={invalid} value={d.a} disabled={!d.on} onChange={(e) => setDay(k, { a: e.target.value })} />
            <Input type="time" aria-label={`${n}: fecha`} invalid={invalid} value={d.f} disabled={!d.on} onChange={(e) => setDay(k, { f: e.target.value })} />
          </div>
        );
      })}
    </div>
  );
}

function Field({ f, path, answers, section, update }: { f: OnbField; path: Path; answers: OnbAnswers; section: Record<string, unknown>; update: (p: Path, v: unknown) => void }) {
  const id = idOf(path);
  const v = getAt(answers, path);
  if (f.t === "sub") return <p className="pt-1 text-sm font-semibold text-teal-800">{f.l}</p>;
  const required = isRequired(f, section);
  const label = (
    <>
      <span className="text-sm font-medium text-stone-800">
        {f.l}
        {required ? <span className="text-red-600"> *</span> : null}
      </span>
      {f.h ? <span className="mt-0.5 block text-xs text-stone-500">{f.h}</span> : null}
    </>
  );

  if (f.t === "textarea") {
    return (
      <div>
        <label htmlFor={id} className="block">{label}</label>
        <Textarea id={id} rows={3} maxLength={ONBOARDING_MAX_LEN.textarea} className="mt-1.5" value={String(v ?? "")} onChange={(e) => update(path, e.target.value)} />
      </div>
    );
  }
  if (f.t === "select") {
    return (
      <div>
        <label htmlFor={id} className="block">{label}</label>
        <Select id={id} className="mt-1.5" value={String(v ?? "")} onChange={(e) => update(path, e.target.value)}>
          <option value="">Escolha...</option>
          {f.o?.map((o) => (
            <option key={o}>{o}</option>
          ))}
        </Select>
      </div>
    );
  }
  if (f.t === "radio" || f.t === "check") {
    const multi = f.t === "check";
    const cur = multi ? (Array.isArray(v) ? (v as string[]) : []) : String(v ?? "");
    return (
      <div role="group" aria-labelledby={id} id={`${id}-group`}>
        <span id={id} className="block">{label}</span>
        <div className="mt-1.5 flex flex-wrap gap-2">
          {f.o?.map((o) => {
            const checked = multi ? (cur as string[]).includes(o) : cur === o;
            return (
              <label key={o} className={`inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-sm ${checked ? "border-teal-600 bg-teal-50 font-medium text-teal-900" : "border-stone-300 bg-white text-stone-700"}`}>
                <input
                  type={multi ? "checkbox" : "radio"}
                  name={id}
                  value={o}
                  checked={checked}
                  className="accent-teal-700"
                  onChange={() => {
                    if (multi) {
                      const set = new Set(cur as string[]);
                      if (set.has(o)) set.delete(o);
                      else set.add(o);
                      update(path, f.o!.filter((x) => set.has(x)));
                    } else update(path, o);
                  }}
                />
                {o}
              </label>
            );
          })}
        </div>
      </div>
    );
  }
  if (f.t === "hours") {
    return (
      <div role="group" aria-labelledby={id}>
        <span id={id} className="block">{label}</span>
        <HoursField value={v} onChange={(all) => update(path, all)} />
      </div>
    );
  }
  if (f.t === "list") {
    const items = Array.isArray(v) ? (v as Record<string, unknown>[]) : [];
    return (
      <div role="group" aria-labelledby={id}>
        <span id={id} className="block">{label}</span>
        <div className="mt-2 space-y-3">
          {items.map((_, idx) => (
            <div key={idx} className="space-y-3 rounded-xl border border-dashed border-stone-300 bg-stone-50 p-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-stone-700">
                  {f.name} {idx + 1}
                </span>
                <button
                  type="button"
                  className="text-xs text-stone-500 underline-offset-2 hover:text-red-600 hover:underline"
                  onClick={() => update(path, items.filter((__, j) => j !== idx))}
                >
                  Remover
                </button>
              </div>
              <Fields fields={f.f ?? []} base={path.concat(idx)} answers={answers} update={update} />
            </div>
          ))}
          <Button type="button" variant="secondary" disabled={items.length >= MAX_LIST} onClick={() => update(path, items.concat({}))}>
            + {f.add}
          </Button>
        </div>
      </div>
    );
  }
  const inputType = f.t === "number" ? "number" : f.t;
  return (
    <div>
      <label htmlFor={id} className="block">{label}</label>
      <Input
        id={id}
        type={inputType}
        inputMode={f.t === "number" ? "numeric" : f.t === "tel" ? "tel" : undefined}
        maxLength={ONBOARDING_MAX_LEN.text}
        className="mt-1.5"
        value={String(v ?? "")}
        onChange={(e) => update(path, e.target.value)}
      />
    </div>
  );
}
