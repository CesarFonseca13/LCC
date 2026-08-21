"use client";

import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition } from "react";
import { searchCustomers } from "@/app/(painel)/agenda/actions";
import { Button, FieldError, Input, Label, Modal, Select } from "@/components/ui";
import { convertQuote, createAndSendQuote, setQuoteStatus } from "./actions";

interface CatalogItem {
  id: string;
  name: string;
  price: string;
}

interface Row {
  key: number;
  kind: "procedure" | "package";
  refId: string;
  quantity: number;
  unitPrice: string;
}

function parsePrice(v: string): number {
  const n = Number(
    v.replace(/\s|R\$/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", "."),
  );
  return Number.isNaN(n) ? 0 : n;
}

export function CreateQuoteButton({
  procedures,
  packages,
}: {
  procedures: CatalogItem[];
  packages: CatalogItem[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string>();
  const [success, setSuccess] = useState<{ quoteUrl?: string; whatsappSent?: boolean }>();
  const [pending, startTransition] = useTransition();
  const [customer, setCustomer] = useState<{ id: string; label: string } | null>(null);
  const [options, setOptions] = useState<{ id: string; label: string }[]>([]);
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [discount, setDiscount] = useState("");
  const nextKey = useRef(1);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function close() {
    setOpen(false);
    setError(undefined);
    setSuccess(undefined);
    setCustomer(null);
    setOptions([]);
    setQuery("");
    setRows([]);
    setDiscount("");
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

  function addRow(kind: "procedure" | "package") {
    const source = kind === "procedure" ? procedures : packages;
    const first = source[0];
    if (!first) return;
    setRows((r) => [
      ...r,
      { key: nextKey.current++, kind, refId: first.id, quantity: 1, unitPrice: first.price },
    ]);
  }

  function updateRow(key: number, patch: Partial<Row>) {
    setRows((r) =>
      r.map((row) => {
        if (row.key !== key) return row;
        const next = { ...row, ...patch };
        if (patch.refId) {
          const source = next.kind === "procedure" ? procedures : packages;
          const item = source.find((i) => i.id === patch.refId);
          if (item) next.unitPrice = item.price;
        }
        return next;
      }),
    );
  }

  const subtotal = useMemo(
    () => rows.reduce((acc, r) => acc + parsePrice(r.unitPrice) * r.quantity, 0),
    [rows],
  );
  const total = Math.max(subtotal - parsePrice(discount), 0);

  function submit(fd: FormData) {
    setError(undefined);
    startTransition(async () => {
      const result = await createAndSendQuote({
        customerId: customer?.id ?? "",
        items: rows.map((r) => ({
          kind: r.kind,
          refId: r.refId,
          quantity: String(r.quantity),
          unitPrice: r.unitPrice,
        })),
        discount,
        validDays: String(fd.get("validDays") ?? "7"),
        notes: String(fd.get("notes") ?? ""),
      });
      if (result.ok) {
        setSuccess({ quoteUrl: result.quoteUrl, whatsappSent: result.whatsappSent });
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>+ Novo orçamento</Button>
      <Modal open={open} onClose={close} title="Novo orçamento">
        {success ? (
          <div className="space-y-4">
            {success.whatsappSent ? (
              <p className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                ✓ Orçamento enviado pelo WhatsApp! Acompanhe aqui na lista — o status
                muda para “Visualizado” quando a cliente abrir.
              </p>
            ) : (
              <div className="space-y-2">
                <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  Orçamento criado — o WhatsApp não está conectado, copie o link:
                </p>
                <Input readOnly value={success.quoteUrl ?? ""} onFocus={(e) => e.currentTarget.select()} />
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
              <Label htmlFor="q-customer">Cliente</Label>
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
                    id="q-customer"
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
              <div className="flex items-center justify-between">
                <Label>Itens</Label>
                <div className="flex gap-2">
                  <Button type="button" variant="ghost" onClick={() => addRow("procedure")}>
                    + Procedimento
                  </Button>
                  {packages.length > 0 ? (
                    <Button type="button" variant="ghost" onClick={() => addRow("package")}>
                      + Pacote
                    </Button>
                  ) : null}
                </div>
              </div>
              {rows.length === 0 ? (
                <p className="rounded-lg border border-dashed border-stone-300 px-3 py-4 text-center text-xs text-stone-400">
                  Adicione procedimentos ou pacotes ao orçamento.
                </p>
              ) : (
                <div className="space-y-2">
                  {rows.map((row) => (
                    <div key={row.key} className="flex items-center gap-2">
                      <Select
                        value={row.refId}
                        onChange={(e) => updateRow(row.key, { refId: e.target.value })}
                        className="flex-1"
                        aria-label="Item"
                      >
                        {(row.kind === "procedure" ? procedures : packages).map((i) => (
                          <option key={i.id} value={i.id}>
                            {row.kind === "package" ? "📦 " : ""}
                            {i.name}
                          </option>
                        ))}
                      </Select>
                      <Input
                        type="number"
                        min={1}
                        max={50}
                        value={row.quantity}
                        onChange={(e) =>
                          updateRow(row.key, { quantity: Number(e.target.value) || 1 })
                        }
                        className="w-16"
                        aria-label="Quantidade"
                      />
                      <Input
                        inputMode="decimal"
                        value={row.unitPrice}
                        onChange={(e) => updateRow(row.key, { unitPrice: e.target.value })}
                        className="w-28"
                        aria-label="Preço unitário"
                      />
                      <button
                        type="button"
                        aria-label="Remover item"
                        className="text-stone-400 hover:text-red-500"
                        onClick={() => setRows((r) => r.filter((x) => x.key !== row.key))}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label htmlFor="q-discount" hint="opcional">Desconto (R$)</Label>
                <Input
                  id="q-discount"
                  inputMode="decimal"
                  value={discount}
                  onChange={(e) => setDiscount(e.target.value)}
                  placeholder="0,00"
                />
              </div>
              <div>
                <Label htmlFor="q-valid">Validade (dias)</Label>
                <Input id="q-valid" name="validDays" type="number" min={1} max={90} defaultValue={7} />
              </div>
              <div className="self-end rounded-lg bg-stone-50 px-3 py-2 text-right">
                <p className="text-xs text-stone-500">Total</p>
                <p className="text-sm font-semibold text-stone-800">
                  {total.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                </p>
              </div>
            </div>

            <div>
              <Label htmlFor="q-notes" hint="opcional">Observações</Label>
              <Input id="q-notes" name="notes" placeholder="Condições, formas de pagamento..." />
            </div>

            <FieldError message={error} />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={close}>
                Cancelar
              </Button>
              <Button type="submit" disabled={pending || !customer || rows.length === 0}>
                {pending ? "Enviando..." : "Criar e enviar"}
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </>
  );
}

export function QuoteRowActions({
  id,
  status,
  converted,
  quoteUrl,
}: {
  id: string;
  status: string;
  converted: boolean;
  quoteUrl: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string>();

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(undefined);
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) setError(result.error);
      router.refresh();
    });
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      {error ? <span className="text-xs text-red-600">{error}</span> : null}
      {status === "accepted" && !converted ? (
        <Button
          variant="secondary"
          disabled={pending}
          onClick={() => run(() => convertQuote({ id }))}
        >
          Converter em venda
        </Button>
      ) : null}
      {["sent", "viewed"].includes(status) ? (
        <>
          <button
            type="button"
            disabled={pending}
            className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-50"
            onClick={() => run(() => setQuoteStatus({ id, status: "accepted" }))}
          >
            Marcar aceito
          </button>
          <button
            type="button"
            disabled={pending}
            className="rounded-lg px-2.5 py-1.5 text-xs text-stone-500 hover:bg-stone-100"
            onClick={() => run(() => setQuoteStatus({ id, status: "rejected" }))}
          >
            Recusar
          </button>
        </>
      ) : null}
      <button
        type="button"
        className="rounded-lg px-2.5 py-1.5 text-xs text-stone-500 hover:bg-stone-100"
        onClick={() => {
          void navigator.clipboard.writeText(quoteUrl).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          });
        }}
      >
        {copied ? "Copiado!" : "Copiar link"}
      </button>
    </span>
  );
}
