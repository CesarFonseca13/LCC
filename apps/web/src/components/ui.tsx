"use client";

import { useEffect, useRef } from "react";

/** Primitivas de UI do painel — consistência visual sem dependência externa. */

export function Button({
  variant = "primary",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
}) {
  const styles: Record<string, string> = {
    primary:
      "bg-teal-700 text-white hover:bg-teal-800 disabled:opacity-60 shadow-sm",
    secondary:
      "border border-stone-300 bg-white text-stone-700 hover:bg-stone-50 disabled:opacity-60",
    ghost: "text-stone-500 hover:bg-stone-100 hover:text-stone-800",
    danger: "text-red-600 hover:bg-red-50",
  };
  return (
    <button
      {...props}
      className={`rounded-lg px-3.5 py-2 text-sm font-medium transition ${styles[variant]} ${className}`}
    />
  );
}

export function Input({
  invalid = false,
  className = "",
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & {
  /** Destaque âmbar (campo em falta/inválido). Troca a borda base em vez de
   *  empilhar duas classes de cor — a ordem do CSS gerado decidiria qual vence. */
  invalid?: boolean;
}) {
  return (
    <input
      {...props}
      className={`w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 disabled:bg-stone-50 read-only:bg-stone-100 read-only:text-stone-600 ${
        invalid
          ? "border-amber-300 bg-amber-50 focus:border-amber-500 focus:ring-amber-100"
          : "border-stone-300 focus:border-teal-600 focus:ring-teal-100"
      } ${className}`}
    />
  );
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={`w-full rounded-lg border border-stone-300 px-3 py-2 text-sm outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-100 ${props.className ?? ""}`}
    />
  );
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-100 ${props.className ?? ""}`}
    />
  );
}

export function Label({
  hint,
  children,
  ...props
}: React.LabelHTMLAttributes<HTMLLabelElement> & { hint?: string }) {
  return (
    <label {...props} className="block">
      <span className="text-sm font-medium text-stone-700">{children}</span>
      {hint ? <span className="ml-1.5 text-xs text-stone-400">{hint}</span> : null}
    </label>
  );
}

export function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="mt-1 text-xs text-red-600">{message}</p>;
}

export function Modal({
  open,
  onClose,
  title,
  children,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  /** "lg" para formulários com tabela/linhas de itens (orçamento, etc.). */
  size?: "md" | "lg";
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      // React não escreve o atributo `autofocus` e o foco feito no mount cai
      // num <dialog> ainda fechado; showModal() foca o "✕" por ser o primeiro
      // focável. Campo marcado com data-autofocus recebe o foco aqui.
      dialog.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={onClose}
      className={`m-auto w-full rounded-xl border border-stone-200 bg-white p-0 shadow-xl backdrop:bg-stone-900/30 ${
        size === "lg" ? "max-w-3xl" : "max-w-lg"
      }`}
    >
      {open ? (
        <div className="max-h-[85vh] overflow-y-auto p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-semibold text-stone-800">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Fechar"
              className="rounded-lg px-2 py-1 text-stone-400 hover:bg-stone-100 hover:text-stone-700"
            >
              ✕
            </button>
          </div>
          {children}
        </div>
      ) : null}
    </dialog>
  );
}

export function EmptyState({
  title,
  action,
}: {
  title: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-stone-300 bg-white px-6 py-14 text-center">
      <p className="max-w-md text-sm text-stone-600">{title}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
