"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Banknote,
  BarChart3,
  BookOpen,
  Brain,
  Briefcase,
  CalendarDays,
  CheckSquare,
  ChevronDown,
  ClipboardList,
  FileSignature,
  FileText,
  Filter,
  Home,
  LogOut,
  Megaphone,
  MessageCircle,
  Package,
  Settings,
  Sparkles,
  Users,
  UsersRound,
} from "lucide-react";
import { logoutAction } from "@/app/login/actions";

type IconType = React.ComponentType<{ className?: string }>;

interface LeafItem {
  href: string;
  label: string;
  icon: IconType;
}

interface NavEntry {
  label: string;
  icon: IconType;
  href?: string;
  children?: LeafItem[];
}

const NAV: NavEntry[] = [
  { href: "/inicio", label: "Início", icon: Home },
  { href: "/agenda", label: "Agenda", icon: CalendarDays },
  { href: "/atendimentos", label: "Atendimentos", icon: ClipboardList },
  { href: "/whatsapp", label: "WhatsApp", icon: MessageCircle },
  { href: "/aprovacoes", label: "Aprovações", icon: CheckSquare },
  {
    label: "Clientes",
    icon: Users,
    children: [
      { href: "/clientes", label: "Clientes", icon: Users },
      { href: "/funil", label: "Funil de Vendas", icon: Filter },
      { href: "/inteligencia", label: "Inteligência", icon: Brain },
    ],
  },
  {
    label: "Vendas",
    icon: FileText,
    children: [
      { href: "/orcamentos", label: "Orçamentos", icon: FileText },
      { href: "/termos", label: "Termos", icon: FileSignature },
      { href: "/servicos", label: "Serviços", icon: Sparkles },
      { href: "/conhecimento", label: "Conhecimento", icon: BookOpen },
      { href: "/estoque", label: "Estoque", icon: Package },
    ],
  },
  {
    label: "Gestão",
    icon: Briefcase,
    children: [
      { href: "/automacoes", label: "Automações", icon: Sparkles },
      { href: "/campanhas", label: "Campanhas", icon: Megaphone },
      { href: "/financeiro", label: "Financeiro", icon: Banknote },
      { href: "/relatorios", label: "Relatórios", icon: BarChart3 },
      { href: "/equipe", label: "Equipe", icon: UsersRound },
    ],
  },
  { href: "/configuracoes", label: "Configurações", icon: Settings },
];

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function TopNav({
  clinicName,
  userName,
  approvalsCount = 0,
  whatsapp,
}: {
  clinicName: string | null;
  userName: string | null;
  approvalsCount?: number;
  /** Ponto de status no ícone do WhatsApp + texto do tooltip. */
  whatsapp: { tone: "ok" | "warn" | "off" | "none"; text: string };
}) {
  const pathname = usePathname();
  // O painel do dropdown é position:fixed (ancorado na coordenada do botão):
  // o <nav> rola horizontalmente e overflow cortaria um painel absoluto.
  const [open, setOpen] = useState<{ label: string; x: number; y: number } | null>(null);

  // Navegou? Fecha qualquer dropdown aberto.
  useEffect(() => setOpen(null), [pathname]);

  const waDot =
    whatsapp.tone === "ok"
      ? "bg-emerald-400"
      : whatsapp.tone === "warn"
        ? "bg-amber-400"
        : whatsapp.tone === "off"
          ? "bg-red-400"
          : null;

  const baseItem =
    "relative flex min-w-[76px] flex-col items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-medium leading-none transition-colors";
  const idle = "text-teal-100/75 hover:bg-white/10 hover:text-white";
  const activeCls = "bg-white/12 text-cyan-300";

  return (
    <header className="relative z-40 border-b border-black/20 bg-gradient-to-b from-[#0b3238] to-[#082a2f] shadow-md">
      <div className="flex h-[68px] items-center gap-4 px-5">
        {/* Marca + clínica */}
        <div className="flex shrink-0 flex-col justify-center pr-2">
          <span className="text-lg font-semibold leading-tight tracking-tight text-white">
            Clinica<span className="text-cyan-300">OS</span>
          </span>
          {clinicName ? (
            <span className="max-w-[140px] truncate text-[11px] leading-tight text-teal-100/60">
              {clinicName}
            </span>
          ) : null}
        </div>

        {/* Navegação */}
        <nav className="flex min-w-0 flex-1 items-center justify-center gap-0.5 overflow-x-auto px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {NAV.map((entry) => {
            const Icon = entry.icon;

            if (entry.href) {
              const active = isActive(pathname, entry.href);
              return (
                <Link
                  key={entry.href}
                  href={entry.href}
                  title={entry.href === "/whatsapp" ? whatsapp.text : undefined}
                  className={`${baseItem} ${active ? activeCls : idle}`}
                >
                  <span className="relative">
                    <Icon className="h-[19px] w-[19px]" />
                    {entry.href === "/whatsapp" && waDot ? (
                      <span
                        className={`absolute -right-1 -top-0.5 h-2 w-2 rounded-full ring-2 ring-[#0a2e34] ${waDot}`}
                      />
                    ) : null}
                    {entry.href === "/aprovacoes" && approvalsCount > 0 ? (
                      <span className="absolute -right-2.5 -top-1.5 rounded-full bg-red-500 px-1 py-0.5 text-[9px] font-bold leading-none text-white">
                        {approvalsCount > 99 ? "99+" : approvalsCount}
                      </span>
                    ) : null}
                  </span>
                  {entry.label}
                </Link>
              );
            }

            const childActive = entry.children!.some((c) => isActive(pathname, c.href));
            const isOpen = open?.label === entry.label;
            return (
              <button
                key={entry.label}
                type="button"
                onClick={(e) => {
                  if (isOpen) {
                    setOpen(null);
                    return;
                  }
                  const rect = e.currentTarget.getBoundingClientRect();
                  setOpen({
                    label: entry.label,
                    x: rect.left + rect.width / 2,
                    y: rect.bottom,
                  });
                }}
                className={`${baseItem} ${childActive ? activeCls : idle}`}
              >
                <Icon className="h-[19px] w-[19px]" />
                <span className="flex items-center gap-0.5">
                  {entry.label}
                  <ChevronDown
                    className={`h-3 w-3 transition-transform ${isOpen ? "rotate-180" : ""}`}
                  />
                </span>
              </button>
            );
          })}
        </nav>

        {/* Usuária + sair */}
        <div className="flex shrink-0 items-center gap-2">
          {userName ? (
            <span className="hidden max-w-[120px] truncate text-xs text-teal-100/60 lg:block">
              {userName}
            </span>
          ) : null}
          <form action={logoutAction}>
            <button
              type="submit"
              title="Sair da conta"
              className={`${baseItem} ${idle} hover:!bg-red-500/15 hover:!text-red-300`}
            >
              <LogOut className="h-[19px] w-[19px]" />
              Sair
            </button>
          </form>
        </div>
      </div>

      {/* Dropdown aberto: overlay fecha no clique fora; painel fixo ancorado no botão */}
      {open ? (
        <>
          <button
            type="button"
            aria-label="Fechar menu"
            onClick={() => setOpen(null)}
            className="fixed inset-0 z-30 h-full w-full cursor-default"
            tabIndex={-1}
          />
          <div
            className="fixed z-50 w-52 -translate-x-1/2 overflow-hidden rounded-xl border border-stone-200 bg-white py-1.5 shadow-xl"
            style={{ left: open.x, top: open.y + 8 }}
          >
            {NAV.find((n) => n.label === open.label)?.children?.map((child) => {
              const ChildIcon = child.icon;
              const active = isActive(pathname, child.href);
              return (
                <Link
                  key={child.href}
                  href={child.href}
                  onClick={() => setOpen(null)}
                  className={
                    active
                      ? "flex items-center gap-2.5 bg-teal-50 px-4 py-2.5 text-sm font-medium text-teal-800"
                      : "flex items-center gap-2.5 px-4 py-2.5 text-sm text-stone-600 hover:bg-stone-50 hover:text-stone-900"
                  }
                >
                  <ChildIcon className="h-4 w-4 shrink-0" />
                  {child.label}
                </Link>
              );
            })}
          </div>
        </>
      ) : null}
    </header>
  );
}
