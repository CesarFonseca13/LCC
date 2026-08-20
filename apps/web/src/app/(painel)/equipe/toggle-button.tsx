"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui";
import {
  toggleMemberActive,
  toggleProfessionalActive,
  toggleRoomActive,
} from "./actions";

const ACTIONS = {
  professional: toggleProfessionalActive,
  member: toggleMemberActive,
  room: toggleRoomActive,
} as const;

const LABELS: Record<string, [string, string]> = {
  professional: ["Desativar", "Reativar"],
  member: ["Remover acesso", "Restaurar"],
  room: ["Desativar", "Reativar"],
};

export function ToggleButton({
  kind,
  id,
  active,
}: {
  kind: keyof typeof ACTIONS;
  id: string;
  active: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();
  const router = useRouter();

  function toggle() {
    setError(undefined);
    startTransition(async () => {
      const result = await ACTIONS[kind]({ id, active: !active });
      if (!result.ok) setError(result.error);
      router.refresh();
    });
  }

  return (
    <span className="inline-flex items-center gap-2">
      {error ? <span className="text-xs text-red-600">{error}</span> : null}
      <Button variant={active ? "danger" : "ghost"} onClick={toggle} disabled={pending}>
        {LABELS[kind]?.[active ? 0 : 1]}
      </Button>
    </span>
  );
}
