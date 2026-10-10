"use client";

import { useId, useState } from "react";
import { FALTA_COM, FALTA_SEM, IA_POR_ATENDIMENTO, META_LEMBRETE, META_REATIVACAO, PARTE_REATIVADA, fmt2 } from "./premissas";

const brl = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 0, maximumFractionDigits: 0 });

interface PlanLite {
  name: string;
  monthlyBrl: number;
  apiAllowanceBrl: number;
}

const EQUIPES = ["1 ou 2", "3 a 6", "7 ou mais"];
const VOLUMES = [100, 200, 300, 500, 800];
const TICKETS = [150, 250, 400, 700];

const BTN_BASE =
  "rounded-full border py-2.5 text-[14px] font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0E6E6A] focus-visible:ring-offset-2";
const btn = (on: boolean) =>
  `${BTN_BASE} ${on ? "border-[#062B30] bg-[#062B30] text-white" : "border-[#E4DED3] bg-[#FAF9F6] text-[#14211F] hover:border-[#062B30]/40"}`;

export function VolumeCalculator({ plans, overageMarkup }: { plans: PlanLite[]; overageMarkup: number }) {
  const id = useId();
  const [equipe, setEquipe] = useState(0);
  const [volume, setVolume] = useState(200);
  const [ticket, setTicket] = useState(250);

  // O plano sai pelo tamanho da equipe (é assim que os planos se diferenciam)
  const plan = plans[equipe]!;
  const faltas = volume * FALTA_SEM * ticket;
  const devolve = volume * (FALTA_SEM - FALTA_COM) * ticket;
  const ia = volume * IA_POR_ATENDIMENTO;
  const meta = volume * META_LEMBRETE + volume * PARTE_REATIVADA * META_REATIVACAO;
  const uso = ia + meta;
  const acima = Math.max(0, uso - plan.apiAllowanceBrl);
  const acrescimo = acima * overageMarkup;
  const total = plan.monthlyBrl + acima + acrescimo;
  const max = Math.max(3500, total) * 1.1;
  const w = (n: number) => `${Math.min(100, Math.max(4, Math.round((n / max) * 100)))}%`;

  return (
    <div className="rounded-3xl bg-white p-5 text-[#14211F] shadow-[0_30px_60px_-30px_rgba(0,0,0,0.5)] sm:p-7">
      <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-[#8A5A1E]">A conta no seu volume</p>
      <p className="mt-1 text-[14px] text-[#5F6B68]">Tamanho da equipe, atendimentos por mês e o valor médio de cada um.</p>

      <p id={`${id}-eq`} className="mt-5 text-[15px] font-semibold">Quantas profissionais atendem?</p>
      <div role="group" aria-labelledby={`${id}-eq`} className="mt-2 grid grid-cols-3 gap-2">
        {EQUIPES.map((e, i) => (
          <button key={e} type="button" onClick={() => setEquipe(i)} aria-pressed={equipe === i} className={btn(equipe === i)}>
            {e}
          </button>
        ))}
      </div>

      <p id={`${id}-vol`} className="mt-4 text-[15px] font-semibold">Quantos atendimentos por mês?</p>
      <div role="group" aria-labelledby={`${id}-vol`} className="mt-2 grid grid-cols-5 gap-1.5 sm:gap-2">
        {VOLUMES.map((v) => (
          <button key={v} type="button" onClick={() => setVolume(v)} aria-pressed={volume === v} className={btn(volume === v)}>
            {v}
          </button>
        ))}
      </div>

      <p id={`${id}-tk`} className="mt-4 text-[15px] font-semibold">Valor médio de um atendimento</p>
      <div role="group" aria-labelledby={`${id}-tk`} className="mt-2 grid grid-cols-4 gap-1.5 sm:gap-2">
        {TICKETS.map((t) => (
          <button key={t} type="button" onClick={() => setTicket(t)} aria-pressed={ticket === t} className={btn(ticket === t)}>
            {brl(t)}
          </button>
        ))}
      </div>

      <div className="mt-6 space-y-5">
        <Bar label="Faltas sem confirmação" value={brl(faltas)} width={w(faltas)} color="bg-[#C2412F]" tone="text-[#C2412F]" note={`cerca de ${Math.round(FALTA_SEM * 100)}% dos horários, cada um de ${brl(ticket)}`} />
        <Bar label="Uma pessoa só pro WhatsApp" value="R$ 2,5 a 3,5 mil" width={w(3000)} color="bg-[#8A5A1E]" tone="text-[#8A5A1E]" note="por mês, com encargos; não responde às 22h, no domingo nem no feriado" />
        <Bar label={`VesaliusX ${plan.name}`} value={brl(total)} width={w(total)} color="bg-[#0E6E6A]" tone="text-[#0E6E6A]" note="mensalidade + uso estimado · plano pelo tamanho da equipe" />
      </div>

      <div aria-live="polite" aria-atomic="true" className="mt-6 rounded-2xl bg-[#F3F0E8] p-4 sm:p-5">
        <p className="text-[14px] text-[#3D4A47]">O que a confirmação de véspera pode devolver por mês, sozinha</p>
        <p className="mt-1 font-[family-name:var(--font-v-titulo)] text-4xl font-black tracking-tight text-[#0E6E6A]">{brl(devolve)}</p>
        <div className="mt-4 space-y-1.5 border-t border-[#E4DED3] pt-3 text-[14px]">
          <Row k={`Mensalidade ${plan.name}`} v={brl(plan.monthlyBrl)} />
          <Row k="IA (estimativa)" v={brl(ia)} />
          <Row k="Mensagens oficiais da Meta (estimativa)" v={brl(meta)} />
          <Row k={`Franquia inclusa no ${plan.name}`} v={`− ${brl(Math.min(plan.apiAllowanceBrl, uso))}`} />
          {acima > 0 ? <Row k={`Acréscimo de ${Math.round(overageMarkup * 100)}% sobre o excedente`} v={brl(acrescimo)} /> : null}
        </div>
        <div className="mt-3 flex items-center justify-between gap-3 border-t border-[#E4DED3] pt-3">
          <p className="text-[14px] font-semibold">Seu custo estimado no mês</p>
          <p className="font-[family-name:var(--font-v-titulo)] text-2xl font-black">{brl(total)}</p>
        </div>
      </div>
      <p className="mt-3 text-[11.5px] leading-relaxed text-[#5F6B68]">
        Estimativas, não tabela. Faltas de {Math.round(FALTA_SEM * 100)}% caindo para {Math.round(FALTA_COM * 100)}% com lembrete de véspera e remarcação pelo WhatsApp. IA: cerca de R$ {fmt2(IA_POR_ATENDIMENTO)} por atendimento. Meta: cerca de R$ {fmt2(META_LEMBRETE)} por lembrete e R$ {fmt2(META_REATIVACAO)} por mensagem de reativação; mensagem que a cliente manda, e a resposta em até 24 h, não custam nada. Uso acima da franquia entra na mensalidade seguinte com {Math.round(overageMarkup * 100)}% de acréscimo, só se você liberar; sem liberar, a Ana e os lembretes pausam até o mês seguinte.
      </p>
    </div>
  );
}

function Bar({ label, value, width, color, tone, note }: { label: string; value: string; width: string; color: string; tone: string; note: string }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <p className="min-w-0 text-[14px] font-semibold sm:text-[15px]">{label}</p>
        <p className={`shrink-0 whitespace-nowrap font-[family-name:var(--font-v-titulo)] text-[17px] font-black sm:text-lg ${tone}`}>{value}</p>
      </div>
      <div className="mt-1.5 h-2.5 w-full overflow-hidden rounded-full bg-[#F3F0E8]">
        <div className={`h-full rounded-full ${color} transition-[width] duration-500`} style={{ width }} />
      </div>
      <p className="mt-1 text-[12px] text-[#5F6B68]">{note}</p>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <p className="flex items-center justify-between gap-3">
      <span className="text-[#3D4A47]">{k}</span>
      <span className="font-semibold tabular-nums">{v}</span>
    </p>
  );
}
