import type { Metadata } from "next";
import Link from "next/link";
import { COMMERCIAL_RULES, PLANS, SETUP_FEE } from "@clinicaos/core/plans";
import { formatBrl } from "@clinicaos/core/spend";
import { LossCalculator } from "./loss-calculator";
import { StickyCta } from "./sticky-cta";

export const metadata: Metadata = {
  title: "VesaliusX — a clínica que responde em segundos, 24h, e não perde cliente",
  description:
    "Assistente no WhatsApp da clínica que responde, agenda, confirma e traz de volta quem sumiu. Agenda, termos assinados, financeiro e estoque numa conta só. Garantia de 30 dias.",
  robots: { index: true, follow: true },
};

/** Número comercial que recebe o CTA (sem +, só dígitos). */
const WHATSAPP_NUMBER = process.env.SALES_WHATSAPP ?? "5561996862249";
const CTA_TEXT = encodeURIComponent("Oi! Vi a página do VesaliusX e quero ver como funciona na minha clínica.");
const CTA_URL = `https://wa.me/${WHATSAPP_NUMBER}?text=${CTA_TEXT}`;
/** Vídeo de vendas (YouTube/Vimeo embed). Vazio = mostra as conversas de exemplo no lugar. */
const VSL_URL = process.env.SALES_VSL_URL ?? "";

const money = (n: number) => formatBrl(n).replace(",00", "");

const CHATS: { time: string; title: string; what: string; lines: { from: "c" | "a"; text: string }[] }[] = [
  {
    time: "22:47",
    title: "Cliente nova, fora do horário",
    what: "A recepção já foi embora. A Ana respondeu em 4 segundos, tirou a dúvida, ofereceu horário real e marcou. De manhã a agenda já tinha uma cliente a mais.",
    lines: [
      { from: "c", text: "Oi, vocês fazem limpeza de pele? Quanto fica?" },
      { from: "a", text: "Oi, Carla! Fazemos sim 😊 A limpeza de pele é a partir de R$ 180 e dura uns 60 min. Quer que eu veja um horário pra você?" },
      { from: "c", text: "Quero, pode ser quinta de tarde?" },
      { from: "a", text: "Tenho quinta às 14h ou às 16h30 com a Dra. Paula. Qual prefere?" },
      { from: "c", text: "16h30" },
      { from: "a", text: "Marcado: quinta, 16h30, limpeza de pele com a Dra. Paula. Te mando um lembrete na véspera. Até lá! ✨" },
    ],
  },
  {
    time: "véspera, 10:00",
    title: "A falta que não aconteceu",
    what: "Confirmação automática no dia anterior. Quem responde “não vou” libera o horário na hora, e a clínica oferece a vaga para a fila. Sem ligação, sem recepcionista perdendo a manhã.",
    lines: [
      { from: "a", text: "Oi, Carla! Passando pra confirmar sua limpeza de pele amanhã às 16h30 com a Dra. Paula. Posso contar com você? 💛" },
      { from: "c", text: "Ai, amanhã não vou conseguir 😢" },
      { from: "a", text: "Sem problema! Quer remarcar? Tenho sábado às 9h ou terça às 15h." },
      { from: "c", text: "Sábado 9h" },
      { from: "a", text: "Pronto, remarcado para sábado às 9h. O horário de amanhã já foi liberado pra outra cliente. Até sábado!" },
    ],
  },
  {
    time: "90 dias depois",
    title: "A cliente que tinha sumido",
    what: "Passou o prazo de retorno do procedimento e ela não voltou. A reativação chama com carinho, no tom da clínica, e oferece o complemento que a clínica autorizou. Faturamento que estava parado.",
    lines: [
      { from: "a", text: "Oi, Carla! Já faz um tempinho desde a sua limpeza de pele. Que tal uma manutenção? Tenho horário quarta às 11h ou sexta às 17h 😊" },
      { from: "c", text: "Nossa, nem vi o tempo passar! Sexta 17h" },
      { from: "a", text: "Marcado! E se quiser aproveitar o mesmo dia, dá pra combinar com o peeling leve, que potencializa o resultado. Quer que eu reserve os dois?" },
      { from: "c", text: "Quero sim!" },
    ],
  },
];

const DORES = [
  ["Mensagem às 22h que só é vista às 9h", "A cliente que escreveu de noite já marcou em outro lugar de manhã."],
  ["Faltas que ninguém confirmou", "Cada falta é um horário pago que ficou vazio. Confirmar um por um toma a manhã da recepção."],
  ["Clientes que sumiram", "Quem fez um procedimento há 3 meses e não voltou não vai lembrar sozinha. Alguém precisa chamar."],
  ["Termo de consentimento no papel", "Impresso, assinado, escaneado, perdido. E sem valor de prova quando precisa."],
  ["Caixa, estoque e comissão em planilhas", "Fechar o mês vira fim de semana de trabalho, e o número nunca bate."],
  ["Recepção que custa 2.500 por mês", "E ainda assim não atende às 22h, nem no sábado, nem no feriado."],
];

const MUDA = [
  "Responde em segundos, 24h, no tom da sua clínica, e marca na agenda de verdade",
  "Confirma a véspera, remarca quem não pode e libera o horário na hora",
  "Traz de volta quem passou do prazo de retorno, sem você lembrar de ninguém",
  "Oferece o serviço complementar certo, só o que você autorizou, com horário livre",
  "Termo de consentimento assinado pelo celular, com validade jurídica",
  "Agenda, clientes, orçamentos, financeiro, estoque e comissões numa conta só",
  "Passa para uma pessoa da equipe na hora certa: dúvida de saúde, reclamação, pedido de desconto",
  "Você aprova o que sai antes, até confiar de olhos fechados",
];

const FAQ: [string, string][] = [
  ["A cliente percebe que é uma assistente?", "Não. A Ana escreve como uma pessoa da equipe, no tom que você escolhe, com o nome que você der. Se alguém perguntar diretamente se é robô, ela passa a conversa para a equipe, sem mentir."],
  ["Preciso trocar o número da clínica?", "Não. O número de sempre continua no celular, no aplicativo WhatsApp Business, e passa a ser atendido também pelo painel e pela assistente, pela API oficial da Meta."],
  ["E se a assistente errar?", "Ela não responde sobre saúde, não dá desconto e não inventa horário: nessas situações chama uma pessoa. E você pode ligar o modo de aprovação, em que nada sai sem alguém da equipe ver primeiro."],
  ["Quanto tempo leva para começar?", "Uma tarde. Fazemos a implantação junto com você: catálogo, equipe, horários, a base de conhecimento da assistente e a conexão do WhatsApp. No mesmo dia ela já responde."],
  ["O que acontece com minhas clientes de hoje?", "Importamos a sua planilha ou o cadastro do sistema atual. Histórico, telefone e procedimentos entram prontos; a reativação começa a trabalhar em cima deles."],
  ["Tem fidelidade?", "No plano mensal, não: cancela quando quiser, com 30 dias de aviso. E nos primeiros 30 dias, se não gostar, devolvemos a mensalidade."],
  ["Quanto custa a IA e as mensagens?", "Cada plano já inclui uma franquia de uso de IA e de mensagens oficiais da Meta. Mensagens que a cliente inicia não custam nada. Passou da franquia, você decide: pausa, ou libera e paga o excedente na mensalidade seguinte, tudo visível no painel."],
  ["Serve para a minha especialidade?", "Estética facial e corporal, dermatologia, odontologia, harmonização, fisioterapia, nutrição e consultórios em geral. Se a sua clínica marca horário pelo WhatsApp, serve."],
];

export default function VendasPage() {
  const lead = PLANS.find((p) => p.highlight) ?? PLANS[1]!;
  return (
    <main className="bg-teal-950 text-white">
      {/* ── Hero ───────────────────────────────────────────────── */}
      <section className="relative overflow-hidden">
        <div className="fx-blob left-[-12%] top-[-18%] h-[36rem] w-[36rem] bg-teal-500/30" />
        <div className="fx-blob right-[-10%] top-[20%] h-[30rem] w-[30rem] bg-emerald-400/20" style={{ animationDelay: "-7s" }} />
        <div className="absolute inset-0 fx-grid opacity-50" />
        <div className="relative z-10 mx-auto max-w-5xl px-6 pb-16 pt-10 text-center sm:pt-16">
          <p className="inline-flex items-center gap-2 rounded-full border border-emerald-300/20 bg-emerald-300/10 px-3.5 py-1.5 text-xs font-medium text-emerald-200">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-300" />
            Para clínicas de estética e saúde que atendem pelo WhatsApp
          </p>
          <h1 className="mx-auto mt-6 max-w-4xl text-4xl font-semibold leading-[1.12] tracking-tight sm:text-6xl">
            Sua clínica responde em <span className="fx-shine-text">segundos</span>, marca sozinha e nunca mais perde cliente por demora.
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-teal-100/85 sm:text-xl">
            A Ana atende no WhatsApp da clínica 24 horas: responde, agenda, confirma a véspera, traz de volta quem sumiu e oferece o serviço certo. Com agenda, termos assinados, financeiro e estoque numa conta só.
          </p>
          <div className="mt-9 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <a href={CTA_URL} target="_blank" rel="noreferrer" className="w-full rounded-xl bg-emerald-400 px-8 py-4 text-center text-base font-semibold text-teal-950 shadow-lg shadow-emerald-400/30 transition hover:bg-emerald-300 sm:w-auto">
              Quero a Ana na minha clínica
            </a>
            <a href="#como-funciona" className="w-full rounded-xl border border-white/15 bg-white/5 px-8 py-4 text-center text-base font-medium backdrop-blur transition hover:bg-white/10 sm:w-auto">
              Ver como funciona
            </a>
          </div>
          <p className="mt-3 text-xs text-teal-200/60">Fala direto com a gente no WhatsApp. Sem formulário. Garantia de {COMMERCIAL_RULES.guaranteeDays} dias.</p>

          {VSL_URL ? (
            <div className="mx-auto mt-12 aspect-video w-full max-w-3xl overflow-hidden rounded-2xl border border-white/10 bg-black shadow-2xl shadow-teal-950">
              <iframe src={VSL_URL} title="VesaliusX" className="h-full w-full" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen />
            </div>
          ) : null}

          <div className="mx-auto mt-12 grid max-w-3xl grid-cols-3 gap-3 text-left">
            <Stat n="4 s" l="tempo de resposta, às 22h ou no feriado" />
            <Stat n="1 falta" l="evitada por mês já paga o plano" />
            <Stat n="30 dias" l="de garantia: não gostou, devolvemos" />
          </div>
        </div>
      </section>

      {/* ── Dor ────────────────────────────────────────────────── */}
      <section className="bg-white py-20 text-stone-800">
        <div className="mx-auto max-w-5xl px-6">
          <p className="text-center text-xs font-semibold uppercase tracking-widest text-teal-600">Sábado, 19h40</p>
          <h2 className="mx-auto mt-3 max-w-3xl text-center text-3xl font-semibold tracking-tight text-stone-900 sm:text-4xl">
            Uma cliente escreveu “oi, vocês fazem botox?”. Ninguém viu. Na segunda ela já tinha marcado na concorrente.
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-center text-stone-500">
            Clínica não perde cliente por preço. Perde por demora, por falta não confirmada e por quem sumiu e ninguém chamou. Isso é faturamento escorrendo todo mês sem fazer barulho.
          </p>
          <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {DORES.map(([t, d]) => (
              <div key={t} className="rounded-2xl border border-stone-200 bg-stone-50 p-5">
                <p className="font-semibold text-stone-900">{t}</p>
                <p className="mt-1.5 text-sm text-stone-500">{d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Demonstração em conversas ───────────────────────────── */}
      <section id="como-funciona" className="bg-stone-50 py-20 text-stone-800">
        <div className="mx-auto max-w-6xl px-6">
          <p className="text-center text-xs font-semibold uppercase tracking-widest text-teal-600">Veja a Ana trabalhando</p>
          <h2 className="mx-auto mt-3 max-w-3xl text-center text-3xl font-semibold tracking-tight text-stone-900 sm:text-4xl">
            Três conversas que acontecem todo dia. Nenhuma precisou da recepção.
          </h2>
          <div className="mt-12 grid gap-6 lg:grid-cols-3">
            {CHATS.map((c) => (
              <div key={c.title} className="flex flex-col rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between">
                  <p className="font-semibold text-stone-900">{c.title}</p>
                  <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[11px] text-stone-500">{c.time}</span>
                </div>
                <div className="mt-4 space-y-2 rounded-xl bg-[#e5ddd5] p-3">
                  {c.lines.map((l, i) => (
                    <div key={i} className={`flex ${l.from === "a" ? "justify-end" : "justify-start"}`}>
                      <p className={`max-w-[88%] rounded-lg px-3 py-1.5 text-[13px] leading-snug shadow-sm ${l.from === "a" ? "bg-[#d9fdd3] text-stone-800" : "bg-white text-stone-800"}`}>{l.text}</p>
                    </div>
                  ))}
                </div>
                <p className="mt-4 text-sm text-stone-500">{c.what}</p>
              </div>
            ))}
          </div>
          <p className="mt-6 text-center text-xs text-stone-400">Conversas de exemplo. Nomes e valores ilustrativos. A Ana fala no tom da sua clínica, com o seu catálogo e os seus horários.</p>
          <div className="mt-10 text-center">
            <a href={CTA_URL} target="_blank" rel="noreferrer" className="inline-block rounded-xl bg-teal-700 px-8 py-4 text-base font-semibold text-white shadow-lg shadow-teal-700/25 transition hover:bg-teal-800">
              Quero isso no meu WhatsApp
            </a>
          </div>
        </div>
      </section>

      {/* ── O que muda ─────────────────────────────────────────── */}
      <section className="bg-white py-20 text-stone-800">
        <div className="mx-auto max-w-5xl px-6">
          <h2 className="text-center text-3xl font-semibold tracking-tight text-stone-900 sm:text-4xl">O que muda na sua semana</h2>
          <ul className="mx-auto mt-10 grid max-w-4xl gap-3 sm:grid-cols-2">
            {MUDA.map((m) => (
              <li key={m} className="flex gap-3 rounded-xl border border-stone-200 p-4 text-sm text-stone-700">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">✓</span>
                <span>{m}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ── É pra você / não é ─────────────────────────────────── */}
      <section className="bg-stone-50 py-20 text-stone-800">
        <div className="mx-auto grid max-w-5xl gap-6 px-6 md:grid-cols-2">
          <div className="rounded-2xl border border-emerald-200 bg-white p-6">
            <h3 className="text-lg font-semibold text-emerald-800">É pra você se…</h3>
            <ul className="mt-3 space-y-2 text-sm text-stone-700">
              {["suas clientes marcam, remarcam e tiram dúvida pelo WhatsApp", "você perde mensagem fora do horário ou demora para responder", "tem falta que ninguém confirmou e horário vazio que custou caro", "quer trazer de volta quem sumiu sem ficar lembrando de cada uma", "quer agenda, termo, caixa e estoque num lugar só, sem planilha"].map((t) => (
                <li key={t} className="flex gap-2"><span className="text-emerald-600">✓</span>{t}</li>
              ))}
            </ul>
          </div>
          <div className="rounded-2xl border border-stone-200 bg-white p-6">
            <h3 className="text-lg font-semibold text-stone-700">Não é pra você se…</h3>
            <ul className="mt-3 space-y-2 text-sm text-stone-600">
              {["quer um robô de “digite 1 para agenda”", "quer disparar promoção em massa para lista comprada", "não atende pelo WhatsApp e não pretende atender", "prefere que ninguém responda a cliente fora do horário"].map((t) => (
                <li key={t} className="flex gap-2"><span className="text-stone-400">✕</span>{t}</li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ── Como começa ────────────────────────────────────────── */}
      <section className="bg-white py-20 text-stone-800">
        <div className="mx-auto max-w-5xl px-6">
          <h2 className="text-center text-3xl font-semibold tracking-tight text-stone-900 sm:text-4xl">No ar em uma tarde. Sem trocar de número.</h2>
          <div className="mt-12 grid gap-8 md:grid-cols-3">
            {[
              ["1", "Conecta o WhatsApp", "O número da clínica entra pela API oficial da Meta, com um clique em “Conectar com o Facebook”. O aplicativo continua no celular como sempre."],
              ["2", "Montamos a clínica junto", "Catálogo, equipe, horários, a base de conhecimento da Ana e a importação das suas clientes. Uma tarde com a dona, e está pronto."],
              ["3", "A Ana começa a atender", "Com aprovação ligada no começo: você vê o que ela responde e solta aos poucos. Em uma semana, ela está sozinha e você está tranquila."],
            ].map(([n, t, d]) => (
              <div key={n} className="text-center">
                <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-teal-700 text-lg font-semibold text-white shadow-lg shadow-teal-700/25">{n}</span>
                <h3 className="mt-5 text-base font-semibold text-stone-900">{t}</h3>
                <p className="mt-2 text-sm leading-relaxed text-stone-500">{d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── A conta ────────────────────────────────────────────── */}
      <section className="bg-stone-50 py-20 text-stone-800">
        <div className="mx-auto max-w-5xl px-6">
          <h2 className="text-center text-3xl font-semibold tracking-tight text-stone-900 sm:text-4xl">A conta que ninguém faz na sua frente</h2>
          <p className="mx-auto mt-3 max-w-2xl text-center text-stone-500">Quanto a sua clínica perde por mês com faltas e mensagens sem resposta? Coloque os seus números.</p>
          <div className="mt-10">
            <LossCalculator planBrl={lead.monthlyBrl} />
          </div>
          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            {[
              ["Uma recepcionista", "R$ 2.500 a 3.500/mês", "com encargos, e não atende às 22h, no sábado nem no feriado"],
              ["Um procedimento perdido", "R$ 180 a 1.200", "cada falta ou cliente que marcou na concorrente"],
              [`VesaliusX ${lead.name}`, `${money(lead.monthlyBrl)}/mês`, "atende 24h, confirma, reativa e ainda cuida do caixa"],
            ].map(([t, v, d]) => (
              <div key={t} className="rounded-2xl border border-stone-200 bg-white p-5">
                <p className="text-sm text-stone-500">{t}</p>
                <p className="mt-1 text-2xl font-semibold text-stone-900">{v}</p>
                <p className="mt-1 text-xs text-stone-500">{d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Planos ─────────────────────────────────────────────── */}
      <section id="planos" className="bg-white py-20 text-stone-800">
        <div className="mx-auto max-w-6xl px-6">
          <h2 className="text-center text-3xl font-semibold tracking-tight text-stone-900 sm:text-4xl">
            A partir de {money(PLANS[0]!.monthlyBrl)} por mês. Uma falta evitada já paga.
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-center text-stone-500">Sem fidelidade no mensal. Desconto para quem fecha o semestre ou o ano. Cada plano inclui a franquia de IA e de mensagens.</p>
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
                  {plan.features.map((f) => (
                    <li key={f} className="flex gap-2"><span className="text-teal-600">✓</span><span>{f}</span></li>
                  ))}
                </ul>
                <p className="mt-6 text-xs text-stone-400">Inclui {formatBrl(plan.apiAllowanceBrl)}/mês de IA e mensagens oficiais.</p>
                <a href={CTA_URL} target="_blank" rel="noreferrer" className={`mt-6 block rounded-xl px-4 py-3 text-center text-sm font-semibold transition ${plan.highlight ? "bg-teal-700 text-white hover:bg-teal-800" : "border border-stone-300 text-stone-800 hover:bg-stone-50"}`}>
                  Começar com o {plan.name}
                </a>
              </div>
            ))}
          </div>
          <div className="mt-8 grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-stone-200 bg-stone-50 p-5 text-sm text-stone-700">
              <p className="font-semibold text-stone-900">
                Implantação <span className="text-stone-400 line-through">{money(SETUP_FEE.listBrl)}</span> {money(SETUP_FEE.brl)} <span className="font-normal text-stone-500">· em até {SETUP_FEE.installments}× · grátis no anual à vista</span>
              </p>
              <p className="mt-1 text-stone-500">{SETUP_FEE.includes.join(" · ")}.</p>
            </div>
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
              <p className="font-semibold">Entrada suave</p>
              <p className="mt-1">
                Fechando o {lead.name} no anual, os {COMMERCIAL_RULES.rampMonths} primeiros meses saem por {money(COMMERCIAL_RULES.rampPriceBrl)}, enquanto a equipe se acostuma. Anual à vista: {Math.round(COMMERCIAL_RULES.annualUpfrontDiscount * 100)}% de desconto. Semestral: {Math.round(COMMERCIAL_RULES.semiannualUpfrontDiscount * 100)}%.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Garantia ───────────────────────────────────────────── */}
      <section className="bg-teal-800 py-16 text-white">
        <div className="mx-auto flex max-w-4xl flex-col items-center gap-6 px-6 text-center sm:flex-row sm:text-left">
          <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-full border-4 border-emerald-300/60 text-center text-xs font-semibold uppercase leading-tight text-emerald-200">
            {COMMERCIAL_RULES.guaranteeDays} dias<br />garantia
          </div>
          <div>
            <h2 className="text-2xl font-semibold">Risco zero por {COMMERCIAL_RULES.guaranteeDays} dias.</h2>
            <p className="mt-2 text-teal-100/85">Use a Ana um mês inteiro. Se no fim dos {COMMERCIAL_RULES.guaranteeDays} dias você não quiser continuar, devolvemos a mensalidade. Sem perguntas, sem burocracia. A implantação é trabalho feito e fica com você.</p>
          </div>
        </div>
      </section>

      {/* ── FAQ ────────────────────────────────────────────────── */}
      <section className="bg-white py-20 text-stone-800">
        <div className="mx-auto max-w-3xl px-6">
          <h2 className="text-center text-3xl font-semibold tracking-tight text-stone-900">Antes de decidir</h2>
          <div className="mt-8 divide-y divide-stone-200 rounded-2xl border border-stone-200">
            {FAQ.map(([q, a]) => (
              <details key={q} className="group p-5">
                <summary className="cursor-pointer list-none text-base font-medium text-stone-900">
                  <span className="mr-2 text-teal-600 group-open:hidden">+</span><span className="mr-2 hidden text-teal-600 group-open:inline">−</span>{q}
                </summary>
                <p className="mt-2 text-sm leading-relaxed text-stone-600">{a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA final ──────────────────────────────────────────── */}
      <section className="relative overflow-hidden py-24">
        <div className="fx-blob left-[10%] top-[-30%] h-96 w-96 bg-emerald-400/20" />
        <div className="fx-blob right-[5%] bottom-[-40%] h-96 w-96 bg-teal-400/20" style={{ animationDelay: "-8s" }} />
        <div className="relative z-10 mx-auto max-w-3xl px-6 text-center">
          <h2 className="text-3xl font-semibold tracking-tight sm:text-5xl">Hoje à noite alguém vai escrever para a sua clínica.</h2>
          <p className="mx-auto mt-4 max-w-xl text-lg text-teal-100/80">Quem responde: ninguém, ou a Ana? Chama a gente no WhatsApp e em uma tarde ela está no ar.</p>
          <a href={CTA_URL} target="_blank" rel="noreferrer" className="mt-9 inline-block rounded-xl bg-emerald-400 px-10 py-5 text-lg font-semibold text-teal-950 shadow-lg shadow-emerald-400/25 transition hover:bg-emerald-300">
            Falar no WhatsApp agora
          </a>
          <p className="mt-3 text-xs text-teal-200/60">Resposta de gente, em horário comercial. Nada é cobrado até você decidir.</p>
        </div>
      </section>

      <footer className="border-t border-white/10 py-8 pb-24">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 text-xs text-teal-200/50">
          <span>Vesalius<span className="text-emerald-300/70">X</span> · powered by Billions Technology · 53.133.495 CESAR EUSTAQUIO DA FONSECA FILHO - ME · CNPJ 53.133.495/0001-93</span>
          <span className="flex gap-3">
            <Link href="/termos-de-uso" className="hover:text-teal-100">Termos de uso</Link>
            <Link href="/privacidade" className="hover:text-teal-100">Privacidade</Link>
            <Link href="/login" className="hover:text-teal-100">Já sou cliente</Link>
          </span>
        </div>
      </footer>

      <StickyCta href={CTA_URL} label={`A partir de ${money(PLANS[0]!.monthlyBrl)}/mês · garantia de ${COMMERCIAL_RULES.guaranteeDays} dias`} />
    </main>
  );
}

function Stat({ n, l }: { n: string; l: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur">
      <p className="text-2xl font-semibold text-emerald-300">{n}</p>
      <p className="mt-1 text-xs leading-snug text-teal-100/70">{l}</p>
    </div>
  );
}
