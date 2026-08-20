"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Button } from "@/components/ui";
import { togglePackageActive, toggleProcedureActive } from "./actions";

export function ToggleActiveButton({
  kind,
  id,
  active,
}: {
  kind: "procedure" | "package";
  id: string;
  active: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function toggle() {
    startTransition(async () => {
      const action = kind === "procedure" ? toggleProcedureActive : togglePackageActive;
      await action({ id, active: !active });
      router.refresh();
    });
  }

  return (
    <Button variant={active ? "danger" : "ghost"} onClick={toggle} disabled={pending}>
      {active ? "Desativar" : "Reativar"}
    </Button>
  );
}
