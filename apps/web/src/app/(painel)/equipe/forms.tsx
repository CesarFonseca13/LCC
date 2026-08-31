"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button, FieldError, Input, Label, Modal, Select } from "@/components/ui";
import { createMember, saveProfessional, saveRoom } from "./actions";

// ── Profissional ─────────────────────────────────────────────────────

export interface ProfessionalInitial {
  id?: string;
  name: string;
  specialty: string;
  registrationNumber: string;
  calendarColor: string;
  /** Vazio = faz todos os serviços. */
  procedureIds?: string[];
}

const PROF_EMPTY: ProfessionalInitial = {
  name: "",
  specialty: "",
  registrationNumber: "",
  calendarColor: "#0f766e",
  procedureIds: [],
};

export function ProfessionalFormButton({
  initial,
  procedures = [],
}: {
  initial?: ProfessionalInitial;
  /** Catálogo ativo, para marcar quais serviços a profissional realiza. */
  procedures?: { id: string; name: string }[];
}) {
  const isEdit = Boolean(initial?.id);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const v = initial ?? PROF_EMPTY;
  const [fazTodos, setFazTodos] = useState((initial?.procedureIds ?? []).length === 0);
  const [marcados, setMarcados] = useState<string[]>(initial?.procedureIds ?? []);

  function submit(formData: FormData) {
    setError(undefined);
    startTransition(async () => {
      try {
        const result = await saveProfessional({
          id: initial?.id,
          name: String(formData.get("name") ?? ""),
          specialty: String(formData.get("specialty") ?? ""),
          registrationNumber: String(formData.get("registrationNumber") ?? ""),
          calendarColor: String(formData.get("calendarColor") ?? ""),
          procedureIds: fazTodos ? null : marcados,
        });
        if (result.ok) {
          setOpen(false);
          router.refresh();
        } else {
          setError(result.error ?? "Não foi possível salvar.");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Não foi possível salvar.");
      }
    });
  }

  return (
    <>
      {isEdit ? (
        <Button variant="ghost" onClick={() => setOpen(true)}>
          Editar
        </Button>
      ) : (
        <Button onClick={() => setOpen(true)}>+ Nova profissional</Button>
      )}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={isEdit ? `Editar ${v.name}` : "Nova profissional"}
      >
        <form action={submit} className="space-y-4">
          <div>
            <Label htmlFor="pr-name">Nome</Label>
            <Input id="pr-name" name="name" defaultValue={v.name} required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="pr-specialty" hint="opcional">Especialidade</Label>
              <Input
                id="pr-specialty"
                name="specialty"
                defaultValue={v.specialty}
                placeholder="Ex.: Biomedicina estética"
              />
            </div>
            <div>
              <Label htmlFor="pr-registration" hint="opcional">Registro (CRM/CRO...)</Label>
              <Input
                id="pr-registration"
                name="registrationNumber"
                defaultValue={v.registrationNumber}
              />
            </div>
          </div>
          <div>
            <Label htmlFor="pr-color">Cor na agenda</Label>
            <input
              id="pr-color"
              name="calendarColor"
              type="color"
              defaultValue={v.calendarColor}
              className="h-10 w-16 cursor-pointer rounded-lg border border-stone-300 bg-white p-1"
            />
          </div>

          {procedures.length > 0 ? (
            <div className="rounded-lg border border-stone-200 bg-stone-50 p-3">
              <p className="text-xs font-medium text-stone-600">Serviços que realiza</p>
              <label className="mt-2 flex items-center gap-2 text-sm text-stone-700">
                <input
                  type="checkbox"
                  checked={fazTodos}
                  onChange={(e) => setFazTodos(e.target.checked)}
                  className="h-4 w-4 accent-teal-700"
                />
                Faz todos os serviços da clínica
              </label>
              {!fazTodos ? (
                <div className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                  {procedures.map((p) => (
                    <label key={p.id} className="flex items-center gap-2 text-sm text-stone-600">
                      <input
                        type="checkbox"
                        checked={marcados.includes(p.id)}
                        onChange={(e) =>
                          setMarcados((prev) =>
                            e.target.checked ? [...prev, p.id] : prev.filter((x) => x !== p.id),
                          )
                        }
                        className="h-4 w-4 accent-teal-700"
                      />
                      {p.name}
                    </label>
                  ))}
                </div>
              ) : null}
              <p className="mt-2 text-xs text-stone-400">
                A assistente e o agendamento online só oferecem horários de quem realiza o
                serviço pedido.
              </p>
            </div>
          ) : null}

          <FieldError message={error} />

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Salvando..." : "Salvar"}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

// ── Acesso (usuário com login) ───────────────────────────────────────

const ROLE_OPTIONS = [
  {
    value: "owner",
    label: "Administradora",
    hint: "Acesso total, incluindo financeiro e configurações",
  },
  {
    value: "reception",
    label: "Recepção",
    hint: "Agenda, clientes, WhatsApp e aprovações — sem financeiro",
  },
  {
    value: "professional",
    label: "Profissional",
    hint: "A própria agenda e as fichas das suas clientes — sem valores",
  },
] as const;

export function MemberFormButton({
  professionals,
}: {
  professionals: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string>();
  const [success, setSuccess] = useState<{ tempPassword?: string; info?: string }>();
  const [role, setRole] = useState<string>("reception");
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function close() {
    setOpen(false);
    setSuccess(undefined);
    setError(undefined);
  }

  function submit(formData: FormData) {
    setError(undefined);
    startTransition(async () => {
      try {
        const result = await createMember({
          name: String(formData.get("name") ?? ""),
          email: String(formData.get("email") ?? ""),
          role: String(formData.get("role") ?? ""),
          professionalId: String(formData.get("professionalId") ?? "none"),
        });
        if (result.ok) {
          setSuccess({ tempPassword: result.tempPassword, info: result.info });
          router.refresh();
        } else {
          setError(result.error ?? "Não foi possível criar o acesso.");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Não foi possível criar o acesso.");
      }
    });
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>+ Novo acesso</Button>
      <Modal open={open} onClose={close} title="Novo acesso ao sistema">
        {success ? (
          <div className="space-y-4">
            {success.tempPassword ? (
              <>
                <p className="text-sm text-stone-700">
                  Acesso criado! Envie estes dados para a pessoa — a senha aparece{" "}
                  <strong>só esta vez</strong>:
                </p>
                <div className="rounded-lg bg-stone-50 p-4 text-center">
                  <p className="font-mono text-lg font-semibold tracking-wide text-stone-800">
                    {success.tempPassword}
                  </p>
                  <p className="mt-1 text-xs text-stone-500">senha temporária</p>
                </div>
              </>
            ) : (
              <p className="text-sm text-stone-700">{success.info}</p>
            )}
            <div className="flex justify-end">
              <Button onClick={close}>Fechar</Button>
            </div>
          </div>
        ) : (
          <form action={submit} className="space-y-4">
            <div>
              <Label htmlFor="m-name">Nome</Label>
              <Input id="m-name" name="name" required />
            </div>
            <div>
              <Label htmlFor="m-email">E-mail</Label>
              <Input id="m-email" name="email" type="email" required />
            </div>
            <div>
              <Label htmlFor="m-role">Papel</Label>
              <Select
                id="m-role"
                name="role"
                value={role}
                onChange={(e) => setRole(e.target.value)}
              >
                {ROLE_OPTIONS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </Select>
              <p className="mt-1 text-xs text-stone-400">
                {ROLE_OPTIONS.find((r) => r.value === role)?.hint}
              </p>
            </div>
            {role === "professional" && professionals.length > 0 ? (
              <div>
                <Label htmlFor="m-professional">Vincular à profissional</Label>
                <Select id="m-professional" name="professionalId" defaultValue="none">
                  <option value="none">Não vincular</option>
                  {professionals.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
                <p className="mt-1 text-xs text-stone-400">
                  Vinculando, ela vê a própria agenda ao entrar.
                </p>
              </div>
            ) : null}

            <FieldError message={error} />

            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="secondary" onClick={close}>
                Cancelar
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Criando..." : "Criar acesso"}
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </>
  );
}

// ── Sala ─────────────────────────────────────────────────────────────

export function RoomForm() {
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function submit(formData: FormData) {
    setError(undefined);
    const name = String(formData.get("name") ?? "");
    startTransition(async () => {
      try {
        const result = await saveRoom({ name });
        if (result.ok) {
          router.refresh();
        } else {
          setError(result.error);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Não foi possível salvar.");
      }
    });
  }

  return (
    <form action={submit} className="flex items-start gap-2">
      <div className="flex-1">
        <Input name="name" placeholder="Nome da sala (ex.: Sala 3)" required />
        <FieldError message={error} />
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "..." : "Adicionar"}
      </Button>
    </form>
  );
}
