import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  // Não pré-carrega: a página de vendas usa outras fontes e não deve disputar banda com elas
  preload: false,
});

export const metadata: Metadata = {
  // Fixo no código: o build do Docker roda sem .env e as URLs de og:image precisam ser absolutas
  metadataBase: new URL("https://vesaliusx.com.br"),
  title: {
    default: "VesaliusX",
    template: "%s — VesaliusX",
  },
  description: "Gestão e atendimento da sua clínica em um só lugar",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body className={`${inter.variable} font-sans antialiased`}>{children}</body>
    </html>
  );
}
