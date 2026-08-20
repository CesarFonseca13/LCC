"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Banknote,
  BarChart3,
  Brain,
  CalendarDays,
  CheckSquare,
  FileSignature,
  FileText,
  Filter,
  Home,
  MessageCircle,
  Package,
  Settings,
  Sparkles,
  Users,
  UsersRound,
} from "lucide-react";

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

interface NavGroup {
  label: string | null;
  items: NavItem[];
}

const GROUPS: NavGroup[] = [
  {
    label: "Meu dia",
    items: [
      { href: "/inicio", label: "Início", icon: Home },
      { href: "/agenda", label: "Agenda", icon: CalendarDays },
      { href: "/whatsapp", label: "WhatsApp", icon: MessageCircle },
      { href: "/aprovacoes", label: "Aprovações", icon: CheckSquare },
    ],
  },
  {
    label: "Clientes",
    items: [
      { href: "/clientes", label: "Clientes", icon: Users },
      { href: "/funil", label: "Funil de Vendas", icon: Filter },
      { href: "/inteligencia", label: "Inteligência", icon: Brain },
    ],
  },
  {
    label: "Vendas",
    items: [
      { href: "/orcamentos", label: "Orçamentos", icon: FileText },
      { href: "/termos", label: "Termos", icon: FileSignature },
      { href: "/servicos", label: "Serviços", icon: Sparkles },
      { href: "/estoque", label: "Estoque", icon: Package },
    ],
  },
  {
    label: "Gestão",
    items: [
      { href: "/automacoes", label: "Automações", icon: Sparkles },
      { href: "/financeiro", label: "Financeiro", icon: Banknote },
      { href: "/relatorios", label: "Relatórios", icon: BarChart3 },
    ],
  },
  {
    label: null,
    items: [
      { href: "/equipe", label: "Equipe", icon: UsersRound },
      { href: "/configuracoes", label: "Configurações", icon: Settings },
    ],
  },
];

export function Sidebar({ approvalsCount = 0 }: { approvalsCount?: number }) {
  const pathname = usePathname();

  return (
    <aside className="flex h-full w-60 flex-col border-r border-stone-200 bg-white">
      <div className="flex h-14 items-center px-5">
        <span className="text-lg font-semibold tracking-tight text-teal-800">
          ClinicaOS
        </span>
      </div>
      <nav className="flex-1 space-y-5 overflow-y-auto px-3 pb-6">
        {GROUPS.map((group, i) => (
          <div key={group.label ?? `group-${i}`}>
            {group.label ? (
              <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-stone-400">
                {group.label}
              </p>
            ) : (
              <div className="mx-2 mb-2 border-t border-stone-200" />
            )}
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const active =
                  pathname === item.href || pathname.startsWith(`${item.href}/`);
                const Icon = item.icon;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={
                        active
                          ? "flex items-center gap-2.5 rounded-lg bg-teal-50 px-2.5 py-2 text-sm font-medium text-teal-800"
                          : "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-stone-600 transition hover:bg-stone-100 hover:text-stone-900"
                      }
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      <span className="flex-1">{item.label}</span>
                      {item.href === "/aprovacoes" && approvalsCount > 0 ? (
                        <span className="rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white">
                          {approvalsCount}
                        </span>
                      ) : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
    </aside>
  );
}
