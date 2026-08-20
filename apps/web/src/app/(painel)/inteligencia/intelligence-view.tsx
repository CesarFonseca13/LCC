"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { formatBRL } from "@/lib/format";
import { PrepareMessageButton } from "@/components/prepare-message-button";
import { refreshScores } from "./actions";

export interface ScoreRow {
  customerId: string;
  name: string;
  score: number;
  recency: number;
  frequency: number;
  value: number;
  engagement: number;
  classification: "quente" | "morno" | "frio";
  suggestedKind: string;
  suggestedAction: string | null;
  metrics: {
    daysSinceVisit: number | null;
    visits12m: number;
    value12m: number | null;
    valuePercentile: number | null;
    showed: number;
    noShow: number;
    showRate: number | null;
    lastInboundDaysAgo: number | null;
    favoriteProcedure: string | null;
    blocked: boolean;
  };
}

const CLASS_STYLE: Record<string, string> = {
  quente: "bg-orange-100 text-orange-700",
  morno: "bg-amber-100 text-amber-700",
  frio: "bg-sky-100 text-sky-700",
};
const CLASS_LABEL: Record<string, string> = {
  quente: "🔥 Quente",
  morno: "🌤 Morna",
  frio: "❄️ Fria",
};

function phrases(r: ScoreRow): { label: string; score: number; phrase: string }[] {
  const m = r.metrics;
  return [
    {
      label: "Recência",
      score: r.recency,
      phrase:
        m.daysSinceVisit === null
          ? "Ainda não veio à clínica"
          : m.daysSinceVisit === 0
            ? "Esteve na clínica hoje"
            : `Última visita há ${m.daysSinceVisit} dia${m.daysSinceVisit === 1 ? "" : "s"}`,
    },
    {
      label: "Frequência",
      score: r.frequency,
      phrase: `${m.visits12m} visita${m.visits12m === 1 ? "" : "s"} nos últimos 12 meses`,
    },
    {
      label: "Valor",
      score: r.value,
      phrase:
        m.value12m === null
          ? "Nota pela posição de investimento na clínica"
          : m.value12m > 0
            ? `${formatBRL(String(m.value12m))} nos últimos 12 meses${
                m.valuePercentile !== null && m.valuePercentile >= 70
                  ? " — entre as que mais investem"
                  : ""
              }`
            : "Sem gastos registrados no período",
    },
    {
      label: "Engajamento",
      score: r.engagement,
      phrase: [
        m.showRate !== null
          ? `Compareceu a ${Math.round(m.showRate * 100)}% dos agendamentos`
          : "Ainda sem histórico de presença",
        m.lastInboundDaysAgo !== null
          ? m.lastInboundDaysAgo === 0
            ? "respondeu no WhatsApp hoje"
            : `respondeu no WhatsApp há ${m.lastInboundDaysAgo} dia${m.lastInboundDaysAgo === 1 ? "" : "s"}`
          : null,
      ]
        .filter(Boolean)
        .join(" · "),
    },
  ];
}

export function IntelligenceView({
  rows,
  counts,
  total,
  lastComputedISO,
}: {
  rows: ScoreRow[];
  counts: { quente: number; morno: number; frio: number };
  total: number;
  lastComputedISO: string | null;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawFilter = searchParams.get("f");
  const filter = ["quente", "morno", "frio"].includes(rawFilter ?? "") ? rawFilter : null;
  const [expanded, setExpanded] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();

  const visible = filter ? rows.filter((r) => r.classification === filter) : rows;

  const agoLabel = (() => {
    if (!lastComputedISO) return null;
    const mins = Math.max(0, Math.round((Date.now() - Date.parse(lastComputedISO)) / 60_000));
    if (mins < 1) return "agora mesmo";
    if (mins < 60) return `há ${mins} min`;
    const hours = Math.round(mins / 60);
    if (hours < 48) return `há ${hours} h`;
    return `há ${Math.round(hours / 24)} dias`;
  })();

  const chips: { key: string | null; label: string; count: number }[] = [
    { key: null, label: "Todas", count: total },
    { key: "quente", label: "🔥 Quentes", count: counts.quente },
    { key: "morno", label: "🌤 Mornas", count: counts.morno },
    { key: "frio", label: "❄️ Frias", count: counts.frio },
  ];

  return (
    <div className="mt-6 max-w-4xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
          {chips.map((chip) => {
            const active = filter === chip.key || (!filter && chip.key === null);
            return (
              <Link
                key={chip.label}
                href={chip.key ? `/inteligencia?f=${chip.key}` : "/inteligencia"}
                className={
                  active
                    ? "rounded-full bg-teal-700 px-3.5 py-1.5 text-xs font-medium text-white"
                    : "rounded-full border border-stone-300 bg-white px-3.5 py-1.5 text-xs font-medium text-stone-600 hover:bg-stone-50"
                }
              >
                {chip.label} · {chip.count}
              </Link>
            );
          })}
        </div>
        <div className="flex items-center gap-3">
          {agoLabel ? (
            <span className="text-xs text-stone-400">Atualizado {agoLabel}</span>
          ) : null}
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              setError(undefined);
              startTransition(async () => {
                const result = await refreshScores({});
                if (result.ok) router.refresh();
                else setError(result.error);
              });
            }}
            className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-xs font-medium text-stone-700 transition hover:bg-stone-50 disabled:opacity-60"
          >
            {pending ? "Analisando..." : "Atualizar análise"}
          </button>
        </div>
      </div>
      {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
      {total > rows.length ? (
        <p className="mt-2 text-xs text-stone-400">
          Mostrando as {rows.length} clientes com maior nota (de {total}).
        </p>
      ) : null}

      <div className="mt-4 space-y-2">
        {visible.map((r) => {
          const open = expanded === r.customerId;
          return (
            <div
              key={r.customerId}
              className="rounded-xl border border-stone-200 bg-white transition"
            >
              <button
                type="button"
                onClick={() => setExpanded(open ? null : r.customerId)}
                className="flex w-full items-center gap-4 px-4 py-3 text-left"
              >
                <span
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold ${CLASS_STYLE[r.classification]}`}
                >
                  {r.score}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-sm font-semibold text-stone-800">
                      {r.name}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${CLASS_STYLE[r.classification]}`}
                    >
                      {CLASS_LABEL[r.classification]}
                    </span>
                  </span>
                  {r.suggestedAction ? (
                    <span className="mt-0.5 block truncate text-xs text-stone-500">
                      {r.suggestedAction}
                    </span>
                  ) : null}
                </span>
                <span className="flex shrink-0 gap-1" aria-hidden>
                  {[r.recency, r.frequency, r.value, r.engagement].map((s, i) => (
                    <span key={i} className="flex h-8 w-1.5 items-end rounded-full bg-stone-100">
                      <span
                        className="w-full rounded-full bg-teal-500"
                        style={{ height: `${Math.max(8, (s / 25) * 100)}%` }}
                      />
                    </span>
                  ))}
                </span>
                <span className="text-stone-300">{open ? "▴" : "▾"}</span>
              </button>

              {open ? (
                <div className="border-t border-stone-100 px-4 py-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    {phrases(r).map((p) => (
                      <div key={p.label}>
                        <div className="flex items-baseline justify-between">
                          <span className="text-xs font-medium text-stone-600">{p.label}</span>
                          <span className="text-xs tabular-nums text-stone-400">
                            {p.score}/25
                          </span>
                        </div>
                        <div className="mt-1 h-2 rounded-full bg-stone-100">
                          <div
                            className="h-2 rounded-full bg-teal-500"
                            style={{ width: `${(p.score / 25) * 100}%` }}
                          />
                        </div>
                        <p className="mt-1 text-xs text-stone-500">{p.phrase}</p>
                      </div>
                    ))}
                  </div>
                  <div className="mt-4 flex items-center justify-between gap-3 rounded-lg bg-stone-50 px-3 py-2.5">
                    <p className="text-sm text-stone-700">
                      <span className="font-medium">Ação sugerida:</span>{" "}
                      {r.suggestedAction ?? "nenhuma por agora."}
                    </p>
                    {r.suggestedKind !== "none" && !r.metrics.blocked ? (
                      <PrepareMessageButton customerId={r.customerId} />
                    ) : null}
                  </div>
                  <div className="mt-2 text-right">
                    <Link
                      href={`/clientes/${r.customerId}`}
                      className="text-xs text-teal-700 underline-offset-2 hover:underline"
                    >
                      abrir ficha completa →
                    </Link>
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
