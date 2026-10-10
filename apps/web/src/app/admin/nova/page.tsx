import { requireSuperadmin } from "@/lib/admin";
import { NewClinicForm } from "./new-clinic-form";

export default async function AdminNovaClinica() {
  await requireSuperadmin();
  return (
    <div className="max-w-xl space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-stone-900">Nova clínica</h1>
        <p className="text-sm text-stone-500">
          Cria a clínica e o login da responsável. No primeiro acesso ela aceita os Termos e passa pelo wizard de implantação (dados, equipe, catálogo, WhatsApp).
        </p>
      </div>
      <NewClinicForm />
    </div>
  );
}
