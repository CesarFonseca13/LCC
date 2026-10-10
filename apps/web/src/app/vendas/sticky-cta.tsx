"use client";

import { useEffect, useState } from "react";

/**
 * Barra fixa no rodapé, só no celular: aparece quando o CTA do hero sai da tela
 * e some quando o CTA final aparece (para não repetir o botão).
 */
export function StickyCta({ href, price }: { href: string; price: string }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    let heroOn = true;
    let fimOn = false;
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.target.id === "cta-hero") heroOn = e.isIntersecting;
        else fimOn = e.isIntersecting;
      }
      setShow(!heroOn && !fimOn);
    });
    for (const id of ["cta-hero", "contato"]) {
      const el = document.getElementById(id);
      if (el) io.observe(el);
    }
    return () => io.disconnect();
  }, []);
  return (
    <div
      aria-hidden={!show}
      inert={!show}
      className={`fixed inset-x-0 bottom-0 z-40 border-t border-[#E4DED3] bg-[#FAF9F6]/95 px-3 pb-[max(0.625rem,env(safe-area-inset-bottom))] pt-2.5 backdrop-blur-md transition-transform duration-300 md:hidden ${show ? "translate-y-0" : "translate-y-full"}`}
    >
      <div className="mx-auto flex max-w-[640px] items-center gap-2.5">
        <p className="w-[104px] shrink-0 text-[11px] leading-[1.2] text-[#5F6B68]">
          <span className="block font-[family-name:var(--font-v-titulo)] text-[17px] font-black leading-none text-[#062B30]">{price}</span>
          <span className="mt-0.5 block">plano inicial</span>
          <span className="block">sem fidelidade</span>
        </p>
        <a
          href={href}
          tabIndex={show ? 0 : -1}
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-[50px] flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-full bg-[#C2412F] px-3 text-[14px] font-bold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0E6E6A] focus-visible:ring-offset-2 min-[380px]:text-[14.5px]"
        >
          Quero na minha clínica <span aria-hidden>→</span>
        </a>
      </div>
    </div>
  );
}
