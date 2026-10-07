"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { formatBrl } from "@clinicaos/core/spend";
import { Button, FieldError, Input, Label } from "@/components/ui";
import { saveSpendSettings } from "./actions";

export interface SpendMonthRow {
  /** "2026-10" */
  month: string;
  aiBrl: number;
  metaBrl: number;
  aiCalls: number;
  metaMessages: number;
}

export interface SpendView {
  currentMonth: string;
  current: SpendMonthRow;
  history: SpendMonthRow[];
  monthlyLimitBrl: number;
  allowOverage: boolean;
  usdBrlRate: number;
  metaPrices: { utility: number; marketing: number; authentication: number };
}

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
function monthLabel(month: string): string {
  const [y, m] = month.split("-");
  return `${MONTHS[Number(m) - 1] ?? m}/${y?.slice(2)}`;
}

export function SpendCard({ view }: { view: SpendView }) {
  const router = useRouter();
  const [limit, setLimit] = useState(String(view.monthlyLimitBrl).replace(".", ","));
  const [allowOverage, setAllowOverage] = useState(view.allowOverage);
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const total = view.current.aiBrl + view.current.metaBrl;
  const ratio = view.monthlyLimitBrl > 0 ? total / view.monthlyLimitBrl : 0;
  const overLimit = total >= view.monthlyLimitBrl;
  const blocked = overLimit && !view.allowOverage;
  const overage = overLimit ? total - view.monthlyLimitBrl : 0;
  const barColor = ratio >= 1 ? "bg-red-500" : ratio >= 0.8 ? "bg-amber-500" : "bg-teal-600";

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(undefined);
    setSaved(false);
    const n = Number(limit.replace(/\./g, "").replace(",", "."));
    if (!Number.isFinite(n)) {
      setError("Informe o limite em reais, ex.: 300");
      return;
    }
    startTransition(async () => {
      const result = await saveSpendSettings({ monthlyLimitBrl: n, allowOverage });
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
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-stone-700">Gastos com API</h2>
          <p className="mt-0.5 text-xs text-stone-500">
            O que a assistente (modelos de IA) e os modelos de mensagem da Meta custaram neste mês.
            Mensagens pela conexão por QR code e respostas dentro da janela de 24h não custam nada.
          </p>
        </div>
        {blocked ? (
          <span className="shrink-0 rounded-full bg-red-100 px-2.5 py-1 text-[11px] font-medium text-red-700">
            Limite atingido — pausado
          </span>
        ) : overLimit ? (
          <span className="shrink-0 rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-medium text-amber-800">
            Acima do limite
          </span>
        ) : null}
      </div>

      {/* Mês atual */}
      <div className="mt-4 grid grid-cols-3 gap-3">
        <Stat label="Assistente (IA)" value={formatBrl(view.current.aiBrl)} hint={`${view.current.aiCalls} chamadas`} />
        <Stat
          label="WhatsApp (Meta)"
          value={formatBrl(view.current.metaBrl)}
          hint={`${view.current.metaMessages} modelos enviados`}
        />
        <Stat label={`Total em ${monthLabel(view.currentMonth)}`} value={formatBrl(total)} strong />
      </div>

      <div className="mt-3">
        <div className="flex items-center justify-between text-[11px] text-stone-500">
          <span>{Math.min(100, Math.round(ratio * 100))}% do limite de {formatBrl(view.monthlyLimitBrl)}</span>
          {overage > 0 ? (
            <span className={view.allowOverage ? "text-amber-700" : "text-red-700"}>
              Excedente: {formatBrl(overage)}
              {view.allowOverage ? " · entra na próxima mensalidade" : ""}
            </span>
          ) : null}
        </div>
        <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-stone-100">
          <div className={`h-full ${barColor}`} style={{ width: `${Math.min(100, ratio * 100)}%` }} />
        </div>
      </div>

      {blocked ? (
        <p className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">
          A assistente e os modelos pagos da Meta estão pausados até o próximo mês. Para voltar agora,
          aumente o limite ou ligue &quot;permitir ultrapassar&quot; abaixo. Conversas dentro da janela de
          24h e a conexão por QR code continuam normais.
        </p>
      ) : null}

      {/* Configuração */}
      <form onSubmit={submit} className="mt-5 space-y-4 border-t border-stone-100 pt-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="spend-limit">Limite mensal (R$)</Label>
            <Input
              id="spend-limit"
              inputMode="decimal"
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
              placeholder="300"
            />
            <p className="mt-1 text-[11px] text-stone-400">
              Ao chegar em 80% e em 100% a clínica recebe um aviso no painel.
            </p>
          </div>
          <div>
            <Label htmlFor="spend-overage">Ao passar do limite</Label>
            <button
              id="spend-overage"
              type="button"
              role="switch"
              aria-checked={allowOverage}
              onClick={() => setAllowOverage((v) => !v)}
              className="mt-1 flex w-full items-center gap-3 rounded-lg border border-stone-200 p-3 text-left hover:bg-stone-50"
            >
              <span
                className={`relative h-6 w-11 shrink-0 rounded-full transition ${allowOverage ? "bg-teal-600" : "bg-stone-300"}`}
              >
                <span
                  className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${allowOverage ? "left-[22px]" : "left-0.5"}`}
                />
              </span>
              <span className="text-xs text-stone-600">
                {allowOverage ? (
                  <>
                    <strong className="text-stone-800">Permitir ultrapassar.</strong> Tudo continua funcionando e o
                    excedente é cobrado na próxima mensalidade da plataforma.
                  </>
                ) : (
                  <>
                    <strong className="text-stone-800">Pausar o que custa dinheiro.</strong> A assistente e os
                    modelos da Meta param até o próximo mês. Nada é cobrado a mais.
                  </>
                )}
              </span>
            </button>
          </div>
        </div>
        <FieldError message={error} />
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={pending}>
            {pending ? "Salvando..." : "Salvar"}
          </Button>
          {saved ? <span className="text-xs text-emerald-700">Salvo.</span> : null}
        </div>
      </form>

      {/* Histórico */}
      {view.history.length > 0 ? (
        <div className="mt-5 border-t border-stone-100 pt-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-stone-500">Meses anteriores</h3>
          <table className="mt-2 w-full text-xs">
            <thead className="text-stone-400">
              <tr>
                <th className="py-1 text-left font-medium">Mês</th>
                <th className="py-1 text-right font-medium">IA</th>
                <th className="py-1 text-right font-medium">Meta</th>
                <th className="py-1 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody className="text-stone-700">
              {view.history.map((row) => (
                <tr key={row.month} className="border-t border-stone-100">
                  <td className="py-1.5">{monthLabel(row.month)}</td>
                  <td className="py-1.5 text-right">{formatBrl(row.aiBrl)}</td>
                  <td className="py-1.5 text-right">{formatBrl(row.metaBrl)}</td>
                  <td className="py-1.5 text-right font-medium">{formatBrl(row.aiBrl + row.metaBrl)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <p className="mt-4 text-[11px] leading-relaxed text-stone-400">
        Valores estimados no momento do uso: tokens × preço do modelo convertidos a US$ {view.usdBrlRate.toFixed(2)},
        e modelos da Meta por categoria (utilidade {formatBrl(view.metaPrices.utility)}, marketing{" "}
        {formatBrl(view.metaPrices.marketing)}, autenticação {formatBrl(view.metaPrices.authentication)} por
        mensagem). A fatura real dos provedores pode variar alguns centavos.
      </p>
    </section>
  );
}

function Stat({ label, value, hint, strong }: { label: string; value: string; hint?: string; strong?: boolean }) {
  return (
    <div className={`rounded-lg p-3 ${strong ? "bg-teal-50" : "bg-stone-50"}`}>
      <p className="text-[11px] text-stone-500">{label}</p>
      <p className={`mt-0.5 text-base font-semibold ${strong ? "text-teal-800" : "text-stone-800"}`}>{value}</p>
      {hint ? <p className="text-[11px] text-stone-400">{hint}</p> : null}
    </div>
  );
}
