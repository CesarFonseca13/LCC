"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { renderTemplate } from "@clinicaos/core/template-render";
import { searchCustomers } from "@/app/(painel)/agenda/actions";
import { Button, FieldError, Input, Label, Modal, Select, Textarea } from "@/components/ui";
import { formatDecimalBR, isValidEmail, normalizeCPF, parseBRLDecimal } from "@/lib/format";
import {
  generateAndSendTerm,
  previewTermVariables,
  resendTerm,
  saveDocumentTemplate,
  toggleTemplateActive,
} from "./actions";

const TERM_VARIABLES = [
  "nome",
  "cpf",
  "telefone",
  "email",
  "endereco",
  "profissional",
  "valor",
  "procedimento",
  "clinica",
  "data",
];

// ── Modelo ───────────────────────────────────────────────────────────

export function TemplateFormButton({
  initial,
}: {
  initial?: { id: string; name: string; bodyText: string; active: boolean };
}) {
  const router = useRouter();
  const isEdit = Boolean(initial?.id);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  function submit(fd: FormData) {
    setError(undefined);
    startTransition(async () => {
      const result = await saveDocumentTemplate({
        id: initial?.id,
        name: String(fd.get("name") ?? ""),
        bodyText: String(fd.get("bodyText") ?? ""),
      });
      if (result.ok) {
        setOpen(false);
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  function toggle() {
    if (!initial) return;
    startTransition(async () => {
      await toggleTemplateActive({ id: initial.id, active: !initial.active });
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      {isEdit ? (
        <Button variant="ghost" onClick={() => setOpen(true)}>
          Editar
        </Button>
      ) : (
        <Button variant="secondary" onClick={() => setOpen(true)}>
          + Novo modelo
        </Button>
      )}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={isEdit ? `Editar ${initial?.name}` : "Novo modelo de termo"}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit(new FormData(e.currentTarget));
          }}
          className="space-y-4"
        >
          <div>
            <Label htmlFor="tm-name">Nome do modelo</Label>
            <Input
              id="tm-name"
              name="name"
              defaultValue={initial?.name ?? ""}
              required
              data-autofocus
            />
          </div>
          <div>
            <Label htmlFor="tm-body">Texto do termo</Label>
            <Textarea
              id="tm-body"
              name="bodyText"
              rows={12}
              defaultValue={initial?.bodyText ?? ""}
              required
            />
            <p className="mt-1 text-xs text-stone-400">
              Use as variáveis — elas são conferidas e preenchidas na hora de enviar:{" "}
              {TERM_VARIABLES.map((v) => (
                <code key={v} className="mr-1 rounded bg-stone-100 px-1">
                  {`{{${v}}}`}
                </code>
              ))}
            </p>
          </div>
          <FieldError message={error} />
          <div className="flex justify-between gap-2">
            {isEdit ? (
              <Button type="button" variant="danger" onClick={toggle} disabled={pending}>
                {initial?.active ? "Desativar" : "Reativar"}
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Salvando..." : "Salvar modelo"}
              </Button>
            </div>
          </div>
        </form>
      </Modal>
    </>
  );
}

// ── Gerar e enviar ───────────────────────────────────────────────────

type TermVariable = {
  name: string;
  label: string;
  /** Valor que o servidor já tem (ficha / clínica / hoje). */
  value: string;
  source: "ficha" | "clinica" | "hoje" | "formulario" | "manual";
  /** false = derivada do formulário/cadastro (valor, procedimento, clínica, data). */
  editable: boolean;
};

type CustomerOption = { id: string; label: string };

/** Formato mínimo do que vai para um documento legal (e para a ficha). */
function problemaDe(name: string, value: string): string | null {
  const t = value.trim();
  if (!t) return null;
  if (name === "cpf" && !normalizeCPF(t)) return "CPF precisa ter 11 dígitos";
  if (name === "email" && !isValidEmail(t)) return "E-mail inválido";
  return null;
}

export function GenerateTermButton({
  templates,
  procedures,
}: {
  templates: { id: string; name: string; bodyText: string }[];
  procedures: { id: string; name: string; price: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string>();
  const [success, setSuccess] = useState<{ signUrl?: string; whatsappSent?: boolean }>();
  const [pending, startTransition] = useTransition();

  // Cliente (autocomplete)
  const [customer, setCustomer] = useState<CustomerOption | null>(null);
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<CustomerOption[]>([]);
  const [searching, setSearching] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Respostas podem chegar fora de ordem — só a da última digitação vale
  const searchSeq = useRef(0);

  // Formulário
  const [templateId, setTemplateId] = useState("");
  const [procedureId, setProcedureId] = useState("");
  const [valor, setValor] = useState("");

  // Passo de conferência: o que o servidor sabe (ficha/clínica/hoje) e o que a
  // equipe editou por cima (chave presente = campo mexido, mesmo se esvaziado)
  const [serverVars, setServerVars] = useState<TermVariable[]>([]);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [loadingVars, setLoadingVars] = useState(false);
  const [varsError, setVarsError] = useState(false);
  const [varsRetry, setVarsRetry] = useState(0);
  const [previewOpen, setPreviewOpen] = useState(false);

  function close() {
    setOpen(false);
    setError(undefined);
    setSuccess(undefined);
    setCustomer(null);
    setOptions([]);
    setQuery("");
    setSearching(false);
    setListOpen(false);
    setTemplateId("");
    setProcedureId("");
    setValor("");
    setServerVars([]);
    setEdits({});
    setVarsError(false);
    setPreviewOpen(false);
  }

  function onQueryChange(value: string) {
    setQuery(value);
    setCustomer(null);
    setHighlight(0);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (value.trim().length < 2) {
      setOptions([]);
      setSearching(false);
      setListOpen(false);
      return;
    }
    setListOpen(true);
    setSearching(true);
    const seq = ++searchSeq.current;
    searchTimer.current = setTimeout(() => {
      void searchCustomers({ q: value })
        .then((rows) => {
          if (seq === searchSeq.current) setOptions(rows);
        })
        .catch(() => {
          if (seq === searchSeq.current) setOptions([]);
        })
        .finally(() => {
          if (seq === searchSeq.current) setSearching(false);
        });
    }, 200);
  }

  function pickCustomer(o: CustomerOption) {
    setCustomer(o);
    setOptions([]);
    setListOpen(false);
    setQuery("");
    setEdits({});
  }

  function trocarCliente() {
    setCustomer(null);
    setQuery("");
    setOptions([]);
    setListOpen(false);
    setEdits({});
  }

  function reopenList() {
    if (query.trim().length >= 2) setListOpen(true);
  }

  function onCustomerKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!listOpen) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        reopenList();
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, Math.max(options.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const o = options[highlight];
      if (o) pickCustomer(o);
    } else if (e.key === "Escape") {
      // Fecha só a lista — sem isso o Esc fecha o modal inteiro
      e.preventDefault();
      e.stopPropagation();
      setListOpen(false);
    }
  }

  // Cliente + modelo escolhidos → busca o que a ficha já preenche. Valor e
  // procedimento não vão ao servidor: a tela calcula pelo formulário.
  useEffect(() => {
    if (!customer || !templateId) {
      setServerVars([]);
      setVarsError(false);
      return;
    }
    let cancelled = false;
    setLoadingVars(true);
    setVarsError(false);
    void previewTermVariables({ customerId: customer.id, templateId })
      .then((r) => {
        if (cancelled) return;
        if (!r.ok) {
          setVarsError(true);
          setServerVars([]);
          return;
        }
        setServerVars(r.variables);
      })
      .catch(() => {
        if (!cancelled) {
          setVarsError(true);
          setServerVars([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingVars(false);
      });
    return () => {
      cancelled = true;
    };
  }, [customer, templateId, varsRetry]);

  const template = templates.find((t) => t.id === templateId);
  const procedure = procedures.find((p) => p.id === procedureId);
  const valorDecimal = parseBRLDecimal(valor);
  const varsLoaded = Boolean(customer && templateId) && !loadingVars && !varsError;

  const rows = serverVars.map((v) => {
    let value = v.value;
    let edited = false;
    if (v.name === "valor") value = valorDecimal !== null ? formatDecimalBR(valorDecimal) : "";
    else if (v.name === "procedimento") value = procedure?.name ?? "";
    else if (v.editable && edits[v.name] !== undefined) {
      value = edits[v.name] ?? "";
      edited = true;
    }
    return { ...v, value, edited, problema: problemaDe(v.name, value) };
  });
  const faltando = rows.filter((r) => !r.value.trim());
  const invalidos = rows.filter((r) => r.problema);

  // Prévia sempre que o modelo está carregado — lacunas aparecem entre colchetes
  let preview: string | null = null;
  if (template && varsLoaded) {
    try {
      preview = renderTemplate(
        template.bodyText,
        Object.fromEntries(rows.map((r) => [r.name, r.value.trim() || `[${r.label}]`])),
        { html: false },
      );
    } catch {
      preview = null;
    }
  }

  // Um único motivo para o botão estar cinza — dito ao lado dele
  const motivo =
    templates.length === 0
      ? "Nenhum modelo ativo — crie ou reative um na aba Modelos"
      : procedures.length === 0
        ? "Nenhum procedimento ativo — cadastre em Serviços"
        : !customer
          ? "Escolha a cliente"
          : !templateId
            ? "Escolha o modelo"
            : !procedureId
              ? "Escolha o procedimento"
              : valorDecimal === null
                ? "Informe um valor válido no campo Valor (R$), ex.: 1500,00"
                : loadingVars
                  ? "Preenchendo pela ficha..."
                  : varsError
                    ? "Não consegui ler a ficha — tente de novo"
                    : faltando.length > 0
                      ? `Falta preencher: ${faltando.map((r) => r.label).join(", ")}`
                      : invalidos.length > 0
                        ? `Corrija: ${invalidos.map((r) => r.label).join(", ")}`
                        : null;

  function submit() {
    if (motivo) return;
    setError(undefined);
    startTransition(async () => {
      const result = await generateAndSendTerm({
        customerId: customer?.id ?? "",
        templateId,
        procedureId,
        valor,
        overrides: Object.fromEntries(rows.filter((r) => r.editable).map((r) => [r.name, r.value])),
      });
      if (result.ok) {
        setSuccess({ signUrl: result.signUrl, whatsappSent: result.whatsappSent });
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  function origemDe(r: (typeof rows)[number]): { text: string; className: string } {
    if (!r.editable) {
      const text =
        r.source === "formulario"
          ? "do formulário acima"
          : r.source === "clinica"
            ? "do cadastro da clínica"
            : "data de hoje";
      return { text, className: "text-stone-400" };
    }
    if (r.edited) return { text: "editado", className: "text-teal-600" };
    if (!r.value.trim()) return { text: "preencher", className: "text-amber-600" };
    return r.source === "ficha"
      ? { text: "da ficha", className: "text-emerald-600" }
      : { text: "digitado", className: "text-teal-600" };
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>Gerar e enviar</Button>
      <Modal open={open} onClose={close} title="Gerar e enviar termo" size="lg">
        {success ? (
          <div className="space-y-4">
            {success.whatsappSent ? (
              <p className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                ✓ Termo gerado e enviado pelo WhatsApp! Acompanhe em “Enviados”.
              </p>
            ) : (
              <div className="space-y-2">
                <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  Termo gerado — o WhatsApp não está conectado, então copie o link e envie
                  você mesma:
                </p>
                <Input readOnly value={success.signUrl ?? ""} onFocus={(e) => e.currentTarget.select()} />
              </div>
            )}
            <div className="flex justify-end">
              <Button onClick={close}>Fechar</Button>
            </div>
          </div>
        ) : (
          <form
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
            className="space-y-4"
          >
            {templates.length === 0 || procedures.length === 0 ? (
              <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
                {templates.length === 0
                  ? "Nenhum modelo de termo ativo. Crie ou reative um na aba Modelos antes de enviar."
                  : "Nenhum procedimento ativo. Cadastre em Serviços antes de enviar."}
              </p>
            ) : null}

            <div>
              <Label htmlFor="gt-customer">Cliente</Label>
              {customer ? (
                <div className="flex items-center justify-between rounded-lg border border-teal-200 bg-teal-50 px-3 py-2 text-sm text-teal-900">
                  <span>{customer.label}</span>
                  <button
                    type="button"
                    className="text-xs text-teal-700 underline"
                    onClick={trocarCliente}
                  >
                    trocar
                  </button>
                </div>
              ) : (
                <div>
                  <Input
                    id="gt-customer"
                    value={query}
                    onChange={(e) => onQueryChange(e.target.value)}
                    onKeyDown={onCustomerKeyDown}
                    onFocus={reopenList}
                    onClick={reopenList}
                    placeholder="Digite o nome ou telefone da cliente..."
                    autoComplete="off"
                    autoFocus
                    data-autofocus
                    role="combobox"
                    aria-expanded={listOpen}
                    aria-controls="gt-customer-list"
                    aria-autocomplete="list"
                  />
                  {listOpen && query.trim().length >= 2 ? (
                    <ul
                      id="gt-customer-list"
                      role="listbox"
                      className="mt-1 max-h-56 overflow-y-auto rounded-lg border border-stone-200 bg-white shadow-sm"
                    >
                      {options.map((o, i) => (
                        <li key={o.id} role="option" aria-selected={i === highlight}>
                          <button
                            type="button"
                            className={`w-full px-3 py-2 text-left text-sm ${
                              i === highlight ? "bg-teal-50 text-teal-900" : "hover:bg-stone-50"
                            }`}
                            onMouseEnter={() => setHighlight(i)}
                            onClick={() => pickCustomer(o)}
                          >
                            {o.label}
                          </button>
                        </li>
                      ))}
                      {options.length === 0 ? (
                        <li className="px-3 py-2 text-sm text-stone-400">
                          {searching
                            ? "Buscando..."
                            : "Nenhuma cliente encontrada com esse nome ou telefone — cadastre em Clientes."}
                        </li>
                      ) : null}
                    </ul>
                  ) : null}
                </div>
              )}
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <Label htmlFor="gt-template">Modelo</Label>
                <Select
                  id="gt-template"
                  value={templateId}
                  onChange={(e) => setTemplateId(e.target.value)}
                >
                  <option value="" disabled>
                    Escolha...
                  </option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="gt-procedure">Procedimento</Label>
                <Select
                  id="gt-procedure"
                  value={procedureId}
                  onChange={(e) => {
                    setProcedureId(e.target.value);
                    const proc = procedures.find((p) => p.id === e.target.value);
                    if (proc) setValor(proc.price);
                  }}
                >
                  <option value="" disabled>
                    Escolha...
                  </option>
                  {procedures.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="gt-valor">Valor (R$)</Label>
                <Input
                  id="gt-valor"
                  inputMode="decimal"
                  value={valor}
                  onChange={(e) => setValor(e.target.value)}
                  invalid={valor.trim() !== "" && valorDecimal === null}
                  placeholder="1500,00"
                />
                {valor.trim() !== "" && valorDecimal === null ? (
                  <p className="mt-1 text-xs text-amber-700">Use números, ex.: 1500,00</p>
                ) : null}
              </div>
            </div>

            {/* Conferência das variáveis do modelo antes de enviar */}
            {customer && templateId ? (
              <div className="rounded-lg border border-stone-200 bg-stone-50 p-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium text-stone-700">Variáveis deste modelo</p>
                  {loadingVars ? (
                    <span className="text-xs text-stone-400">Preenchendo pela ficha...</span>
                  ) : varsError ? (
                    <span className="flex items-center gap-2 text-xs text-red-600">
                      Não consegui ler a ficha
                      <button
                        type="button"
                        className="underline"
                        onClick={() => setVarsRetry((n) => n + 1)}
                      >
                        tentar de novo
                      </button>
                    </span>
                  ) : faltando.length > 0 ? (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                      {faltando.length} para preencher
                    </span>
                  ) : invalidos.length > 0 ? (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                      {invalidos.length} para corrigir
                    </span>
                  ) : rows.length > 0 ? (
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
                      tudo preenchido ✓
                    </span>
                  ) : null}
                </div>
                <p className="mt-0.5 text-xs text-stone-500">
                  O que vem da ficha já está preenchido — confira e complete o que faltar. CPF e
                  e-mail digitados aqui também completam a ficha da cliente (só se lá estiverem
                  vazios).
                </p>
                {rows.length > 0 ? (
                  <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {rows.map((r) => {
                      const vazio = !r.value.trim();
                      const origem = origemDe(r);
                      const fichaValue = serverVars.find((s) => s.name === r.name)?.value ?? "";
                      const dica = !r.editable && vazio
                        ? r.name === "valor"
                          ? "Informe o valor no campo Valor (R$) acima"
                          : r.name === "procedimento"
                            ? "Escolha o procedimento acima"
                            : null
                        : r.problema;
                      return (
                        <div key={r.name}>
                          <span className="flex items-center gap-1.5 text-xs font-medium text-stone-600">
                            {r.label}
                            <code className="rounded bg-stone-200 px-1 text-[10px] text-stone-500">
                              {`{{${r.name}}}`}
                            </code>
                            <span className={`text-[10px] ${origem.className}`}>{origem.text}</span>
                            {r.edited && fichaValue ? (
                              <button
                                type="button"
                                className="ml-auto text-[10px] text-stone-500 underline"
                                onClick={() =>
                                  setEdits((prev) => {
                                    const next = { ...prev };
                                    delete next[r.name];
                                    return next;
                                  })
                                }
                              >
                                restaurar da ficha
                              </button>
                            ) : null}
                          </span>
                          <Input
                            className="mt-1"
                            value={r.value}
                            readOnly={!r.editable}
                            tabIndex={r.editable ? undefined : -1}
                            invalid={vazio || Boolean(r.problema)}
                            onChange={(e) =>
                              setEdits((prev) => ({ ...prev, [r.name]: e.target.value }))
                            }
                            aria-label={r.label}
                          />
                          {dica ? <p className="mt-1 text-[11px] text-amber-700">{dica}</p> : null}
                        </div>
                      );
                    })}
                  </div>
                ) : varsLoaded ? (
                  <p className="mt-2 text-xs text-stone-400">Este modelo não usa variáveis.</p>
                ) : null}
                {preview ? (
                  <details
                    className="mt-3"
                    open={previewOpen}
                    onToggle={(e) => setPreviewOpen(e.currentTarget.open)}
                  >
                    <summary className="cursor-pointer text-xs font-medium text-teal-700">
                      {faltando.length > 0
                        ? "Ver prévia do termo (o que falta aparece entre colchetes)"
                        : "Ver prévia do termo como a cliente vai receber"}
                    </summary>
                    <pre className="mt-2 max-h-64 overflow-y-auto whitespace-pre-wrap rounded-lg border border-stone-200 bg-white p-3 text-xs text-stone-700">
                      {preview}
                    </pre>
                  </details>
                ) : null}
              </div>
            ) : null}

            <FieldError message={error} />
            <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
              {motivo && !pending ? (
                <span className="text-xs text-stone-500">{motivo}</span>
              ) : null}
              <div className="flex gap-2">
                <Button type="button" variant="secondary" onClick={close}>
                  Cancelar
                </Button>
                <Button type="submit" disabled={pending || motivo !== null}>
                  {pending ? "Gerando..." : "Gerar e enviar"}
                </Button>
              </div>
            </div>
          </form>
        )}
      </Modal>
    </>
  );
}

// ── Ações da linha (Enviados) ────────────────────────────────────────

export function TermRowActions({
  id,
  status,
  hasPdf,
  signUrl,
}: {
  id: string;
  status: string;
  hasPdf: boolean;
  signUrl: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [copied, setCopied] = useState(false);

  return (
    <span className="inline-flex items-center gap-1.5">
      {hasPdf ? (
        <a
          href={`/api/documents/${id}/pdf`}
          className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-teal-700 hover:bg-teal-50"
        >
          Baixar PDF
        </a>
      ) : null}
      {["sent", "viewed"].includes(status) ? (
        <>
          <button
            type="button"
            className="rounded-lg px-2.5 py-1.5 text-xs text-stone-500 hover:bg-stone-100"
            onClick={() => {
              void navigator.clipboard.writeText(signUrl).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              });
            }}
          >
            {copied ? "Copiado!" : "Copiar link"}
          </button>
          <button
            type="button"
            disabled={pending}
            className="rounded-lg px-2.5 py-1.5 text-xs text-stone-500 hover:bg-stone-100 disabled:opacity-50"
            onClick={() =>
              startTransition(async () => {
                await resendTerm({ id });
                router.refresh();
              })
            }
          >
            Reenviar
          </button>
        </>
      ) : null}
    </span>
  );
}
