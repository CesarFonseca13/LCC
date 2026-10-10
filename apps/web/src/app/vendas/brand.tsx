"use client";

import { useState } from "react";

/**
 * Imagens da marca (logo e a Ana, a personagem). Ficam em apps/web/public/marca/.
 * Se o arquivo ainda não existir, o componente some sem quebrar a página.
 */
export function Mascot({ src = "/marca/ana.png", alt = "Ana, a assistente do VesaliusX", className = "" }: { src?: string; alt?: string; className?: string }) {
  const [ok, setOk] = useState(true);
  if (!ok) return null;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} className={className} onError={() => setOk(false)} draggable={false} />;
}

export function Logo({ className = "h-9" }: { className?: string }) {
  const [ok, setOk] = useState(true);
  if (!ok) {
    return (
      <span className="text-xl font-semibold tracking-tight">
        Vesalius<span className="text-emerald-300">X</span>
      </span>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/marca/logo.png" alt="VesaliusX" className={className} onError={() => setOk(false)} draggable={false} />;
}
