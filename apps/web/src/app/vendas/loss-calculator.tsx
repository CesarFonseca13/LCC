"use client";

import { useState } from "react";

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

/** Quanto a clínica deixa na mesa por mês com faltas e mensagens sem resposta. */
export function LossCalculator({ planBrl }: { planBrl: number }) {
  const [faltas, setFaltas] = useState(6);
  const [semResposta, setSemResposta] = useState(4);
  const [ticket, setTicket] = useState(250);
  const perdido = (faltas + semResposta) * ticket;
  const recuperado = Math.round(perdido * 0.6);
  const saldo = recuperado - planBrl;

  return (
    <div className="grid gap-6 rounded-2xl border border-stone-200 bg-white p-6 md:grid-cols-[1fr_1fr]">
      <div className="space-y-5">
        <Field label="Faltas por mês" value={faltas} min={0} max={40} onChange={setFaltas} suffix="faltas" />
        <Field label="Mensagens que ficaram sem resposta a tempo, por mês" value={semResposta} min={0} max={40} onChange={setSemResposta} suffix="clientes" />
        <Field label="Valor médio de um procedimento" value={ticket} min={50} max={2000} step={10} onChange={setTicket} prefix="R$" />
      </div>
      <div className="flex flex-col justify-center rounded-xl bg-stone-50 p-5">
        <p className="text-xs uppercase tracking-wide text-stone-500">Você deixa na mesa, por mês</p>
        <p className="mt-1 text-4xl font-semibold text-red-600">{brl(perdido)}</p>
        <p className="mt-4 text-xs uppercase tracking-wide text-stone-500">Com confirmação, resposta em segundos e reativação, recuperando 60%</p>
        <p className="mt-1 text-3xl font-semibold text-emerald-700">{brl(recuperado)}</p>
        <p className="mt-4 text-sm text-stone-600">
          Menos o plano de {brl(planBrl)}:{" "}
          <strong className={saldo >= 0 ? "text-emerald-700" : "text-stone-800"}>{saldo >= 0 ? `+${brl(saldo)} no seu bolso` : `${brl(saldo)}`}</strong>
        </p>
        <p className="mt-2 text-[11px] text-stone-400">Estimativa com os seus números; a taxa de 60% é conservadora para quem confirma véspera e responde na hora.</p>
      </div>
    </div>
  );
}

function Field({ label, value, min, max, step = 1, onChange, prefix, suffix }: { label: string; value: number; min: number; max: number; step?: number; onChange: (n: number) => void; prefix?: string; suffix?: string }) {
  return (
    <label className="block">
      <span className="flex items-center justify-between text-sm text-stone-700">
        <span>{label}</span>
        <span className="font-semibold text-stone-900">{prefix ? `${prefix} ` : ""}{value}{suffix ? ` ${suffix}` : ""}</span>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="mt-2 w-full accent-teal-700" />
    </label>
  );
}
