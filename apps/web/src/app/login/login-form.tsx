"use client";

import { useActionState } from "react";
import { loginAction, type LoginState } from "./actions";

export function LoginForm() {
  const [state, formAction, pending] = useActionState<LoginState, FormData>(
    loginAction,
    {},
  );

  return (
    <form
      action={formAction}
      className="rounded-2xl border border-stone-200/80 bg-white/80 p-7 shadow-xl shadow-teal-900/5 backdrop-blur"
    >
      <label className="block text-sm font-medium text-stone-700" htmlFor="email">
        E-mail
      </label>
      <input
        id="email"
        name="email"
        type="email"
        autoComplete="email"
        required
        defaultValue={state.email ?? ""}
        className="mt-1.5 w-full rounded-xl border border-stone-300 px-3.5 py-2.5 text-sm outline-none transition focus:border-teal-600 focus:ring-4 focus:ring-teal-600/10"
        placeholder="voce@suaclinica.com.br"
      />

      <label
        className="mt-4 block text-sm font-medium text-stone-700"
        htmlFor="password"
      >
        Senha
      </label>
      <input
        id="password"
        name="password"
        type="password"
        autoComplete="current-password"
        required
        className="mt-1.5 w-full rounded-xl border border-stone-300 px-3.5 py-2.5 text-sm outline-none transition focus:border-teal-600 focus:ring-4 focus:ring-teal-600/10"
      />

      {state.error ? (
        <p className="mt-3 rounded-xl bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
          {state.error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="mt-6 w-full rounded-xl bg-teal-700 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-teal-700/25 transition hover:bg-teal-800 hover:shadow-teal-700/35 disabled:opacity-60"
      >
        {pending ? "Entrando..." : "Entrar no painel"}
      </button>
    </form>
  );
}
