"use client";

import { useEffect, useState } from "react";

/** Barra fixa no rodapé que aparece depois do primeiro scroll. */
export function StickyCta({ href, label }: { href: string; label: string }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const onScroll = () => setShow(window.scrollY > 600);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return (
    <div className={`fixed inset-x-0 bottom-0 z-40 transition-transform duration-300 ${show ? "translate-y-0" : "translate-y-full"}`}>
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 border-t border-white/10 bg-teal-950/95 px-4 py-3 backdrop-blur sm:rounded-t-2xl">
        <p className="hidden text-sm text-teal-100/80 sm:block">{label}</p>
        <a href={href} target="_blank" rel="noreferrer" className="w-full rounded-xl bg-emerald-400 px-6 py-3 text-center text-sm font-semibold text-teal-950 hover:bg-emerald-300 sm:w-auto">
          Falar no WhatsApp
        </a>
      </div>
    </div>
  );
}
