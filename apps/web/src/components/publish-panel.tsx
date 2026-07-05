"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";

export function PublishPanel({
  videoId,
  accounts,
}: {
  videoId: string;
  accounts: { id: string; label: string }[];
}) {
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  if (accounts.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No hay cuentas conectadas. Conecta YouTube o Facebook en Configuracion / Cuentas.
      </p>
    );
  }

  async function onPublish() {
    setSubmitting(true);
    try {
      const response = await fetch(`/api/videos/${videoId}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platformAccountId: accountId }),
      });
      if (response.ok) setDone(true);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex max-w-md items-end gap-3">
      <div className="flex-1 space-y-2">
        <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
            </option>
          ))}
        </Select>
      </div>
      <Button onClick={onPublish} disabled={submitting || done}>
        {done ? "Publicando..." : submitting ? "Enviando..." : "Publicar"}
      </Button>
    </div>
  );
}
