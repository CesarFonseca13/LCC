import type { Metadata } from "next";
import Link from "next/link";
import { Fragment } from "react";
import { COMMERCIAL_RULES, PLANS, SETUP_FEE, annualUpfrontMonthly, annualUpfrontTotal, semiannualUpfrontMonthly, semiannualUpfrontTotal } from "@clinicaos/core/plans";
import { In, Notice, Out, Phone, Pin, Scene, Sys } from "./chat";
import { CTA_URL, CUSTO_POR_ATENDIMENTO, FALTA_COM, FALTA_SEM, SALES, TICKET_REF } from "./premissas";
import { StickyCta } from "./sticky-cta";
import { VolumeCalculator } from "./volume-calculator";

export const metadata: Metadata = {
  title: { absolute: "VesaliusX · O WhatsApp da sua clínica atende sozinho, 24 horas" },
  description:
    "A Ana responde em segundos, marca na agenda de verdade e confirma a véspera, no número que a clínica já usa. A partir de R$ 297 por mês, com IA inclusa.",
  alternates: { canonical: "/vendas" },
  openGraph: {
    type: "website",
    locale: "pt_BR",
    siteName: "VesaliusX",
    url: "/vendas",
    title: "O WhatsApp da sua clínica atende sozinho. 24 horas.",
    description: "Responde em segundos, marca na agenda de verdade e confirma a véspera. No número que a clínica já usa.",
    images: [{ url: "/marca/og-vendas.jpg", width: 1200, height: 630, alt: "Ana, a assistente da VesaliusX, com o WhatsApp da clínica no celular" }],
  },
  twitter: { card: "summary_large_image", images: ["/marca/og-vendas.jpg"] },
};

const inicial = PLANS[0]!;
const brl = (n: number, cents = false) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 });
const perDay = (m: number) => brl(m / 30, true);
const pct = (n: number) => `${Math.round(n * 100)}%`;
const limites = (p: (typeof PLANS)[number]) =>
  `${p.whatsappNumbers === null ? "Números ilimitados" : `${p.whatsappNumbers} número${p.whatsappNumbers > 1 ? "s" : ""} de WhatsApp`} · ${p.professionals === null ? "profissionais ilimitadas" : `até ${p.professionals} profissionais`}`;

/** Volume de referência por plano (mesmos botões da calculadora). */
const REF_VOLUME: Record<string, number> = { essencial: 100, profissional: 300, clinica: 500 };

/** Título: serifa pesada e quebra equilibrada. */
const T = "font-[family-name:var(--font-v-titulo)] text-balance";
/** Contêineres: duas bordas só (larga e estreita). */
const WIDE = "mx-auto max-w-6xl px-4 sm:px-6";
const NARROW = "mx-auto max-w-5xl px-4 sm:px-6";

function CtaButton({ children = "Quero na minha clínica", big = false, light = false, id }: { children?: React.ReactNode; big?: boolean; light?: boolean; id?: string }) {
  return (
    <a
      id={id}
      href={CTA_URL}
      target="_blank"
      rel="noreferrer"
      className={`group inline-flex w-full items-center justify-center gap-3 rounded-full font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F0C48A] focus-visible:ring-offset-2 sm:w-auto ${big ? "min-h-[58px] px-8 text-[17px]" : "min-h-[54px] px-6 text-[16px]"} ${
        light
          ? "bg-[#FAF9F6] text-[#C2412F] shadow-[0_14px_30px_-12px_rgba(0,0,0,0.45)] hover:bg-white"
          : "bg-[#C2412F] text-white shadow-[0_14px_30px_-12px_rgba(194,65,47,0.85)] hover:bg-[#A3361F]"
      }`}
    >
      {children} <span aria-hidden className="transition-transform group-hover:translate-x-0.5">→</span>
    </a>
  );
}

function Eyebrow({ children, dark = false }: { children: React.ReactNode; dark?: boolean }) {
  return <p className={`text-[12.5px] font-bold uppercase tracking-[0.16em] ${dark ? "text-[#F0C48A]" : "text-[#8A5A1E]"}`}>{children}</p>;
}

const CHECK = (
  <svg viewBox="0 0 20 20" className="mt-[3px] h-4 w-4 shrink-0 fill-none stroke-current stroke-[2.6]" aria-hidden>
    <path d="M4 10.5l3.5 3.5L16 6" />
  </svg>
);
const CROSS = (
  <svg viewBox="0 0 20 20" className="mt-[3px] h-4 w-4 shrink-0 fill-none stroke-current stroke-[2.6]" aria-hidden>
    <path d="M5 5l10 10M15 5L5 15" />
  </svg>
);

/** Card escuro que comenta a conversa (dentro do chat no celular, coluna fixa no desktop). */
function DarkCard({ eyebrow, title, accent, body, cta, className = "" }: { eyebrow: string; title: string; accent: string; body: string; cta: string; className?: string }) {
  return (
    <div className={`relative overflow-hidden rounded-[20px] bg-[#062B30] p-5 text-[#FAF9F6] shadow-[0_30px_60px_-30px_rgba(6,43,48,0.6)] lg:rounded-3xl lg:p-7 ${className}`}>
      <div aria-hidden className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-[#F0C48A]/15 blur-2xl" />
      <Eyebrow dark>{eyebrow}</Eyebrow>
      <h3 className={`${T} mt-2 text-[27px] font-black leading-[1.05] tracking-[-0.01em] lg:text-[28px]`}>
        {title} <span className="text-[#F0C48A]">{accent}</span>
      </h3>
      <p className="mt-2.5 text-[16px] leading-[1.45] text-[#FAF9F6]/90 lg:text-[15.5px]">{body}</p>
      <div className="mt-4">
        <CtaButton>{cta}</CtaButton>
      </div>
    </div>
  );
}

const CARD_1 = {
  eyebrow: "O que acabou de acontecer",
  title: "Dúvida de preço virou horário marcado.",
  accent: "Sem ninguém pegar no celular.",
  body: "A Ana consulta o seu catálogo e a sua agenda de verdade: oferece só horário livre, com a profissional que faz aquele procedimento, e grava direto na agenda. Sem “digite 1 para agendar”.",
  cta: "Quero isso na minha agenda",
};
const CARD_2 = {
  eyebrow: "Nesses três dias, você",
  title: "Estava atendendo.",
  accent: "E nenhuma das três conversas ficou esperando.",
  body: "O peeling foi oferecido uma vez, junto com os horários, só porque você marcou que combina com a limpeza. A véspera foi lembrada e o horário voltou livre sozinho. E a dúvida de saúde foi para a sua equipe na hora, não para o robô.",
  cta: "Quero na minha clínica",
};

const VOCE_PARA: [string, string][] = [
  ["…perder cliente por demora.", "Toda mensagem respondida em segundos, 24 horas, inclusive sábado à noite e feriado. Se a IA não souber, a conversa vai para a sua equipe, com aviso."],
  ["…ligar para lembrar da véspera.", "O lembrete sai sozinho pelo WhatsApp. Quem não pode, remarca ali mesmo, e o horário volta livre para a agenda."],
  ["…esquecer quem sumiu.", "Passou o prazo de retorno do procedimento, a Ana chama a cliente no tom da clínica e oferece horário (no Profissional)."],
  ["…imprimir termo.", "Consentimento assinado pelo celular, com data, IP e registro do conteúdo. Fica na ficha da cliente."],
  ["…fechar o mês na planilha.", "Estoque baixa a cada atendimento; comissões e caixa já saem calculados no painel (no Profissional)."],
  ["…ficar refém do celular.", "Quando precisa de gente, a Ana transfere. Qualquer pessoa da equipe assume a conversa pelo painel."],
];

const PASSOS: [string, string][] = [
  ["Conecta o WhatsApp", "API oficial da Meta, com o botão “Conectar com o Facebook”. O WhatsApp Business do celular continua funcionando. Fazemos junto; normalmente fica pronto no mesmo dia."],
  ["Sobe o catálogo", "Procedimentos, preços, duração e quem faz cada um. Ela aprende os seus serviços, não um genérico."],
  ["Cadastra a equipe", "Profissionais, salas e a agenda de cada uma. É a sua agenda que ela usa para marcar."],
  ["Ela começa a atender", "24 horas, com aprovação no começo se você quiser. Cada agendamento aparece no painel na hora."],
];

const FAQ: [string, string][] = [
  ["A cliente percebe que é uma assistente?", "Não. A Ana escreve como uma pessoa da equipe, no tom que você escolher (acolhedora, elegante ou animada) e com o nome que você der. Se alguém perguntar diretamente se é robô, ela passa a conversa para a equipe, sem mentir."],
  ["Preciso trocar de número ou tirar o WhatsApp do celular?", "Não. O número de sempre entra pela API oficial da Meta e o WhatsApp Business continua no celular. A equipe pode responder pelo app ou pelo painel; quando alguém da equipe responde, a Ana sai da conversa."],
  ["E se a Ana errar?", "Ela só oferece horário que está livre na sua agenda, só cita preço do seu catálogo e nunca dá desconto. Pode ligar o modo de aprovação: nada sai sem alguém da equipe ver antes, até você confiar."],
  ["E se a cliente perguntar algo de saúde?", "Dor, inchaço, reação, medicamento, gravidez: a Ana acolhe em uma frase, não opina e passa na hora para a sua equipe, com aviso de urgência no painel."],
  ["Onde eu vejo as conversas e os agendamentos?", "No painel, pelo navegador do computador ou do celular. Cada conversa tem a mini-ficha da cliente ao lado: próximo horário, histórico e sugestões de serviço complementar. O agendamento entra direto na agenda."],
  ["Funciona com várias profissionais e salas?", "Sim. Cada profissional tem a própria agenda e os procedimentos que faz. A Ana só oferece horário com quem realiza aquele serviço, e soma a duração quando a cliente quer mais de um no mesmo dia."],
  ["O que acontece com as minhas clientes de hoje?", "A gente importa a sua planilha (ou a exportação do sistema atual, em planilha): nome, telefone, e-mail, aniversário, última visita, último procedimento e quanto cada cliente já gastou. É com isso que a reativação sabe quem chamar."],
  [
    "Quanto custa a inteligência artificial?",
    `Cada plano já inclui uma franquia mensal de IA e de mensagens oficiais (${PLANS.map((p) => `${p.name} ${brl(p.apiAllowanceBrl)}`).join(", ")}). Pela conta desta página, cerca de R$ ${CUSTO_POR_ATENDIMENTO.toFixed(2).replace(".", ",")} por atendimento, a franquia cobre perto de ${PLANS.map((p) => `${Math.floor(p.apiAllowanceBrl / CUSTO_POR_ATENDIMENTO)} atendimentos no ${p.name}`).join(", ")}. O gasto aparece em tempo real em Configurações.`,
  ],
  ["E a tarifa da Meta por mensagem?", "A Meta só cobra mensagens que a clínica inicia fora da janela de 24 horas, como o lembrete de véspera (cerca de R$ 0,04) e a reativação (cerca de R$ 0,35). Mensagem que a cliente manda, e a resposta dentro de 24 horas, não custam nada."],
  ["Quanto tempo leva para começar?", "Normalmente uma tarde. Conectamos o WhatsApp, montamos catálogo, equipe e horários e a base de conhecimento com você. No mesmo dia a Ana já responde."],
  ["Meus dados e os das clientes ficam seguros?", "Cada clínica fica isolada no banco de dados, as credenciais são cifradas e a LGPD é seguida desde o primeiro dia. Você pode pedir a exportação de todos os dados quando quiser e a exclusão a qualquer momento."],
];

export default function VendasPage() {
  return (
    <>
      <main className="bg-[#FAF9F6] text-[#14211F]">
        {/* ── Cabeçalho + Hero ───────────────────────────────────── */}
        <section className="relative overflow-hidden bg-[#062B30] text-[#FAF9F6]">
          <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(70%_60%_at_85%_10%,rgba(14,110,106,0.55),transparent_60%),radial-gradient(60%_50%_at_0%_100%,rgba(240,196,138,0.10),transparent_60%)]" />
          <header className={`${WIDE} relative z-10 flex items-center justify-between gap-3 py-5`}>
            <span className="flex items-center gap-2.5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/marca/ana-avatar.webp" alt="" width={36} height={36} className="h-9 w-9 rounded-full bg-[#F3E9DD] object-cover ring-2 ring-white/30" />
              <span className={`${T} text-[19px] font-black tracking-tight`}>
                Vesalius<span className="text-[#F0C48A]">X</span>
              </span>
            </span>
            <span className="text-[12px] font-bold uppercase tracking-[0.16em] text-[#F0C48A]/85 sm:hidden">Clínicas</span>
            <a href={CTA_URL} target="_blank" rel="noreferrer" className="hidden rounded-full border border-[#F0C48A] px-5 py-2.5 text-[14px] font-bold text-[#F0C48A] transition hover:bg-[#F0C48A] hover:text-[#062B30] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F0C48A] focus-visible:ring-offset-2 focus-visible:ring-offset-[#062B30] sm:inline-block">
              Quero na minha clínica
            </a>
          </header>

          <div className={`${WIDE} relative z-10 grid items-end gap-2 pt-2 lg:grid-cols-[minmax(0,1fr)_400px] lg:gap-6 lg:pt-6`}>
            <div className="pb-4 lg:pb-16">
              <h1 className={`${T} text-[44px] font-black leading-[0.98] tracking-[-0.02em] sm:text-[60px] lg:text-[56px] xl:text-[68px]`}>
                Seu WhatsApp atende sozinho.
                <br />
                24 horas.
                <br />
                <span className="text-[#F0C48A] lg:whitespace-nowrap">Sem perder cliente.</span>
              </h1>
              <p className="mt-5 max-w-[33rem] text-[17px] leading-relaxed text-[#FAF9F6]/90 sm:text-[19px]">
                Responde em segundos, marca na sua agenda de verdade e confirma a véspera. Tudo pelo número que a clínica já usa.
              </p>
              <div className="mt-7">
                <CtaButton big id="cta-hero">Quero na minha clínica</CtaButton>
              </div>
              <div className="mt-6 grid max-w-[33rem] grid-cols-2 gap-2">
                {[
                  [`${brl(inicial.monthlyBrl)}/mês`, "no plano inicial, com IA inclusa"],
                  [`${Math.ceil(inicial.monthlyBrl / 150)} faltas`, "evitadas por mês já pagam o plano inicial"],
                ].map(([n, l]) => (
                  <div key={n} className="rounded-2xl border border-[#FAF9F6]/20 bg-white/[0.04] px-2 py-2.5 text-center sm:px-4 sm:py-3.5">
                    <p className={`${T} whitespace-nowrap text-[19px] font-black text-[#F0C48A] sm:text-[22px]`}>{n}</p>
                    <p className="mt-1 min-h-[2.5em] text-balance text-[12px] leading-[1.25] text-[#FAF9F6]/85 sm:text-[12.5px]">{l}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="relative lg:mx-auto lg:w-full lg:max-w-[400px] lg:self-end">
              <div className="flex items-end justify-between gap-3 lg:block">
                <div className="flex flex-col justify-between gap-4 self-stretch py-4 lg:contents">
                  <div className="relative z-10 max-w-[160px] rounded-2xl rounded-bl-sm bg-white px-3.5 py-2.5 text-[#14211F] shadow-[0_18px_40px_-15px_rgba(0,0,0,0.5)] lg:absolute lg:-left-6 lg:top-16 lg:max-w-[215px] lg:px-4 lg:py-3">
                    <p className="text-[14px] font-medium leading-snug lg:text-[15px]">Oi! Pode falar que eu marco pra você 😊</p>
                    <p className="mt-1 text-right text-[11px] text-[#5F6B68]">10:02</p>
                  </div>
                  <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-[#F0C48A] lg:hidden">
                    Role e veja a conversa <span aria-hidden>↓</span>
                  </p>
                </div>
                <div className="relative h-[235px] w-[190px] shrink-0 overflow-hidden lg:h-auto lg:w-full lg:overflow-visible">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src="/marca/ana.webp"
                    alt="Ana, a assistente da VesaliusX, mostrando o WhatsApp da clínica no celular"
                    width={408}
                    height={612}
                    fetchPriority="high"
                    className="absolute right-0 top-0 w-[190px] max-w-none drop-shadow-[0_30px_40px_rgba(0,0,0,0.45)] lg:relative lg:ml-auto lg:w-[88%] lg:max-w-full"
                  />
                </div>
              </div>
            </div>
          </div>
        </section>

        {SALES.vslUrl ? (
          <section className="bg-[#062B30] pb-16">
            <div className={WIDE}>
              <div className="mx-auto aspect-video w-full max-w-4xl overflow-hidden rounded-3xl border border-white/10 bg-black shadow-2xl">
                <iframe src={SALES.vslUrl} title="Veja a VesaliusX funcionando" loading="lazy" className="h-full w-full" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen />
              </div>
            </div>
          </section>
        ) : null}

        {/* ── O problema ─────────────────────────────────────────── */}
        <section className="bg-[#F3F0E8] pb-8 pt-10 sm:pb-10 sm:pt-14">
          <div className={`${NARROW} md:text-center`}>
            <h2 className={`${T} text-[52px] font-black leading-[0.98] tracking-[-0.02em] text-[#062B30] sm:text-[80px]`}>
              Sábado, 10h.
              <br />
              Agenda cheia.
            </h2>
            <div className="mt-7 flex flex-col items-start gap-2.5 md:items-center">
              {[
                ["10:02", "O celular vibra no balcão, mas a recepção está com uma cliente na frente."],
                ["10:09", "Já são nove conversas esperando: preço, horário, “dá pra remarcar?”."],
                ["10:41", "Você responde o “oi” que chegou às dez. A resposta vem na hora: “já marquei em outro lugar, obrigada”."],
              ].map(([t, d]) => (
                <p key={t} className="inline-flex max-w-full items-baseline gap-2.5 bg-[#14211F] px-3 py-1.5 text-left text-[15px] leading-snug text-[#FAF9F6] sm:text-[16px]">
                  <time className={`${T} shrink-0 text-[13px] font-bold text-[#F0C48A]`}>{t}</time>
                  <span>{d}</span>
                </p>
              ))}
            </div>
            <p className={`${T} mt-7 text-[24px] font-black leading-tight text-[#C2412F] sm:text-[30px]`}>
              A cliente que fica sem resposta não reclama. Ela só não volta.
            </p>
            <p className={`${T} mt-7 max-w-[22ch] text-[34px] font-black leading-[1.02] tracking-[-0.02em] text-[#0E6E6A] sm:text-[44px] md:mx-auto md:max-w-[26ch]`}>
              Agora imagine o mesmo sábado, com a Ana respondendo por você. <span aria-hidden>↓</span>
            </p>
          </div>
        </section>

        {/* ── A conversa ─────────────────────────────────────────── */}
        <section className="bg-[#F3F0E8] pb-10 sm:pb-16">
          <div className={`${WIDE} grid items-start gap-10 lg:grid-cols-[480px_minmax(0,1fr)] lg:gap-12`}>
            <Phone clinic="Clínica Bella">
              <Pin>Só oferece horário que está livre de verdade.</Pin>
              <Scene>Sábado · 10h02 · Conversa de exemplo</Scene>
              <Out time="10:02">oi! vocês fazem limpeza de pele? quanto fica?</Out>
              <In time="10:02">
                Oi, Carla! Tudo bem? 😊 Fazemos sim! A limpeza de pele é a partir de <strong>R$ 180</strong> e leva uns 60 minutos. Quer que eu veja um horário pra você?
              </In>
              <Out time="10:03">quero! quinta à tarde tem?</Out>
              <In time="10:03">
                Tenho quinta às <strong>14h</strong> ou às <strong>16h30</strong>, com a Dra. Paula. Se quiser, dá pra fazer junto o <strong>peeling leve</strong> (a partir de R$ 120, mais 30 min). Qual horário fica melhor?
              </In>
              <Out time="10:04">16h30, e pode incluir o peeling</Out>
              <In time="10:04">
                Marcado! ✨ <strong>Quinta, das 16h30 às 18h: limpeza de pele + peeling leve com a Dra. Paula.</strong> Até lá, Carla! 💛
              </In>
              <Sys>Agendamento criado na agenda da Dra. Paula</Sys>
              <Notice title="Novo agendamento pelo WhatsApp" body="Carla Souza · Limpeza de pele + Peeling leve · qui 16h30 · Dra. Paula" />
              <Sys>
                <strong>O que chegou no seu painel.</strong> Na agenda, na ficha da cliente e no aviso, na hora.
              </Sys>
              <p className="mx-auto w-[94%] rounded-lg bg-[#FFF8DF] px-3 py-2 text-center text-[12px] leading-snug text-[#6B4A12]">
                Conversa de exemplo: nomes, preços e horários são ilustrativos. O formato é o que a Ana faz de verdade.
              </p>
              <DarkCard {...CARD_1} className="my-3.5 lg:hidden" />

              <Scene>Quarta · 10h00 · Lembrete da véspera</Scene>
              <In time="10:00">Oi, Carla! Passando para lembrar do seu horário de limpeza de pele + peeling leve amanhã, 15/10 às 16:30, com Dra. Paula aqui na Clínica Bella. Se precisar remarcar, é só responder esta mensagem. Até lá! 💛</In>
              <Out time="10:12">ai, amanhã não vou conseguir 😕</Out>
              <In time="10:12">Sem problema! Tenho sábado às 9h ou terça às 15h, com a Dra. Paula. Qual fica melhor?</In>
              <Out time="10:13">sábado 9h</Out>
              <In time="10:13">Pronto, remarcado pra sábado às 9h ✅ Até sábado, Carla! 💛</In>
              <Sys>Quinta 16h30 liberada na agenda · sábado 9h reservado</Sys>

              <Scene>Segunda · 14h20 · Outra cliente</Scene>
              <Out time="14:20">fiz botox semana passada e tá um pouco inchado do lado esquerdo, é normal?</Out>
              <In time="14:20">Entendi, Juliana, obrigada por avisar. Isso quem responde é a nossa equipe: já passei sua mensagem e alguém te responde por aqui o quanto antes, tá? 💛</In>
              <Sys>Conversa transferida para a equipe · urgência alta · alguém da clínica assume pelo painel</Sys>
              <DarkCard {...CARD_2} className="my-3.5 lg:hidden" />
            </Phone>

            <aside className="hidden self-stretch lg:block">
              <div className="space-y-5 lg:top-24 lg:[@media(min-height:820px)]:sticky">
                <DarkCard {...CARD_1} />
                <DarkCard {...CARD_2} />
              </div>
            </aside>
          </div>
        </section>

        {/* ── Você para de… ──────────────────────────────────────── */}
        <section className="py-10 sm:py-16">
          <div className={NARROW}>
            <div className="md:text-center">
              <Eyebrow>O que muda no seu dia</Eyebrow>
              <h2 className={`${T} mt-2 text-[44px] font-black tracking-[-0.02em] text-[#062B30] sm:text-[56px]`}>Você para de…</h2>
            </div>
            <div className="mt-6 grid gap-x-8 gap-y-4 sm:mt-10 sm:grid-cols-2 sm:gap-y-6 lg:grid-cols-3">
              {VOCE_PARA.map(([t, d]) => (
                <div key={t} className="flex gap-3 border-t-2 border-[#F0C48A] pt-3">
                  <span className="text-[#0E6E6A]">{CHECK}</span>
                  <div className="min-w-0">
                    <p className={`${T} text-[18px] font-bold leading-[1.2] text-[#062B30]`}>{t}</p>
                    <p className="mt-1 text-[15px] leading-[1.4] text-[#5F6B68]">{d}</p>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-10 grid gap-3.5 md:mt-14 md:grid-cols-2 md:gap-5">
              <div className="rounded-3xl bg-[#0E6E6A] p-6 text-white sm:p-7">
                <h3 className={`${T} text-[26px] font-black`}>É pra você se…</h3>
                <ul className="mt-4 space-y-3 text-[16px] leading-snug">
                  {[
                    "suas clientes marcam, remarcam e tiram dúvida pelo WhatsApp",
                    "você perde mensagem fora do horário ou demora para responder",
                    "tem falta que ninguém confirmou e horário vazio que custou caro",
                    "quer manter o número que as clientes já têm salvo",
                  ].map((t) => (
                    <li key={t} className="flex gap-3"><span className="text-[#F0C48A]">{CHECK}</span>{t}</li>
                  ))}
                </ul>
              </div>
              <div className="rounded-3xl border border-[#E4DED3] bg-white p-6 sm:p-7">
                <h3 className={`${T} text-[26px] font-black text-[#062B30]`}>Não é pra você se…</h3>
                <ul className="mt-4 space-y-3 text-[16px] leading-snug text-[#14211F]">
                  {[
                    "quer um robô de “digite 1 para agendar”: a Ana conversa, não dá menu",
                    "quer disparar promoção em massa para lista comprada: ela atende e reativa as suas clientes, com regra",
                    "quer que a assistente dê orientação clínica: dúvida de saúde vai sempre para a sua equipe",
                  ].map((t) => (
                    <li key={t} className="flex gap-3"><span className="text-[#C2412F]">{CROSS}</span>{t}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* ── Como começa ────────────────────────────────────────── */}
        <section className="border-y border-[#E4DED3] bg-[#F3F0E8] py-10 sm:py-16">
          <div className={NARROW}>
            <h2 className={`${T} text-[24px] font-black leading-[1.1] tracking-[-0.01em] text-[#062B30] sm:text-[40px] md:text-center`}>
              Como começa. Sem trocar de número, sem app.
            </h2>
            <ol className="mt-5 grid gap-4 sm:mt-10 sm:grid-cols-2 sm:gap-8 lg:grid-cols-4">
              {PASSOS.map(([t, d], i) => (
                <li key={t} className="flex gap-3 sm:block">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#062B30] text-[13px] font-bold text-[#F0C48A] sm:h-8 sm:w-8 sm:text-[14px]">{i + 1}</span>
                  <div className="min-w-0">
                    <p className={`${T} text-[17px] font-bold leading-tight text-[#062B30] sm:mt-3 sm:text-[20px]`}>{t}</p>
                    <p className="mt-1 text-[14px] leading-[1.4] text-[#5F6B68] sm:text-[15px]">{d}</p>
                  </div>
                </li>
              ))}
            </ol>
            <p className="mt-8 text-[15px] font-semibold text-[#0E6E6A] md:text-center">
              Nada para a cliente baixar. Ela continua mandando mensagem para o mesmo número de sempre.
            </p>
          </div>
        </section>

        {/* ── A conta ────────────────────────────────────────────── */}
        <section id="conta" className="scroll-mt-6 bg-[#062B30] py-10 text-[#FAF9F6] sm:py-16">
          <div className={NARROW}>
            <div className="md:text-center">
              <Eyebrow dark>A conta que ninguém faz na sua frente</Eyebrow>
              <h2 className={`${T} mt-2 max-w-[20ch] text-[38px] font-black leading-[1.02] tracking-[-0.02em] sm:text-[52px] md:mx-auto`}>
                Hoje, a sua agenda tem dois vazamentos.
              </h2>
              <p className="mt-4 max-w-2xl text-[16px] leading-[1.45] text-[#FAF9F6]/85 sm:text-[17px] md:mx-auto">
                A mensagem que ninguém respondeu e a falta que ninguém confirmou. Os dois crescem junto com a clínica. A VesaliusX não cobra por atendimento nem por agendamento: é uma mensalidade fixa por clínica, com franquia de IA inclusa. No plano inicial, cerca de {perDay(inicial.monthlyBrl)} por dia.
              </p>
            </div>
            <div className="mt-8 grid gap-3 sm:mt-10 lg:grid-cols-3 lg:gap-4">
              {[
                ["Recepcionista só pro WhatsApp", "R$ 2,5 a 3,5 mil", "por mês, com encargos", false],
                ["Uma falta na agenda", "R$ 150 a 1.200", "por horário vazio, com profissional e sala parados", false],
                ["Com a VesaliusX", `${perDay(inicial.monthlyBrl)} por dia`, `no ${inicial.name}, com franquia de IA e mensagens inclusa, atendendo 24 horas`, true],
              ].map(([l, n, d, hi]) => (
                <div key={String(l)} className={`rounded-3xl border p-5 ${hi ? "border-[#F0C48A]/70 bg-[#0E6E6A]/30" : "border-[#FAF9F6]/20 bg-white/[0.04]"}`}>
                  <p className={`text-[12px] font-bold uppercase tracking-[0.14em] lg:min-h-[2.6em] ${hi ? "text-[#F0C48A]" : "text-[#FAF9F6]/75"}`}>{l}</p>
                  <p className={`${T} mt-2 whitespace-nowrap text-[30px] font-black leading-none lg:text-[32px] ${hi ? "text-[#F0C48A]" : "text-[#FF8A6B]"}`}>{n}</p>
                  <p className="mt-2 text-[13px] text-[#FAF9F6]/80">{d}</p>
                </div>
              ))}
            </div>

            <div className="mt-8 grid items-start gap-8 sm:mt-10 lg:grid-cols-[1.25fr_0.75fr]">
              <div>
                <VolumeCalculator
                  plans={PLANS.map((p) => ({ name: p.name, monthlyBrl: p.monthlyBrl, apiAllowanceBrl: p.apiAllowanceBrl }))}
                  overageMarkup={COMMERCIAL_RULES.apiOverageMarkup}
                />
                <div className="mt-6 lg:hidden">
                  <CtaButton>Quero parar de perder horário</CtaButton>
                </div>
              </div>
              <div className="order-first lg:sticky lg:top-24 lg:order-none">
                <p className={`${T} text-[24px] font-black leading-[1.1] tracking-[-0.01em] sm:text-[30px]`}>
                  Cada falta é uma profissional parada e uma sala vazia.
                </p>
                <p className="mt-3 text-[15px] leading-[1.45] text-[#FAF9F6]/85 sm:text-[16px]">
                  E ninguém te manda a conta. Escolha o tamanho da equipe, quantos atendimentos você faz por mês e o valor médio. A conta soma a mensalidade e o uso estimado de IA e de mensagens oficiais, já descontando a franquia do plano.
                </p>
                <div className="mt-6 hidden lg:block">
                  <CtaButton>Quero parar de perder horário</CtaButton>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── Preço ──────────────────────────────────────────────── */}
        <section id="planos" className="bg-[#F3F0E8] py-10 sm:py-16">
          <div className={WIDE}>
            <div className="md:text-center">
              <Eyebrow>Preço, sem letra miúda</Eyebrow>
              <h2 className={`${T} mt-2 text-[40px] font-black leading-[1.02] tracking-[-0.02em] text-[#062B30] sm:text-[60px]`}>
                {brl(inicial.monthlyBrl)} por mês. Sem fidelidade.
              </h2>
              <p className="mt-4 max-w-2xl text-[16px] leading-[1.45] text-[#5F6B68] sm:text-[17px] md:mx-auto">
                É o plano inicial, para quem atende sozinha ou com mais uma profissional, já com franquia de IA e mensagens. Implantação de {brl(SETUP_FEE.brl)} em até {SETUP_FEE.installments}× (grátis no anual à vista). No mensal, sem fidelidade e com garantia de {COMMERCIAL_RULES.guaranteeDays} dias.
              </p>
            </div>

            <div className="mt-10 grid gap-3.5 lg:mt-12 lg:grid-cols-3 lg:gap-5">
              {PLANS.map((p, i) => {
                const vol = REF_VOLUME[p.id] ?? 300;
                const recuperado = Math.round(vol * (FALTA_SEM - FALTA_COM) * TICKET_REF);
                return (
                  <Fragment key={p.id}>
                    {i > 0 ? (
                      <div className={`rounded-[18px] border-[1.5px] bg-white px-4 py-3.5 lg:hidden ${p.highlight ? "border-[#0E6E6A]" : "border-[#E4DED3]"}`}>
                        <div className="flex items-baseline justify-between gap-3">
                          <p className={`${T} text-[18px] font-black text-[#062B30]`}>
                            {p.name}
                            {p.highlight ? <span className="ml-2 align-middle rounded-full bg-[#F0C48A] px-2 py-0.5 font-[family-name:var(--font-v-corpo)] text-[10px] font-bold uppercase tracking-[0.1em] text-[#3B2A10]">Mais escolhido</span> : null}
                          </p>
                          <p className={`${T} shrink-0 text-[22px] font-black leading-none`}>
                            {brl(p.monthlyBrl)}<span className="text-[12px] font-semibold text-[#5F6B68]">/mês</span>
                          </p>
                        </div>
                        <p className="mt-0.5 text-[13px] text-[#5F6B68]">{limites(p)}</p>
                        <p className="mt-1.5 text-[13.5px] leading-snug text-[#3D4A47]">{p.features.slice(1, 4).join(" · ")}</p>
                      </div>
                    ) : null}
                    <div className={`${i > 0 ? "hidden lg:flex" : "flex"} relative flex-col rounded-3xl border bg-white p-6 sm:p-7 ${p.highlight ? "border-[#0E6E6A] shadow-[0_30px_60px_-30px_rgba(14,110,106,0.55)]" : "border-[#E4DED3]"}`}>
                      {p.highlight ? <span className="absolute -top-3 left-6 rounded-full bg-[#F0C48A] px-3 py-1 text-[11px] font-bold uppercase tracking-[0.12em] text-[#3B2A10]">Mais escolhido</span> : null}
                      {i === 0 ? <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#0E6E6A]">Plano inicial</p> : null}
                      <h3 className={`${T} text-[24px] font-black text-[#062B30]`}>{p.name}</h3>
                      <p className="text-[14px] text-[#5F6B68]">{limites(p)}</p>
                      <p className="mt-4 flex items-end gap-1">
                        <span className="mb-2 text-[16px] font-bold">R$</span>
                        <span className={`${T} text-[56px] font-black leading-none tracking-[-0.03em]`}>{p.monthlyBrl}</span>
                        <span className="mb-2 ml-1 text-[14px] text-[#5F6B68]">/mês por clínica</span>
                      </p>
                      <div className="mt-4 grid grid-cols-2 gap-2">
                        <div className="rounded-2xl bg-[#F3F0E8] p-3">
                          <p className="text-[#0E6E6A]"><span className={`${T} text-[22px] font-black`}>{perDay(p.monthlyBrl)}</span> <span className="text-[12px] font-semibold">/dia</span></p>
                          <p className="text-[12px] leading-snug text-[#5F6B68]">atendendo 24 horas</p>
                        </div>
                        <div className="rounded-2xl bg-[#F3F0E8] p-3">
                          <p className="text-[#0E6E6A]"><span className={`${T} text-[22px] font-black`}>{brl(p.apiAllowanceBrl)}</span> <span className="text-[12px] font-semibold">/mês</span></p>
                          <p className="text-[12px] leading-snug text-[#5F6B68]">de IA e mensagens inclusos</p>
                        </div>
                      </div>
                      <p className="mt-4 text-[14px] text-[#3D4A47]">
                        Com {vol} atendimentos, a confirmação de véspera pode devolver cerca de <strong className="text-[#0E6E6A]">{brl(recuperado)}</strong> por mês.
                      </p>
                      <ul className="mt-4 space-y-1.5 border-t border-[#E4DED3] pt-4 text-[14.5px] text-[#3D4A47]">
                        {p.features.map((f) => (
                          <li key={f} className="flex gap-2"><span className="text-[#0E6E6A]">{CHECK}</span>{f}</li>
                        ))}
                      </ul>
                    </div>
                  </Fragment>
                );
              })}
            </div>
            <p className="mt-3 text-[12px] text-[#5F6B68]">
              Conta por plano com atendimento médio de {brl(TICKET_REF)} e faltas caindo de {pct(FALTA_SEM)} para {pct(FALTA_COM)} com o lembrete de véspera. Estimativa, não promessa.
            </p>

            <p className="mt-6 flex gap-3 text-[15.5px] leading-relaxed text-[#14211F]">
              <span className="text-[#0E6E6A]">{CHECK}</span>
              <span>
                <strong>Implantação {brl(SETUP_FEE.brl)}</strong> <span className="text-[#5F6B68] line-through">{brl(SETUP_FEE.listBrl)}</span>, em até {SETUP_FEE.installments}×, e grátis no anual à vista. Inclui catálogo, equipe, horários, importação das clientes, base de conhecimento, conexão do WhatsApp e treinamento.
              </span>
            </p>

            <div className="mt-6 rounded-3xl border border-[#E4DED3] bg-white p-6 md:text-center sm:p-8">
              <CtaButton big>Quero na minha clínica</CtaButton>
              <p className="mt-4 max-w-2xl text-[14.5px] text-[#3D4A47] md:mx-auto">
                <strong>Sem fidelidade no mensal. Cancela quando quiser.</strong> Garantia de {COMMERCIAL_RULES.guaranteeDays} dias no mensal: não gostou, devolvemos a mensalidade.{" "}
                <a href="#conta" className="font-semibold text-[#0E6E6A] underline underline-offset-2">Ver a conta no meu volume ↑</a>
              </p>
              <div className="mt-4 flex md:justify-center">
                <Pin>Só oferece horário que está livre de verdade.</Pin>
              </div>
            </div>

            <div className="mt-6 grid gap-1.5 text-[13px] text-[#5F6B68] sm:grid-cols-3">
              {PLANS.map((p) => (
                <p key={p.id}>
                  <strong className="text-[#14211F]">{p.name}:</strong> semestral <strong className="text-[#0E6E6A]">{brl(semiannualUpfrontTotal(p))}</strong> adiantado (6 × {brl(semiannualUpfrontMonthly(p))}) · anual <strong className="text-[#0E6E6A]">{brl(annualUpfrontTotal(p))}</strong> adiantado (12 × {brl(annualUpfrontMonthly(p))})
                </p>
              ))}
            </div>

            <div className="mt-10 grid items-start gap-8 md:grid-cols-2">
              <ul className="space-y-4 text-[15.5px] leading-relaxed text-[#14211F]">
                <li className="flex gap-3"><span className="text-[#0E6E6A]">{CHECK}</span><span><strong>Entrada suave:</strong> no Profissional com fidelidade de {COMMERCIAL_RULES.rampRequiresMonths} meses (pagando mês a mês), os {COMMERCIAL_RULES.rampMonths} primeiros meses saem por {brl(COMMERCIAL_RULES.rampPriceBrl)}, enquanto a equipe se acostuma.</span></li>
                <li className="flex gap-3"><span className="text-[#0E6E6A]">{CHECK}</span><span><strong>Semestral e anual</strong> têm {pct(COMMERCIAL_RULES.semiannualUpfrontDiscount)} e {pct(COMMERCIAL_RULES.annualUpfrontDiscount)} de desconto, pagos adiantados. Reajuste anual pelo {COMMERCIAL_RULES.indexation}.</span></li>
              </ul>
              <div className="rounded-3xl bg-[#062B30] p-6 text-[#FAF9F6] sm:p-7">
                <h3 className={`${T} text-[24px] font-black leading-tight`}>
                  O que fica por sua conta
                  <br />
                  <span className="text-[#F0C48A]">dito antes, não depois</span>
                </h3>
                <p className="mt-4 text-[15.5px] leading-relaxed text-[#FAF9F6]/90">
                  <strong className="text-[#F0C48A]">Uso acima da franquia.</strong> Quando a IA e as mensagens oficiais passam da franquia do plano, você escolhe em Configurações: liberar, e o excedente entra na mensalidade seguinte com {pct(COMMERCIAL_RULES.apiOverageMarkup)} de acréscimo; ou não liberar, e aí a Ana passa as conversas para a equipe e os lembretes automáticos param até virar o mês. O gasto aparece em tempo real no painel, com aviso em 80% e 100%.
                </p>
                <p className="mt-4 text-[15.5px] leading-relaxed text-[#FAF9F6]/90">
                  <strong className="text-[#F0C48A]">Tarifa da Meta.</strong> Só nas mensagens que a clínica inicia fora da janela de 24 horas: lembrete de véspera cerca de R$ 0,04, reativação cerca de R$ 0,35. Mensagem que a cliente manda, e a resposta em até 24 horas, não custam nada.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* ── FAQ ────────────────────────────────────────────────── */}
        <section className="py-10 sm:py-16">
          <div className={NARROW}>
            <Eyebrow>Antes de decidir</Eyebrow>
            <h2 className={`${T} mt-2 text-[30px] font-black leading-[1.05] tracking-[-0.01em] text-[#062B30] sm:text-[38px]`}>
              As perguntas que toda dona de clínica faz antes de ligar
            </h2>
            <div className="mt-5 border-t border-[#E4DED3] sm:mt-8">
              {FAQ.map(([q, a], i) => (
                <details key={q} open={i === 0} className="group border-b border-[#E4DED3]">
                  <summary className={`${T} flex cursor-pointer list-none items-center justify-between gap-4 py-3.5 text-[16.5px] font-bold leading-snug text-[#062B30] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0E6E6A] sm:text-[18px] [&::-webkit-details-marker]:hidden`}>
                    {q}
                    <svg viewBox="0 0 20 20" className="h-5 w-5 shrink-0 fill-none stroke-[#0E6E6A] stroke-[2.4] transition-transform group-open:rotate-180" aria-hidden><path d="M5 8l5 5 5-5" /></svg>
                  </summary>
                  <p className="max-w-3xl pb-4 text-[15px] leading-[1.5] text-[#3D4A47] sm:text-[16px]">{a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* ── Quem responde ──────────────────────────────────────── */}
        <section className="bg-[#0E6E6A] py-10 text-white">
          <div className={`${NARROW} flex flex-col items-start gap-5 sm:flex-row sm:items-center`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/marca/ana-avatar.webp" alt="" width={96} height={96} loading="lazy" className="h-24 w-24 shrink-0 rounded-full bg-[#F3E9DD] object-cover ring-4 ring-[#F0C48A]/70" />
            <div>
              <p className="text-[12.5px] font-bold uppercase tracking-[0.16em] text-[#FFE2B8]">Quem responde no WhatsApp</p>
              <p className="mt-1.5 text-[16px] leading-relaxed text-white">
                Quem responde é a equipe da Billions Technology, que faz a VesaliusX. Razão social e CNPJ estão no rodapé e nos Termos de Uso.
              </p>
              <a href={CTA_URL} target="_blank" rel="noreferrer" className="mt-2 inline-block text-[15px] font-semibold text-[#FFE2B8] underline underline-offset-4">
                WhatsApp da equipe: {SALES.whatsappDisplay}
              </a>
            </div>
          </div>
        </section>

        {/* ── CTA final ──────────────────────────────────────────── */}
        <section id="contato" className="relative overflow-hidden bg-[#C2412F] pt-12 text-white sm:pt-20">
          <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_60%_at_85%_90%,rgba(0,0,0,0.18),transparent_70%)]" />
          <div className={`${NARROW} relative grid items-end gap-6 lg:grid-cols-[1.2fr_0.8fr]`}>
            <div className="pb-8 sm:pb-20">
              <p className="text-[12.5px] font-bold uppercase tracking-[0.16em] text-white">Todo sábado, 10h</p>
              <h2 className={`${T} mt-2 text-[36px] font-black leading-[1] tracking-[-0.02em] sm:text-[56px]`}>
                O WhatsApp da clínica vai apitar de qualquer jeito. A diferença é quem vai responder.
              </h2>
              <p className="mt-3 text-[17px] text-white">A próxima mensagem pode ser a primeira que a Ana responde.</p>
              <ol className="mt-7 space-y-3.5 text-[16px] leading-snug">
                {[
                  "Toque no botão: abre a conversa no WhatsApp com a mensagem pronta.",
                  "Diga o nome da clínica e a cidade. Só isso.",
                  "A gente responde e combina com você a conexão do número, o catálogo e os horários.",
                ].map((t, i) => (
                  <li key={t} className="flex gap-3">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white text-[13px] font-bold text-[#C2412F]">{i + 1}</span>
                    <span className="pt-0.5">{t}</span>
                  </li>
                ))}
              </ol>
              <div className="mt-8">
                <CtaButton big light>Falar no WhatsApp</CtaButton>
              </div>
              <p className="mt-4 text-[14px] text-white">
                Sem cartão. Sem compromisso. Só uma mensagem. <strong>Sem fidelidade no mensal.</strong> <strong className="whitespace-nowrap">Garantia de {COMMERCIAL_RULES.guaranteeDays} dias.</strong>
              </p>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/marca/ana.webp" alt="" width={408} height={612} loading="lazy" className="mx-auto hidden h-auto w-[300px] self-end drop-shadow-[0_30px_40px_rgba(0,0,0,0.35)] lg:block" />
          </div>
        </section>
      </main>

      {/* ── Rodapé ─────────────────────────────────────────────── */}
      <footer className="bg-[#03191C] pb-8 pt-8 text-[#FAF9F6]/75">
        <div className={NARROW}>
          <p className="flex flex-wrap items-center gap-2.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/marca/ana-avatar.webp" alt="" width={28} height={28} loading="lazy" className="h-7 w-7 rounded-full bg-[#F3E9DD] object-cover" />
            <span className={`${T} text-[17px] font-black text-white`}>Vesalius<span className="text-[#F0C48A]">X</span></span>
            <span className={`${T} text-[13px] font-semibold text-[#FAF9F6]/65`}>powered by Billions Technology</span>
          </p>
          <nav className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-[14px] text-[#F0C48A]">
            <Link href="/privacidade" className="hover:underline">Privacidade</Link>
            <Link href="/exclusao-de-dados" className="hover:underline">Exclusão de dados</Link>
            <Link href="/termos-de-uso" className="hover:underline">Termos</Link>
            <Link href="/" className="text-[#FAF9F6]/85 hover:underline">vesaliusx.com.br</Link>
          </nav>
          <p className="mt-4 text-[12.5px] leading-relaxed text-[#FAF9F6]/60">
            © 2026 VesaliusX · 53.133.495 CESAR EUSTAQUIO DA FONSECA FILHO - ME · CNPJ 53.133.495/0001-93. WhatsApp é marca da Meta Platforms. Não somos afiliados à Meta.
          </p>
        </div>
      </footer>

      <StickyCta href={CTA_URL} price={`${brl(inicial.monthlyBrl)}/mês`} />
    </>
  );
}
