"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ExchangeRateForm({ initialRate }: { initialRate: number }) {
  const [rate, setRate] = useState(initialRate.toString());
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function handleSave() {
    const parsedRate = Number(rate);
    if (!Number.isFinite(parsedRate) || parsedRate <= 0) return;

    setSaving(true);
    setSaved(false);
    try {
      const response = await fetch("/api/settings/exchange-rate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rate: parsedRate }),
      });
      if (response.ok) setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-xs space-y-3 rounded-md border border-border p-4">
      <Label htmlFor="usd-mxn-rate">Tipo de cambio USD → MXN</Label>
      <div className="flex items-center gap-2">
        <Input
          id="usd-mxn-rate"
          type="number"
          step="0.01"
          min="0"
          value={rate}
          onChange={(e) => {
            setRate(e.target.value);
            setSaved(false);
          }}
        />
        <Button size="sm" onClick={handleSave} disabled={saving}>
          Guardar
        </Button>
      </div>
      {saved && <p className="text-xs text-muted-foreground">Guardado. Se usara en los proximos renders.</p>}
    </div>
  );
}
