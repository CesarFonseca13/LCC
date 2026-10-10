import { Bitter, Instrument_Sans } from "next/font/google";

const titulo = Bitter({ subsets: ["latin"], weight: ["600", "700", "800", "900"], variable: "--font-v-titulo", display: "swap" });
const corpo = Instrument_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-v-corpo", display: "swap" });

/** Página de vendas: tipografia própria (título serifado pesado + corpo sem serifa). */
export default function VendasLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${titulo.variable} ${corpo.variable} font-[family-name:var(--font-v-corpo)] antialiased`}>
      {children}
    </div>
  );
}
