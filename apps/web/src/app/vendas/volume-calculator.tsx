"use client";

import { useState } from "react";

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

/**
 * "A conta no seu volume": a clínica escolhe quantos atendimentos faz por mês
 * e vê o custo total do VesaliusX (mensalidade + IA + Meta estimados) contra
 * o que ela já perde com faltas e contra uma pessoa só para o WhatsApp.
 */
export function VolumeCalculator({ plans }: { plans: { name: string; monthlyBrl: number; apiAllowanceBrl: number }[] }) {
  const STEPS = [50, 100, 150, 250, 400, 600, 800];
  const [idx, setIdx] = useState(2);
  const [ticket, setTicket] = useState(250);
  const atendimentos = STEPS[idx]!;

  // Plano sugerido pelo volume (referência; o plano real é por profissionais e números)
  const plan = atendimentos <= 150 ? plans[0]! : atendimentos <= 450 ? plans[1]! : plans[2]!;
  // IA: ~2 conversas por atendimento (marcar + confirmar/dúvida), ~R$ 0,05 cada
  const ia = Math.round(atendimentos * 2 * 0.05);
  // Meta: lembrete da véspera é modelo pago (~R$ 0,04); reativação ~10% da base, marketing (~R$ 0,35)
  const meta = Math.round(atendimentos * 0.04 + atendimentos * 0.1 * 0.35);
  const api = ia + meta;
  const apiCobrado = Math.max(0, api - plan.apiAllowanceBrl);
  const total = plan.monthlyBrl + apiCobrado;

  // Faltas: 12% sem confirmação, caem para ~4% com confirmação de véspera
  const faltasHoje = Math.round(atendimentos * 0.12);
  const faltasDepois = Math.round(atendimentos * 0.04);
  const recuperado = (faltasHoje - faltasDepois) * ticket;

  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-6">
      <div className="grid gap-6 md:grid-cols-2">
        <label className="block">
          <span className="flex items-center justify-between text-sm text-stone-700">
            <span>Atendimentos por mês</span>
            <span className="font-semibold text-stone-900">{atendimentos}</span>
          </span>
          <input type="range" min={0} max={STEPS.length - 1} value={idx} onChange={(e) => setIdx(Number(e.target.value))} className="mt-2 w-full accent-teal-700" />
          <span className="mt-1 flex justify-between text-[10px] text-stone-400">{STEPS.map((s) => <span key={s}>{s}</span>)}</span>
        </label>
        <label className="block">
          <span className="flex items-center justify-between text-sm text-stone-700">
            <span>Valor médio de um atendimento</span>
            <span className="font-semibold text-stone-900">{brl(ticket)}</span>
          </span>
          <input type="range" min={80} max={1500} step={10} value={ticket} onChange={(e) => setTicket(Number(e.target.value))} className="mt-2 w-full accent-teal-700" />
        </label>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-stone-200 p-4">
          <p className="text-xs text-stone-500">Faltas sem confirmação (≈12%)</p>
          <p className="mt-1 text-2xl font-semibold text-red-600">{brl(faltasHoje * ticket)}</p>
          <p className="text-[11px] text-stone-400">{faltasHoje} horários vazios por mês</p>
        </div>
        <div className="rounded-xl border border-stone-200 p-4">
          <p className="text-xs text-stone-500">Uma pessoa só para o WhatsApp</p>
          <p className="mt-1 text-2xl font-semibold text-stone-800">R$ 2.500 a 3.500</p>
          <p className="text-[11px] text-stone-400">com encargos, em horário comercial</p>
        </div>
        <div className="rounded-xl border-2 border-teal-500 bg-teal-50 p-4">
          <p className="text-xs text-teal-800">VesaliusX {plan.name}, tudo incluído</p>
          <p className="mt-1 text-2xl font-semibold text-teal-900">{brl(total)}</p>
          <p className="text-[11px] text-teal-800">
            mensalidade {brl(plan.monthlyBrl)} · IA ≈ {brl(ia)} · Meta ≈ {brl(meta)}
            {apiCobrado === 0 ? " (dentro da franquia)" : ` (${brl(apiCobrado)} acima da franquia)`}
          </p>
        </div>
      </div>
      <p className="mt-4 text-center text-sm text-stone-700">
        Só com a confirmação de véspera, recuperando {faltasHoje - faltasDepois} faltas por mês: <strong className="text-emerald-700">{brl(recuperado)}</strong> de volta. Isso antes de contar quem a Ana atendeu às 22h.
      </p>
      <p className="mt-2 text-center text-[11px] text-stone-400">Estimativas: faltas de 12% para 4% com confirmação; IA a R$ 0,05 por conversa; Meta a R$ 0,04 por lembrete e R$ 0,35 por mensagem de reativação. Mensagens que a cliente inicia não custam nada.</p>
    </div>
  );
}
