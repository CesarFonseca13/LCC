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
        const result = await saveCustomer({
          fullName: String(formData.get("fullName") ?? ""),
          phone: String(formData.get("phone") ?? ""),
          email: String(formData.get("email") ?? ""),
          cpf: "",
          birthDate: String(formData.get("birthDate") ?? ""),
          socialName: "",
          instagram: "",
          source: String(formData.get("source") ?? ""),
          addressStreet: "",
          addressNumber: "",
          addressDistrict: "",
          addressCity: "",
          addressState: "",
          addressZip: "",
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
