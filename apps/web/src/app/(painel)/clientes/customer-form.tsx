"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button, FieldError, Input, Label, Modal } from "@/components/ui";
import { saveCustomer } from "./actions";

export function CustomerFormButton() {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function submit(formData: FormData) {
    setError(undefined);
    startTransition(async () => {
      try {
        const get = (k: string) => String(formData.get(k) ?? "");
        const result = await saveCustomer({
          fullName: get("fullName"),
          phone: get("phone"),
          email: get("email"),
          cpf: get("cpf"),
          rg: get("rg"),
          birthDate: get("birthDate"),
          sex: get("sex") as "feminino" | "masculino" | "outro" | "",
          insuranceName: get("insuranceName"),
          insurancePlan: get("insurancePlan"),
          socialName: "",
          instagram: "",
          source: get("source"),
          addressStreet: get("addressStreet"),
          addressNumber: get("addressNumber"),
          addressDistrict: get("addressDistrict"),
          addressCity: get("addressCity"),
          addressState: get("addressState"),
          addressZip: get("addressZip"),
          notes: "",
        });
        if (result.ok && result.customerId) {
          setOpen(false);
          router.push(`/clientes/${result.customerId}`);
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
      <Button onClick={() => setOpen(true)}>+ Nova cliente</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Nova cliente">
        <p className="mb-4 text-xs text-stone-500">
          Só nome e WhatsApp são obrigatórios — o resto você completa na ficha, quando der.
        </p>
        <form action={submit} className="space-y-4">
          <div>
            <Label htmlFor="c-name">Nome completo</Label>
            <Input id="c-name" name="fullName" required autoFocus />
          </div>
          <div>
            <Label htmlFor="c-phone">WhatsApp</Label>
            <Input
              id="c-phone"
              name="phone"
              inputMode="tel"
              placeholder="(11) 98862-1152"
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="c-email" hint="opcional">E-mail</Label>
              <Input id="c-email" name="email" type="email" />
            </div>
            <div>
              <Label htmlFor="c-birth" hint="opcional">Nascimento</Label>
              <Input id="c-birth" name="birthDate" placeholder="dd/mm/aaaa" />
            </div>
          </div>
          <div>
            <Label htmlFor="c-source" hint="opcional">Como conheceu a clínica?</Label>
            <Input id="c-source" name="source" placeholder="Indicação, Instagram, Google..." />
          </div>

          {/* Ficha completa opcional — para quem prefere cadastrar tudo já */}
          <details className="rounded-lg border border-stone-200 px-3 py-2">
            <summary className="cursor-pointer text-sm font-medium text-stone-600">
              Ficha completa (opcional) — documentos, convênio e endereço
            </summary>
            <div className="mt-3 space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label htmlFor="c-cpf">CPF</Label>
                  <Input id="c-cpf" name="cpf" />
                </div>
                <div>
                  <Label htmlFor="c-rg">RG</Label>
                  <Input id="c-rg" name="rg" />
                </div>
                <div>
                  <Label htmlFor="c-sex">Sexo</Label>
                  <select
                    id="c-sex"
                    name="sex"
                    defaultValue=""
                    className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-800 focus:border-teal-600 focus:outline-none"
                  >
                    <option value="">—</option>
                    <option value="feminino">Feminino</option>
                    <option value="masculino">Masculino</option>
                    <option value="outro">Outro</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="c-insurance">Convênio</Label>
                  <Input id="c-insurance" name="insuranceName" placeholder="Unimed, Amil..." />
                </div>
                <div>
                  <Label htmlFor="c-plan">Plano</Label>
                  <Input id="c-plan" name="insurancePlan" />
                </div>
              </div>
              <div className="grid grid-cols-6 gap-3">
                <div className="col-span-4">
                  <Label htmlFor="c-street">Rua</Label>
                  <Input id="c-street" name="addressStreet" />
                </div>
                <div className="col-span-2">
                  <Label htmlFor="c-number">Número</Label>
                  <Input id="c-number" name="addressNumber" />
                </div>
                <div className="col-span-2">
                  <Label htmlFor="c-district">Bairro</Label>
                  <Input id="c-district" name="addressDistrict" />
                </div>
                <div className="col-span-2">
                  <Label htmlFor="c-city">Cidade</Label>
                  <Input id="c-city" name="addressCity" />
                </div>
                <div className="col-span-1">
                  <Label htmlFor="c-state">UF</Label>
                  <Input id="c-state" name="addressState" maxLength={2} />
                </div>
                <div className="col-span-1">
                  <Label htmlFor="c-zip">CEP</Label>
                  <Input id="c-zip" name="addressZip" />
                </div>
              </div>
            </div>
          </details>

          <FieldError message={error} />

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Salvando..." : "Salvar e abrir ficha"}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
