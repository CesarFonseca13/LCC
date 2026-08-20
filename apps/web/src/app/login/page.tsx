import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getAuth } from "@/lib/session";
import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Entrar — ClinicaOS",
};

export default async function LoginPage() {
  const auth = await getAuth();
  if (auth) redirect("/inicio");

  return (
    <main className="flex min-h-screen items-center justify-center bg-stone-50 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-teal-800">ClinicaOS</h1>
          <p className="mt-1 text-sm text-stone-500">
            Gestão e atendimento da sua clínica em um só lugar
          </p>
        </div>
        <LoginForm />
      </div>
    </main>
  );
}
