"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS: [string, string][] = [
  ["/admin", "Visão geral"],
  ["/admin/financeiro", "Financeiro"],
  ["/admin/nova", "Nova clínica"],
  ["/admin/auditoria", "Auditoria"],
];

export function AdminNav() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-wrap gap-1">
      {ITEMS.map(([href, label]) => {
        const active = href === "/admin" ? pathname === "/admin" || pathname.startsWith("/admin/clinicas") : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={`rounded-lg px-3 py-1.5 text-sm ${active ? "bg-stone-700 text-white" : "text-stone-300 hover:bg-stone-800"}`}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
