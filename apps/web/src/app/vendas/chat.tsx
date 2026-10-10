/**
 * Mockup do WhatsApp visto do celular da CLIENTE: mensagens dela em verde à
 * direita, respostas da Ana em branco à esquerda. Só marcação, sem estado.
 */

export function Phone({ clinic, children }: { clinic: string; children: React.ReactNode }) {
  return (
    <figure
      aria-label={`Conversa de exemplo no WhatsApp da ${clinic}`}
      className="relative -mx-4 sm:mx-0 sm:rounded-[2.2rem] sm:border-[6px] sm:border-[#E4DED3] sm:bg-[#E4DED3] sm:shadow-[0_30px_60px_-20px_rgba(6,43,48,0.35)]"
    >
      <div className="sticky top-0 z-20 overflow-hidden bg-[#0E6E6A] text-white shadow-[0_2px_10px_rgba(0,0,0,0.18)] sm:rounded-t-[1.8rem]">
        <div aria-hidden className="flex items-center justify-between px-4 pt-2 text-[11px] font-semibold">
          <span>10:02</span>
          <span className="flex items-center gap-1">
            <svg viewBox="0 0 18 12" className="h-3 w-4 fill-current"><rect x="0" y="8" width="3" height="4" rx="1" /><rect x="5" y="5" width="3" height="7" rx="1" /><rect x="10" y="2" width="3" height="10" rx="1" /><rect x="15" y="0" width="3" height="12" rx="1" /></svg>
            <svg viewBox="0 0 26 12" className="h-3 w-6"><rect x="0.5" y="0.5" width="22" height="11" rx="3" fill="none" stroke="currentColor" /><rect x="2.5" y="2.5" width="16" height="7" rx="1.5" fill="currentColor" /><rect x="23.5" y="4" width="2" height="4" rx="1" fill="currentColor" /></svg>
          </span>
        </div>
        <div className="flex items-center gap-3 px-3 pb-3 pt-2">
          <svg viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current stroke-2" aria-hidden><path d="M15 18l-6-6 6-6" /></svg>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/marca/ana-avatar.webp" alt="" width={40} height={40} className="h-10 w-10 rounded-full bg-[#F3E9DD] object-cover ring-2 ring-white/70" />
          <div className="min-w-0 flex-1 leading-tight">
            <p className="truncate text-[15px] font-semibold">{clinic}</p>
            <p className="flex items-center gap-1 text-[12px] text-white/90"><span className="h-1.5 w-1.5 rounded-full bg-[#4ADE80]" />online</p>
          </div>
          <svg viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current stroke-2" aria-hidden><rect x="3" y="6" width="13" height="12" rx="2" /><path d="M16 10l5-3v10l-5-3" /></svg>
          <svg viewBox="0 0 24 24" className="ml-3 h-5 w-5 fill-none stroke-current stroke-2" aria-hidden><path d="M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2" /></svg>
        </div>
      </div>
      <div className="relative space-y-2.5 bg-[#ECE5DD] px-4 pb-6 pt-4 sm:rounded-b-[1.8rem]" style={{ backgroundImage: "radial-gradient(rgba(6,43,48,0.06) 1px, transparent 1px)", backgroundSize: "18px 18px" }}>
        {children}
      </div>
    </figure>
  );
}

const BUBBLE = "relative rounded-xl px-2.5 pb-1.5 pt-2 text-[15.5px] leading-[1.4] text-[#14211F] shadow-[0_1px_1px_rgba(0,0,0,0.08)] before:absolute before:top-0 before:border-[7px] before:border-transparent before:content-['']";

/** Mensagem da cliente (verde, direita). */
export function Out({ time, children }: { time: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-end">
      <div className={`${BUBBLE} max-w-[82%] rounded-tr-none bg-[#DCF8C6] before:-right-[7px] before:border-r-0 before:border-l-[#DCF8C6] before:border-t-[#DCF8C6]`}>
        <span className="sr-only">Cliente: </span>
        {children}
        <span className="mt-0.5 flex items-center justify-end gap-1 text-[11px] text-[#5F6B68]">
          {time}
          <svg viewBox="0 0 18 11" className="h-2.5 w-4 fill-none stroke-[#34B7F1] stroke-[1.6]" aria-hidden><path d="M1 6l3 3 6-7M7 9l1 1 6-8" /></svg>
        </span>
      </div>
    </div>
  );
}

/** Mensagem da Ana (branca, esquerda). */
export function In({ time, children }: { time: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-start">
      <div className={`${BUBBLE} max-w-[86%] rounded-tl-none bg-white before:-left-[7px] before:border-l-0 before:border-r-white before:border-t-white`}>
        <span className="sr-only">Ana: </span>
        {children}
        <span className="mt-0.5 block text-right text-[11px] text-[#5F6B68]">{time}</span>
      </div>
    </div>
  );
}

/** Rótulo de cena (data/hora da conversa). */
export function Scene({ children }: { children: React.ReactNode }) {
  return (
    <p className="mx-auto w-fit rounded-md bg-white/90 px-2.5 py-1 text-center text-[11px] font-semibold uppercase tracking-wide text-[#3D4A47] shadow-sm">
      {children}
    </p>
  );
}

/** Aviso do sistema (o que aconteceu por trás). */
export function Sys({ children }: { children: React.ReactNode }) {
  return <p className="mx-auto w-[92%] rounded-lg bg-white/75 px-3 py-1.5 text-center text-[12.5px] leading-snug text-[#3D4A47]">{children}</p>;
}

/** Selo de comportamento garantido. */
export function Pin({ children }: { children: React.ReactNode }) {
  return (
    <p className="mx-auto flex w-fit items-center gap-2 rounded-full bg-[#F0C48A] px-4 py-1.5 text-[13px] font-semibold text-[#3B2A10] shadow-sm">
      <svg viewBox="0 0 20 20" className="h-4 w-4 shrink-0 fill-none stroke-current stroke-[2.4]" aria-hidden><path d="M4 10.5l3.5 3.5L16 6" /></svg>
      <span className="font-[family-name:var(--font-v-titulo)]">{children}</span>
    </p>
  );
}

/** Cartão de notificação: o que chegou no painel da clínica. */
export function Notice({ title, body }: { title: string; body: string }) {
  return (
    <div className="mx-auto w-[94%] rounded-2xl border border-black/5 bg-[#F7F5F0] p-3.5 shadow-[0_8px_20px_-8px_rgba(0,0,0,0.25)]">
      <div className="flex items-start gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/marca/ana-avatar.webp" alt="" width={36} height={36} loading="lazy" className="h-9 w-9 shrink-0 rounded-xl bg-[#F3E9DD] object-cover" />
        <div className="min-w-0 flex-1">
          <p className="flex justify-between text-[11px] font-semibold uppercase tracking-wide text-[#5F6B68]">
            <span>Painel VesaliusX</span>
            <span className="normal-case">agora</span>
          </p>
          <p className="mt-0.5 text-[14px] font-semibold text-[#14211F]">{title}</p>
          <p className="text-[13px] leading-snug text-[#3D4A47]">{body}</p>
        </div>
      </div>
    </div>
  );
}
