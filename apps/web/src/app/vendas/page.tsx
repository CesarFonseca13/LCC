import type { Metadata } from "next";
import Link from "next/link";
import { COMMERCIAL_RULES, PLANS, SETUP_FEE, annualUpfrontTotal, semiannualUpfrontTotal } from "@clinicaos/core/plans";
import { Logo, Mascot } from "./brand";
import { StickyCta } from "./sticky-cta";
import { VolumeCalculator } from "./volume-calculator";

export const metadata: Metadata = {
  title: "VesaliusX — o WhatsApp da sua clínica atende sozinho, 24 horas",
  description:
    "A Ana responde, agenda, confirma a véspera e traz de volta quem sumiu, no WhatsApp da clínica. Agenda, termos assinados, financeiro e estoque numa conta só. A partir de R$ 297/mês.",
};

const WHATSAPP_NUMBER = process.env.SALES_WHATSAPP ?? "5561996862249";
const WHATSAPP_DISPLAY = process.env.SALES_WHATSAPP_DISPLAY ?? "(61) 99686-2249";
const CTA = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent("Oi! Vi a página do VesaliusX e quero a Ana na minha clínica.")}`;
const VSL_URL = process.env.SALES_VSL_URL ?? "";
const BTN = "Quero na minha clínica";

const money = (n: number) => `R$ ${n.toLocaleString("pt-BR")}`;
const inicial = PLANS[0]!;
const lead = PLANS.find((p) => p.highlight) ?? PLANS[1]!;

type Line = { from: "c" | "a" | "sys"; text: string; time?: string };

function Chat({ title, lines, footer }: { title: string; lines: Line[]; footer?: string }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-lg shadow-stone-900/5">
      <div className="flex items-center gap-3 bg-[#075e54] px-4 py-3 text-white">
        <div className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full bg-white/20 text-sm font-semibold">
          <Mascot className="h-9 w-9 object-cover" />
        </div>
        <div className="leading-tight">
          <p className="text-sm font-semibold">{title}</p>
          <p className="text-[11px] text-white/80">online</p>
        </div>
      </div>
      <div className="space-y-2 bg-[#e5ddd5] p-3">
        {lines.map((l, i) =>
          l.from === "sys" ? (
            <p key={i} className="mx-auto w-fit rounded-md bg-[#fdf4c5] px-2 py-1 text-center text-[11px] text-stone-700 shadow-sm">{l.text}</p>
          ) : (
            <div key={i} className={`flex ${l.from === "a" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[85%] rounded-lg px-3 py-1.5 shadow-sm ${l.from === "a" ? "bg-[#d9fdd3]" : "bg-white"}`}>
                <p className="text-[13px] leading-snug text-stone-800">{l.text}</p>
                {l.time ? <p className="mt-0.5 text-right text-[10px] text-stone-400">{l.time}</p> : null}
              </div>
            </div>
          ),
        )}
      </div>
      {footer ? <p className="bg-white px-4 py-2 text-center text-[11px] text-stone-400">{footer}</p> : null}
    </div>
  );
}

function CtaButton({ label = BTN, big = false }: { label?: string; big?: boolean }) {
  return (
    <a
      href={CTA}
      target="_blank"
      rel="noreferrer"
      className={`inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-400 font-semibold text-teal-950 shadow-lg shadow-emerald-400/30 transition hover:bg-emerald-300 ${big ? "px-10 py-5 text-lg" : "px-7 py-3.5 text-base"}`}
    >
      <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current" aria-hidden><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.6.8-.8 1-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.3-.4.7-1.3.1-.2 0-.3 0-.5l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.8 12 12 0 0 0 4.6 4 5.3 5.3 0 0 0 3.2.5 2.7 2.7 0 0 0 1.8-1.3 2.2 2.2 0 0 0 .2-1.3c-.1-.1-.3-.2-.5-.3z" /></svg>
      {label}
    </a>
  );
}

export default function VendasPage() {
  return (
    <main className="bg-teal-950 text-white">
      {/* ── Cabeçalho ──────────────────────────────────────────── */}
      <header className="relative z-20 border-b border-white/10">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-6 py-4">
          <div className="flex items-center gap-3">
            <Logo />
            <span className="hidden rounded-full border border-white/15 px-2.5 py-1 text-[11px] text-teal-100/70 sm:inline">Clínicas de estética e saúde</span>
          </div>
          <a href={CTA} target="_blank" rel="noreferrer" className="rounded-xl bg-emerald-400 px-4 py-2 text-sm font-semibold text-teal-950 hover:bg-emerald-300">
            {BTN}
          </a>
        </div>
      </header>

      {/* ── Hero ───────────────────────────────────────────────── */}
      <section className="relative overflow-hidden">
        <div className="fx-blob left-[-12%] top-[-18%] h-[36rem] w-[36rem] bg-teal-500/30" />
        <div className="fx-blob right-[-10%] top-[20%] h-[30rem] w-[30rem] bg-emerald-400/20" style={{ animationDelay: "-7s" }} />
        <div className="absolute inset-0 fx-grid opacity-50" />
        <div className="relative z-10 mx-auto grid max-w-6xl items-center gap-10 px-6 pb-20 pt-12 lg:grid-cols-[1.1fr_0.9fr] lg:pt-16">
          <div>
            <h1 className="text-4xl font-semibold leading-[1.1] tracking-tight sm:text-6xl">
              O WhatsApp da sua clínica <span className="fx-shine-text">atende sozinho.</span>
              <br />24 horas. <span className="text-emerald-300">Sem perder cliente.</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-teal-100/85">
              A Ana responde em segundos, marca na agenda de verdade, confirma a véspera e traz de volta quem sumiu. No número que a clínica já usa, e o app continua no celular.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-4">
              <CtaButton />
              <div className="text-sm text-teal-100/80">
                <p><strong className="text-xl text-white">{money(inicial.monthlyBrl)}</strong>/mês no plano inicial + custos de API</p>
                <p className="text-xs text-teal-200/60">Garantia de {COMMERCIAL_RULES.guaranteeDays} dias · sem fidelidade no mensal</p>
              </div>
            </div>
            <div className="mt-8 grid max-w-md grid-cols-3 gap-3 text-center">
              {[["4 s", "para responder, às 22h ou no feriado"], ["1 falta", "evitada por mês já paga o plano"], ["0", "para a cliente instalar"]].map(([n, l]) => (
                <div key={n} className="rounded-xl border border-white/10 bg-white/5 p-3">
                  <p className="text-xl font-semibold text-emerald-300">{n}</p>
                  <p className="mt-0.5 text-[11px] leading-snug text-teal-100/70">{l}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="relative mx-auto w-full max-w-sm">
            <Mascot className="mx-auto w-64 drop-shadow-[0_20px_40px_rgba(0,0,0,0.45)] sm:w-72" />
            <div className="relative -mt-6 rounded-2xl bg-white p-4 text-stone-800 shadow-2xl">
              <span className="absolute -top-2 left-10 h-4 w-4 rotate-45 bg-white" />
              <p className="text-sm">Oi! Aqui é a Ana, da clínica 😊 Quer marcar um horário ou tirar uma dúvida? Pode falar que eu resolvo.</p>
              <p className="mt-1 text-right text-[10px] text-stone-400">22:47 ✓✓</p>
            </div>
          </div>
        </div>
        {VSL_URL ? (
          <div className="relative z-10 mx-auto -mt-6 mb-16 aspect-video w-full max-w-3xl overflow-hidden rounded-2xl border border-white/10 bg-black px-0 shadow-2xl">
            <iframe src={VSL_URL} title="VesaliusX" className="h-full w-full" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen />
          </div>
        ) : null}
        <p className="relative z-10 pb-8 text-center text-xs text-teal-200/60">Role e veja a Ana trabalhando ↓</p>
      </section>

      {/* ── Problema: linha do tempo ───────────────────────────── */}
      <section className="bg-white py-20 text-stone-800">
        <div className="mx-auto max-w-3xl px-6">
          <p className="text-xs font-semibold uppercase tracking-widest text-teal-600">Sábado, 10h. Agenda cheia.</p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-stone-900 sm:text-4xl">A recepção está com uma cliente na frente. O celular vibra. E vibra de novo.</h2>
          <ol className="mt-8 space-y-4">
            {[
              ["10:02", "Uma cliente nova escreve “oi, vocês fazem limpeza de pele? quanto é?”. Ninguém vê."],
              ["10:20", "Outra manda “preciso remarcar a de hoje”. A agenda segue com o horário ocupado."],
              ["10:41", "A primeira cliente já marcou na clínica do outro lado da rua. Ela não reclamou. Só não voltou."],
            ].map(([t, d]) => (
              <li key={t} className="flex gap-4 rounded-xl border border-stone-200 bg-stone-50 p-4">
                <span className="shrink-0 font-mono text-sm font-semibold text-teal-700">{t}</span>
                <span className="text-stone-700">{d}</span>
              </li>
            ))}
          </ol>
          <p className="mt-8 text-xl font-medium text-stone-900">A cliente que fica sem resposta não reclama. Ela só não volta.</p>
          <p className="mt-2 text-stone-500">Agora imagine o mesmo sábado, com a Ana respondendo por você.</p>
        </div>
      </section>

      {/* ── Demonstração 1 ─────────────────────────────────────── */}
      <section className="bg-stone-50 py-20 text-stone-800">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-6 lg:grid-cols-2">
          <Chat
            title="Clínica Bella · Ana"
            lines={[
              { from: "c", text: "Oi, vocês fazem limpeza de pele? Quanto fica?", time: "10:02" },
              { from: "a", text: "Oi, Carla! Fazemos sim 😊 A limpeza de pele é a partir de R$ 180 e dura uns 60 min. Quer que eu veja um horário pra você?", time: "10:02" },
              { from: "c", text: "Quero! Pode ser quinta de tarde?", time: "10:03" },
              { from: "a", text: "Tenho quinta às 14h ou às 16h30 com a Dra. Paula. Qual prefere?", time: "10:03" },
              { from: "c", text: "16h30", time: "10:04" },
              { from: "a", text: "Marcado: quinta, 16h30, limpeza de pele com a Dra. Paula ✨ Te mando um lembrete na véspera. Qualquer coisa é só chamar!", time: "10:04" },
              { from: "sys", text: "Agendamento criado na agenda da clínica" },
            ]}
            footer="Nomes e valores de exemplo. O formato é real."
          />
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-teal-600">Demonstração 1</p>
            <h3 className="mt-2 text-2xl font-semibold text-stone-900">Dúvida de preço virou horário marcado. Em dois minutos, sem ninguém da equipe.</h3>
            <p className="mt-3 text-stone-600">A Ana consulta o catálogo e a agenda de verdade: só oferece horário livre, com a profissional que faz aquele procedimento, e grava direto na agenda. Nada de “vou verificar e te retorno”.</p>
            <ul className="mt-5 grid gap-2 text-sm text-stone-700 sm:grid-cols-2">
              {["Preço e duração do seu catálogo", "Horário livre de verdade, por profissional", "Lembrete automático na véspera", "Sem “digite 1 para agendar”"].map((t) => (
                <li key={t} className="rounded-lg border border-stone-200 bg-white px-3 py-2">✓ {t}</li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ── Demonstração 2 ─────────────────────────────────────── */}
      <section className="bg-white py-20 text-stone-800">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-6 lg:grid-cols-2">
          <div className="order-2 lg:order-1">
            <p className="text-xs font-semibold uppercase tracking-widest text-teal-600">Demonstração 2</p>
            <h3 className="mt-2 text-2xl font-semibold text-stone-900">A falta que não aconteceu.</h3>
            <p className="mt-3 text-stone-600">Na véspera, a Ana confirma todo mundo. Quem não pode, remarca na hora; o horário volta para a agenda e a clínica oferece a vaga para quem está na fila. A recepção não liga para ninguém.</p>
            <ul className="mt-5 grid gap-2 text-sm text-stone-700 sm:grid-cols-2">
              {["Confirmação da véspera, automática", "Remarca sem passar pela recepção", "Horário liberado na hora", "Cuidados pré-procedimento enviados junto"].map((t) => (
                <li key={t} className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2">✓ {t}</li>
              ))}
            </ul>
            <div className="mt-6"><CtaButton label="Quero isso na minha agenda" /></div>
          </div>
          <div className="order-1 lg:order-2">
            <Chat
              title="Clínica Bella · Ana"
              lines={[
                { from: "a", text: "Oi, Carla! Passando pra confirmar sua limpeza de pele amanhã às 16h30 com a Dra. Paula. Posso contar com você? 💛", time: "10:00" },
                { from: "c", text: "Ai, amanhã não vou conseguir 😢", time: "10:12" },
                { from: "a", text: "Sem problema! Quer remarcar? Tenho sábado às 9h ou terça às 15h.", time: "10:12" },
                { from: "c", text: "Sábado 9h", time: "10:13" },
                { from: "a", text: "Pronto, remarcado para sábado às 9h ✅ Lembrando: evite sol forte e esfoliação 24h antes. Até sábado!", time: "10:13" },
                { from: "sys", text: "Quinta 16h30 liberado · vaga oferecida à lista de espera" },
              ]}
            />
          </div>
        </div>
      </section>

      {/* ── Demonstração 3 ─────────────────────────────────────── */}
      <section className="bg-stone-50 py-20 text-stone-800">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-6 lg:grid-cols-2">
          <Chat
            title="Clínica Bella · Ana"
            lines={[
              { from: "a", text: "Oi, Carla! Já faz um tempinho desde a sua limpeza de pele. Que tal uma manutenção? Tenho quarta às 11h ou sexta às 17h 😊", time: "09:30" },
              { from: "c", text: "Nossa, nem vi o tempo passar! Sexta 17h", time: "11:48" },
              { from: "a", text: "Marcado! E se quiser aproveitar o mesmo dia, dá pra combinar com o peeling leve, que potencializa o resultado. Quer que eu reserve os dois?", time: "11:48" },
              { from: "c", text: "Quero sim!", time: "11:50" },
              { from: "a", text: "Perfeito: sexta às 17h, limpeza de pele + peeling leve com a Dra. Paula. Até lá! ✨", time: "11:50" },
            ]}
          />
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-teal-600">Demonstração 3</p>
            <h3 className="mt-2 text-2xl font-semibold text-stone-900">A cliente que tinha sumido. E saiu com dois procedimentos.</h3>
            <p className="mt-3 text-stone-600">Passou o prazo de retorno e ela não voltou: a Ana chama com carinho, no tom da clínica. E oferece só o complemento que você autorizou, com horário livre. Faturamento que estava parado, sem ninguém da equipe lembrar de nada.</p>
            <ul className="mt-5 grid gap-2 text-sm text-stone-700 sm:grid-cols-2">
              {["Reativação pelo prazo de cada procedimento", "Oferta só do que a clínica marcou", "Nunca sugere por aparência ou “necessidade”", "Reclamação ou dúvida de saúde vai para a equipe na hora"].map((t) => (
                <li key={t} className="rounded-lg border border-stone-200 bg-white px-3 py-2">✓ {t}</li>
              ))}
            </ul>
            <p className="mt-6 text-lg font-medium text-stone-900">Você estava atendendo. E não perdeu nenhuma das três.</p>
          </div>
        </div>
      </section>

      {/* ── O que muda no seu dia ──────────────────────────────── */}
      <section className="bg-white py-20 text-stone-800">
        <div className="mx-auto max-w-5xl px-6">
          <h2 className="text-center text-3xl font-semibold tracking-tight text-stone-900 sm:text-4xl">O que muda no seu dia</h2>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[
              ["Você para de perder cliente por demora", "Toda mensagem é respondida em segundos, de madrugada ou no feriado."],
              ["Você para de ligar para confirmar", "A Ana confirma a véspera, remarca quem não pode e libera o horário."],
              ["Você para de esquecer quem sumiu", "A reativação chama cada cliente no prazo certo do procedimento."],
              ["Você para de imprimir termo", "Consentimento assinado pelo celular, com hora, IP e validade jurídica."],
              ["Você para de fechar o mês na planilha", "Caixa, comissões e estoque baixam sozinhos a cada atendimento."],
              ["Você para de ser refém do celular", "A equipe atende pelo painel, e assume a conversa quando quiser."],
            ].map(([t, d]) => (
              <div key={t} className="rounded-2xl border border-stone-200 bg-stone-50 p-5">
                <p className="font-semibold text-stone-900">{t}</p>
                <p className="mt-1.5 text-sm text-stone-500">{d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── É pra você / não é ─────────────────────────────────── */}
      <section className="bg-stone-50 py-16 text-stone-800">
        <div className="mx-auto grid max-w-5xl gap-6 px-6 md:grid-cols-2">
          <div className="rounded-2xl border border-emerald-200 bg-white p-6">
            <h3 className="text-lg font-semibold text-emerald-800">É pra você se…</h3>
            <ul className="mt-3 space-y-2 text-sm text-stone-700">
              {["suas clientes marcam e tiram dúvida pelo WhatsApp", "você perde mensagem fora do horário ou responde tarde", "tem falta que ninguém confirmou", "quer trazer de volta quem sumiu sem lembrar de cada uma", "quer manter o número e o app no celular"].map((t) => (
                <li key={t} className="flex gap-2"><span className="text-emerald-600">✓</span>{t}</li>
              ))}
            </ul>
          </div>
          <div className="rounded-2xl border border-stone-200 bg-white p-6">
            <h3 className="text-lg font-semibold text-stone-700">Não é pra você se…</h3>
            <ul className="mt-3 space-y-2 text-sm text-stone-600">
              {["quer um robô de “digite 1 para agenda”", "quer disparar promoção em massa para lista comprada", "não atende pelo WhatsApp e não pretende atender"].map((t) => (
                <li key={t} className="flex gap-2"><span className="text-stone-400">✕</span>{t}</li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ── Como começa ────────────────────────────────────────── */}
      <section className="bg-white py-20 text-stone-800">
        <div className="mx-auto max-w-3xl px-6">
          <h2 className="text-3xl font-semibold tracking-tight text-stone-900 sm:text-4xl">Como começa. Sem trocar de número, sem app para a cliente.</h2>
          <ol className="mt-8 space-y-3">
            {[
              ["Conecta o WhatsApp", "Pela API oficial da Meta, com um clique em “Conectar com o Facebook”. O número continua no celular, no aplicativo de sempre."],
              ["Montamos a clínica", "Catálogo, equipe, horários, a base de conhecimento da Ana e a importação das suas clientes. Uma tarde com a dona."],
              ["Ligamos as automações", "Confirmação de véspera, lembretes, pós-atendimento, reativação. Você escolhe quais, com aprovação no começo."],
              ["A Ana começa a atender", "No mesmo dia. Você acompanha pelo painel e solta aos poucos, até confiar de olhos fechados."],
            ].map(([t, d], i) => (
              <li key={t} className="flex gap-4 rounded-xl border border-stone-200 bg-stone-50 p-4">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-teal-700 text-sm font-semibold text-white">{i + 1}</span>
                <div>
                  <p className="font-semibold text-stone-900">{t}</p>
                  <p className="mt-0.5 text-sm text-stone-500">{d}</p>
                </div>
              </li>
            ))}
          </ol>
          <p className="mt-4 text-sm text-stone-500">Nada para a cliente baixar. Ela continua no WhatsApp dela.</p>
        </div>
      </section>

      {/* ── A conta ────────────────────────────────────────────── */}
      <section className="bg-stone-50 py-20 text-stone-800">
        <div className="mx-auto max-w-5xl px-6">
          <h2 className="text-center text-3xl font-semibold tracking-tight text-stone-900 sm:text-4xl">A conta que ninguém faz na sua frente</h2>
          <p className="mx-auto mt-3 max-w-2xl text-center text-stone-500">Escolha o seu volume e veja o que a clínica perde hoje, o que custaria uma pessoa só para o WhatsApp, e o VesaliusX com tudo incluído.</p>
          <div className="mt-10">
            <VolumeCalculator plans={PLANS.map((p) => ({ name: p.name, monthlyBrl: p.monthlyBrl, apiAllowanceBrl: p.apiAllowanceBrl }))} />
          </div>
        </div>
      </section>

      {/* ── Preço ──────────────────────────────────────────────── */}
      <section id="planos" className="bg-white py-20 text-stone-800">
        <div className="mx-auto max-w-6xl px-6">
          <p className="text-center text-xs font-semibold uppercase tracking-widest text-teal-600">Preço, sem letra miúda</p>
          <h2 className="mt-3 text-center text-3xl font-semibold tracking-tight text-stone-900 sm:text-4xl">{money(inicial.monthlyBrl)} por mês. Sem fidelidade. Garantia de {COMMERCIAL_RULES.guaranteeDays} dias.</h2>
          <div className="mt-12 grid gap-6 lg:grid-cols-3">
            {PLANS.map((plan) => (
              <div key={plan.id} className={`relative flex flex-col rounded-2xl border bg-white p-7 ${plan.highlight ? "border-teal-500 shadow-xl shadow-teal-900/10" : "border-stone-200"}`}>
                {plan.highlight ? <span className="absolute -top-3 left-6 rounded-full bg-teal-600 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-white">Mais escolhido</span> : null}
                <h3 className="text-lg font-semibold text-stone-900">{plan.name}</h3>
                <p className="mt-1 text-sm text-stone-500">{plan.tagline}</p>
                <p className="mt-5"><span className="text-4xl font-semibold tracking-tight text-stone-900">{money(plan.monthlyBrl)}</span><span className="text-sm text-stone-500"> /mês</span></p>
                <p className="mt-1 text-xs text-stone-400">
                  {plan.whatsappNumbers === null ? "Números ilimitados" : `${plan.whatsappNumbers} número${plan.whatsappNumbers > 1 ? "s" : ""}`} · {plan.professionals === null ? "profissionais ilimitados" : `até ${plan.professionals} profissionais`}
                </p>
                <ul className="mt-6 space-y-2 text-sm text-stone-600">
                  {plan.features.map((f) => <li key={f} className="flex gap-2"><span className="text-teal-600">✓</span><span>{f}</span></li>)}
                </ul>
                <div className="mt-6 space-y-1 border-t border-stone-100 pt-4 text-xs text-stone-500">
                  <p>Semestral à vista (−{Math.round(COMMERCIAL_RULES.semiannualUpfrontDiscount * 100)}%): <strong className="text-stone-800">{money(semiannualUpfrontTotal(plan))}</strong></p>
                  <p>Anual à vista (−{Math.round(COMMERCIAL_RULES.annualUpfrontDiscount * 100)}%, implantação grátis): <strong className="text-stone-800">{money(annualUpfrontTotal(plan))}</strong></p>
                  <p>Inclui {money(plan.apiAllowanceBrl)}/mês de IA e mensagens oficiais.</p>
                </div>
                <a href={CTA} target="_blank" rel="noreferrer" className={`mt-6 block rounded-xl px-4 py-3 text-center text-sm font-semibold transition ${plan.highlight ? "bg-teal-700 text-white hover:bg-teal-800" : "border border-stone-300 text-stone-800 hover:bg-stone-50"}`}>
                  Quero o {plan.name}
                </a>
              </div>
            ))}
          </div>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            <div className="rounded-2xl border border-stone-200 bg-stone-50 p-5 text-sm text-stone-700">
              <p className="font-semibold text-stone-900">Implantação <span className="text-stone-400 line-through">{money(SETUP_FEE.listBrl)}</span> {money(SETUP_FEE.brl)}</p>
              <p className="mt-1 text-stone-500">Em até {SETUP_FEE.installments}×. Grátis no anual à vista. {SETUP_FEE.includes.join(", ")}.</p>
            </div>
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
              <p className="font-semibold">Entrada suave</p>
              <p className="mt-1">No {lead.name} anual, os {COMMERCIAL_RULES.rampMonths} primeiros meses saem por {money(COMMERCIAL_RULES.rampPriceBrl)}, enquanto a equipe se acostuma.</p>
            </div>
            <div className="rounded-2xl border border-stone-200 bg-stone-50 p-5 text-sm text-stone-700">
              <p className="font-semibold text-stone-900">O que fica por sua conta</p>
              <p className="mt-1 text-stone-500">IA e mensagens oficiais acima da franquia do plano, cobradas na mensalidade seguinte com 20%, só se você liberar. Mensagem que a cliente inicia não custa nada.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Garantia ───────────────────────────────────────────── */}
      <section className="bg-teal-800 py-14 text-white">
        <div className="mx-auto flex max-w-4xl flex-col items-center gap-6 px-6 text-center sm:flex-row sm:text-left">
          <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-full border-4 border-emerald-300/60 text-center text-xs font-semibold uppercase leading-tight text-emerald-200">{COMMERCIAL_RULES.guaranteeDays} dias<br />garantia</div>
          <div>
            <h2 className="text-2xl font-semibold">Use um mês inteiro. Não gostou? Devolvemos.</h2>
            <p className="mt-2 text-teal-100/85">No plano mensal, se em {COMMERCIAL_RULES.guaranteeDays} dias você não quiser continuar, a mensalidade volta. Sem perguntas. A implantação é trabalho feito e fica com você.</p>
          </div>
        </div>
      </section>

      {/* ── FAQ ────────────────────────────────────────────────── */}
      <section className="bg-white py-20 text-stone-800">
        <div className="mx-auto max-w-3xl px-6">
          <h2 className="text-center text-3xl font-semibold tracking-tight text-stone-900">Antes de decidir</h2>
          <div className="mt-8 divide-y divide-stone-200 rounded-2xl border border-stone-200">
            {[
              ["A cliente percebe que é uma assistente?", "Não. A Ana escreve como uma pessoa da equipe, no tom e com o nome que você escolher. Se alguém perguntar diretamente se é robô, ela passa a conversa para a equipe, sem mentir."],
              ["Preciso trocar o número ou tirar o WhatsApp do celular?", "Não. O número de sempre entra pela API oficial da Meta e o aplicativo continua no celular. A equipe pode responder pelo app ou pelo painel; a Ana cuida do resto."],
              ["E se a Ana errar?", "Ela não responde sobre saúde, não dá desconto e não inventa horário: nessas situações passa para uma pessoa. E você pode ligar o modo de aprovação, em que nada sai sem a equipe ver antes."],
              ["Quanto tempo leva para começar?", "Uma tarde. Catálogo, equipe, horários, base de conhecimento e conexão do WhatsApp. No mesmo dia a Ana já responde."],
              ["O que acontece com as minhas clientes de hoje?", "Importamos a planilha ou o cadastro do sistema atual. Histórico e telefone entram prontos, e a reativação começa a trabalhar em cima deles."],
              ["Onde eu vejo as conversas?", "No painel, no navegador, com a mini-ficha da cliente ao lado: próximo horário, histórico e as sugestões de oferta. Qualquer pessoa da equipe assume a conversa com um clique."],
              ["Quanto custa a IA e as mensagens?", "Cada plano inclui uma franquia. Mensagens que a cliente inicia são grátis; só lembretes e reativações fora da janela de 24 h custam centavos. Passou da franquia, você decide se pausa ou libera."],
              ["Tem fidelidade?", "No mensal, não: cancela com 30 dias de aviso. Semestral e anual têm desconto e, no anual à vista, implantação grátis."],
              ["Serve para a minha especialidade?", "Estética facial e corporal, dermatologia, odontologia, harmonização, fisioterapia, nutrição e consultórios em geral. Se marca horário pelo WhatsApp, serve."],
              ["Meus dados ficam seguros?", "Cada clínica fica isolada no banco de dados, com credenciais cifradas e LGPD desde o primeiro dia. Você exporta tudo quando quiser."],
            ].map(([q, a]) => (
              <details key={q} className="group p-5">
                <summary className="cursor-pointer list-none text-base font-medium text-stone-900"><span className="mr-2 text-teal-600 group-open:hidden">+</span><span className="mr-2 hidden text-teal-600 group-open:inline">−</span>{q}</summary>
                <p className="mt-2 text-sm leading-relaxed text-stone-600">{a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ── Quem responde ──────────────────────────────────────── */}
      <section className="bg-stone-50 py-14 text-stone-800">
        <div className="mx-auto flex max-w-3xl flex-col items-center gap-4 px-6 text-center">
          <h2 className="text-2xl font-semibold text-stone-900">Quem responde no WhatsApp</h2>
          <p className="max-w-xl text-stone-600">Gente da Billions Technology, a empresa que desenvolve e opera o VesaliusX. Dados completos nos Termos de Uso e na Política de Privacidade.</p>
          <a href={CTA} target="_blank" rel="noreferrer" className="rounded-xl border border-stone-300 bg-white px-5 py-3 text-sm font-medium text-stone-800 hover:bg-stone-100">
            WhatsApp {WHATSAPP_DISPLAY}
          </a>
        </div>
      </section>

      {/* ── CTA final ──────────────────────────────────────────── */}
      <section className="relative overflow-hidden py-24">
        <div className="fx-blob left-[10%] top-[-30%] h-96 w-96 bg-emerald-400/20" />
        <div className="fx-blob right-[5%] bottom-[-40%] h-96 w-96 bg-teal-400/20" style={{ animationDelay: "-8s" }} />
        <div className="relative z-10 mx-auto grid max-w-5xl items-center gap-10 px-6 lg:grid-cols-[1fr_auto]">
          <div className="text-center lg:text-left">
            <h2 className="text-3xl font-semibold tracking-tight sm:text-5xl">Hoje à noite alguém vai escrever para a sua clínica.</h2>
            <p className="mt-4 text-lg text-teal-100/80">Quem responde: ninguém, ou a Ana?</p>
            <ol className="mt-6 space-y-2 text-left text-teal-100/85">
              {["Toca no botão e cai no nosso WhatsApp.", "Diz o nome da clínica e a cidade.", "A gente responde, mostra a Ana funcionando e marca a sua implantação."].map((t, i) => (
                <li key={t} className="flex gap-3"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-400 text-xs font-semibold text-teal-950">{i + 1}</span>{t}</li>
              ))}
            </ol>
            <div className="mt-8"><CtaButton label="Falar no WhatsApp" big /></div>
            <p className="mt-3 text-xs text-teal-200/60">Sem cartão. Sem compromisso. Só uma mensagem.</p>
          </div>
          <Mascot className="mx-auto w-56 drop-shadow-[0_20px_40px_rgba(0,0,0,0.45)] lg:w-72" />
        </div>
      </section>

      <footer className="border-t border-white/10 py-8 pb-24">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 text-xs text-teal-200/50">
          <span>Vesalius<span className="text-emerald-300/70">X</span> · powered by Billions Technology · 53.133.495 CESAR EUSTAQUIO DA FONSECA FILHO - ME · CNPJ 53.133.495/0001-93</span>
          <span className="flex gap-3">
            <Link href="/privacidade" className="hover:text-teal-100">Privacidade</Link>
            <Link href="/exclusao-de-dados" className="hover:text-teal-100">Exclusão de dados</Link>
            <Link href="/termos-de-uso" className="hover:text-teal-100">Termos</Link>
            <Link href="/" className="hover:text-teal-100">vesaliusx.com.br</Link>
          </span>
        </div>
        <p className="mx-auto mt-3 max-w-6xl px-6 text-[11px] text-teal-200/40">WhatsApp é marca da Meta Platforms. Não somos afiliados à Meta.</p>
      </footer>

      <StickyCta href={CTA} label={`${money(inicial.monthlyBrl)}/mês no plano inicial + API · garantia de ${COMMERCIAL_RULES.guaranteeDays} dias`} />
    </main>
  );
}
