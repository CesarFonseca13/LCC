"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { renderTemplate } from "@clinicaos/core/template-render";
import { searchCustomers } from "@/app/(painel)/agenda/actions";
import { Button, FieldError, Input, Label, Modal, Select, Textarea } from "@/components/ui";
import {
  generateAndSendTerm,
  previewTermVariables,
  resendTerm,
  saveDocumentTemplate,
  toggleTemplateActive,
} from "./actions";

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
            <Input id="tm-name" name="name" defaultValue={initial?.name ?? ""} required />
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
              Use as variáveis — elas são preenchidas sozinhas no envio:{" "}
              {["nome", "cpf", "telefone", "email", "endereco", "valor", "procedimento", "clinica", "data"].map(
                (v) => (
                  <code key={v} className="mr-1 rounded bg-stone-100 px-1">
                    {`{{${v}}}`}
                  </code>
                ),
              )}
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

type TermVariable = { name: string; label: string; value: string; auto: boolean };

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
  const [customer, setCustomer] = useState<{ id: string; label: string } | null>(null);
  const [options, setOptions] = useState<{ id: string; label: string }[]>([]);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [templateId, setTemplateId] = useState("");
  const [procedureId, setProcedureId] = useState("");
  const [valor, setValor] = useState("");
  // Passo de conferência: variáveis que o modelo usa, com o valor da ficha
  // (auto) ou vazias para a equipe preencher antes de enviar
  const [variables, setVariables] = useState<TermVariable[]>([]);
  const [loadingVars, setLoadingVars] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function close() {
    setOpen(false);
    setError(undefined);
    setSuccess(undefined);
    setCustomer(null);
    setOptions([]);
    setQuery("");
    setSearching(false);
    setTemplateId("");
    setProcedureId("");
    setValor("");
    setVariables([]);
  }

  function onQueryChange(value: string) {
    setQuery(value);
    setCustomer(null);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (value.trim().length < 2) {
      setOptions([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    searchTimer.current = setTimeout(() => {
      void searchCustomers({ q: value })
        .then(setOptions)
        .catch(() => setOptions([]))
        .finally(() => setSearching(false));
    }, 200);
  }

  // Cliente + modelo escolhidos → busca o que a ficha já preenche. Edições
  // manuais feitas antes são preservadas (a ficha só sugere, não sobrescreve).
  useEffect(() => {
    if (!customer || !templateId) {
      setVariables([]);
      return;
    }
    let cancelled = false;
    setLoadingVars(true);
    void previewTermVariables({
      customerId: customer.id,
      templateId,
      procedureId: procedureId || undefined,
      valor: valor || undefined,
    })
      .then((r) => {
        if (cancelled || !r.ok) return;
        setVariables((prev) =>
          r.variables.map((v) => {
            const antes = prev.find((p) => p.name === v.name);
            return antes && !antes.auto && antes.value ? { ...v, value: antes.value, auto: false } : v;
          }),
        );
      })
      .finally(() => {
        if (!cancelled) setLoadingVars(false);
      });
    return () => {
      cancelled = true;
    };
  }, [customer, templateId, procedureId, valor]);

  const template = templates.find((t) => t.id === templateId);
  const faltando = variables.filter((v) => !v.value.trim());
  // Prévia ao vivo com os valores da tela (só quando não falta nada)
  let preview: string | null = null;
  if (template && variables.length > 0 && faltando.length === 0) {
    try {
      preview = renderTemplate(
        template.bodyText,
        Object.fromEntries(variables.map((v) => [v.name, v.value.trim()])),
        { html: false },
      );
    } catch {
      preview = null;
    }
  }

  function submit() {
    setError(undefined);
    startTransition(async () => {
      const result = await generateAndSendTerm({
        customerId: customer?.id ?? "",
        templateId,
        procedureId,
        valor,
        overrides: Object.fromEntries(variables.map((v) => [v.name, v.value])),
      });
      if (result.ok) {
        setSuccess({ signUrl: result.signUrl, whatsappSent: result.whatsappSent });
        router.refresh();
      } else {
        setError(result.error);
      }
    });
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
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
            className="space-y-4"
          >
            <div>
              <Label htmlFor="gt-customer">Cliente</Label>
              {customer ? (
                <div className="flex items-center justify-between rounded-lg border border-teal-200 bg-teal-50 px-3 py-2 text-sm text-teal-900">
                  <span>{customer.label}</span>
                  <button
                    type="button"
                    className="text-xs text-teal-700 underline"
                    onClick={() => setCustomer(null)}
                  >
                    trocar
                  </button>
                </div>
              ) : (
                <div className="relative">
                  <Input
                    id="gt-customer"
                    value={query}
                    onChange={(e) => onQueryChange(e.target.value)}
                    placeholder="Digite o nome ou telefone da cliente..."
                    autoComplete="off"
                    autoFocus
                  />
                  {query.trim().length >= 2 ? (
                    <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-stone-200 bg-white shadow-lg">
                      {options.map((o) => (
                        <li key={o.id}>
                          <button
                            type="button"
                            className="w-full px-3 py-2 text-left text-sm hover:bg-teal-50"
                            onClick={() => {
                              setCustomer(o);
                              setOptions([]);
                            }}
                          >
                            {o.label}
                          </button>
                        </li>
                      ))}
                      {options.length === 0 ? (
                        <li className="px-3 py-2 text-sm text-stone-400">
                          {searching
                            ? "Buscando..."
                            : "Nenhuma cliente com esse nome — cadastre em Clientes."}
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
                  required
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
                  required
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
                  required
                />
              </div>
            </div>

            {/* Conferência das variáveis do modelo antes de enviar */}
            {customer && templateId ? (
              <div className="rounded-lg border border-stone-200 bg-stone-50 p-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-stone-700">Variáveis deste modelo</p>
                  {loadingVars ? (
                    <span className="text-xs text-stone-400">Preenchendo pela ficha...</span>
                  ) : faltando.length > 0 ? (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                      {faltando.length} para preencher
                    </span>
                  ) : variables.length > 0 ? (
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
                      tudo preenchido ✓
                    </span>
                  ) : null}
                </div>
                <p className="mt-0.5 text-xs text-stone-500">
                  O que vem da ficha já está preenchido — confira e complete o que faltar. O
                  que você digitar aqui também completa a ficha da cliente (só campos vazios).
                </p>
                {variables.length > 0 ? (
                  <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {variables.map((v) => (
                      <label key={v.name} className="block">
                        <span className="flex items-center gap-1.5 text-xs font-medium text-stone-600">
                          {v.label}
                          <code className="rounded bg-stone-200 px-1 text-[10px] text-stone-500">
                            {`{{${v.name}}}`}
                          </code>
                          {v.auto ? (
                            <span className="text-[10px] text-emerald-600">da ficha</span>
                          ) : !v.value.trim() ? (
                            <span className="text-[10px] text-amber-600">preencher</span>
                          ) : null}
                        </span>
                        <Input
                          value={v.value}
                          onChange={(e) =>
                            setVariables((prev) =>
                              prev.map((p) =>
                                p.name === v.name ? { ...p, value: e.target.value, auto: false } : p,
                              ),
                            )
                          }
                          className={`mt-1 ${!v.value.trim() ? "border-amber-300 bg-amber-50" : ""}`}
                          aria-label={v.label}
                        />
                      </label>
                    ))}
                  </div>
                ) : !loadingVars ? (
                  <p className="mt-2 text-xs text-stone-400">Este modelo não usa variáveis.</p>
                ) : null}
                {preview ? (
                  <details className="mt-3">
                    <summary className="cursor-pointer text-xs font-medium text-teal-700">
                      Ver prévia do termo como a cliente vai receber
                    </summary>
                    <pre className="mt-2 max-h-64 overflow-y-auto whitespace-pre-wrap rounded-lg border border-stone-200 bg-white p-3 text-xs text-stone-700">
                      {preview}
                    </pre>
                  </details>
                ) : null}
              </div>
            ) : null}

            <FieldError message={error} />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={close}>
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={
                  pending || !customer || !templateId || !procedureId || loadingVars || faltando.length > 0
                }
              >
                {pending ? "Gerando..." : "Gerar e enviar"}
              </Button>
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
