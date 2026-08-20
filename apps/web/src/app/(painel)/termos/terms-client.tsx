"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { searchCustomers } from "@/app/(painel)/agenda/actions";
import { Button, FieldError, Input, Label, Modal, Select, Textarea } from "@/components/ui";
import {
  generateAndSendTerm,
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

export function GenerateTermButton({
  templates,
  procedures,
}: {
  templates: { id: string; name: string }[];
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
  const [valor, setValor] = useState("");
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function close() {
    setOpen(false);
    setError(undefined);
    setSuccess(undefined);
    setCustomer(null);
    setOptions([]);
    setQuery("");
    setValor("");
  }

  function onQueryChange(value: string) {
    setQuery(value);
    setCustomer(null);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (value.trim().length < 2) {
      setOptions([]);
      return;
    }
    searchTimer.current = setTimeout(() => {
      void searchCustomers({ q: value }).then(setOptions).catch(() => setOptions([]));
    }, 250);
  }

  function submit(fd: FormData) {
    setError(undefined);
    startTransition(async () => {
      const result = await generateAndSendTerm({
        customerId: customer?.id ?? "",
        templateId: String(fd.get("templateId") ?? ""),
        procedureId: String(fd.get("procedureId") ?? ""),
        valor: String(fd.get("valor") ?? ""),
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
      <Modal open={open} onClose={close} title="Gerar e enviar termo">
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
              submit(new FormData(e.currentTarget));
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
                <>
                  <Input
                    id="gt-customer"
                    value={query}
                    onChange={(e) => onQueryChange(e.target.value)}
                    placeholder="Busque por nome ou telefone..."
                    autoComplete="off"
                  />
                  {options.length > 0 ? (
                    <ul className="mt-1 overflow-hidden rounded-lg border border-stone-200 bg-white shadow-sm">
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
                    </ul>
                  ) : null}
                </>
              )}
            </div>
            <div>
              <Label htmlFor="gt-template">Modelo</Label>
              <Select id="gt-template" name="templateId" defaultValue="" required>
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
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="gt-procedure">Procedimento</Label>
                <Select
                  id="gt-procedure"
                  name="procedureId"
                  defaultValue=""
                  required
                  onChange={(e) => {
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
                  name="valor"
                  inputMode="decimal"
                  value={valor}
                  onChange={(e) => setValor(e.target.value)}
                  required
                />
              </div>
            </div>
            <FieldError message={error} />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={close}>
                Cancelar
              </Button>
              <Button type="submit" disabled={pending || !customer}>
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
