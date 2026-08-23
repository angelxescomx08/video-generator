"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface ProviderOption {
  name: string;
  label: string;
  free: boolean;
  /** Solo para stock: resumen de licencia mostrado en la UI. */
  license?: string;
  /** Solo para stock: si false, no se puede usar para monetizar y el worker lo ignora. */
  monetizable?: boolean;
  /** Solo para stock: la licencia obliga a acreditar en la descripcion del video. */
  needsCredit?: boolean;
}

const PROVIDER_OPTIONS: Record<"ai" | "tts" | "stock" | "music", ProviderOption[]> = {
  ai: [
    { name: "ollama", label: "Ollama (local)", free: true },
    { name: "openai", label: "OpenAI", free: false },
    { name: "gemini", label: "Google Gemini", free: false },
    { name: "anthropic", label: "Anthropic Claude", free: false },
  ],
  tts: [
    { name: "piper", label: "Piper (local)", free: true },
    { name: "coqui", label: "Coqui (local)", free: true },
    { name: "elevenlabs", label: "ElevenLabs", free: false },
    { name: "azure", label: "Azure TTS", free: false },
    { name: "google", label: "Google Cloud TTS", free: false },
  ],
  stock: [
    {
      name: "pixabay",
      label: "Pixabay",
      free: true,
      license: "Pixabay Content License — uso comercial libre, sin atribucion obligatoria.",
      monetizable: true,
      needsCredit: false,
    },
    {
      name: "pexels",
      label: "Pexels",
      free: true,
      license: "Pexels License — uso comercial libre, pero la API exige acreditar a Pexels y al autor.",
      monetizable: true,
      needsCredit: true,
    },
    {
      name: "shutterstock",
      label: "Shutterstock",
      free: false,
      license: "Requiere comprar licencia por clip. La descarga no esta implementada, el worker lo ignora.",
      monetizable: false,
    },
    {
      name: "storyblocks",
      label: "Storyblocks",
      free: false,
      license: "Requiere suscripcion de pago vigente. La descarga no esta implementada, el worker lo ignora.",
      monetizable: false,
    },
  ],
  music: [{ name: "jamendo", label: "Jamendo (Creative Commons)", free: true }],
};

const SECTION_TITLES: Record<keyof typeof PROVIDER_OPTIONS, string> = {
  ai: "Generacion de guion (IA)",
  tts: "Narracion (TTS)",
  stock: "Material de video (stock footage)",
  music: "Musica de fondo (sin copyright)",
};

/** Los tipos que aceptan varios proveedores activos a la vez (se combinan para dar variedad). */
const MULTI_SELECT_TYPES = new Set<keyof typeof PROVIDER_OPTIONS>(["stock"]);

export function ProviderSettingsPanel({
  currentDefaults,
  initialEnabled,
}: {
  currentDefaults: Record<string, string | undefined>;
  initialEnabled: string[];
}) {
  const [defaults, setDefaults] = useState(currentDefaults);
  const [enabled, setEnabled] = useState<Set<string>>(new Set(initialEnabled));
  const [pending, setPending] = useState<string | null>(null);

  async function setDefault(providerType: string, providerName: string) {
    setPending(`${providerType}:${providerName}`);
    try {
      const response = await fetch("/api/settings/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerType, providerName }),
      });
      if (response.ok) setDefaults((prev) => ({ ...prev, [providerType]: providerName }));
    } finally {
      setPending(null);
    }
  }

  async function toggleEnabled(providerType: string, providerName: string, next: boolean) {
    const key = `${providerType}:${providerName}`;
    setPending(key);
    try {
      const response = await fetch("/api/settings/providers", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerType, providerName, isEnabled: next }),
      });
      if (response.ok) {
        setEnabled((prev) => {
          const updated = new Set(prev);
          if (next) updated.add(key);
          else updated.delete(key);
          return updated;
        });
      }
    } finally {
      setPending(null);
    }
  }

  const activeStock = PROVIDER_OPTIONS.stock.filter(
    (o) => o.monetizable && enabled.has(`stock:${o.name}`),
  );

  return (
    <div className="space-y-8">
      {(Object.keys(PROVIDER_OPTIONS) as (keyof typeof PROVIDER_OPTIONS)[]).map((type) => {
        const isMulti = MULTI_SELECT_TYPES.has(type);
        return (
          <div key={type} className="space-y-3">
            <div>
              <h2 className="font-semibold">{SECTION_TITLES[type]}</h2>
              {isMulti && (
                <p className="text-xs text-muted-foreground">
                  Puedes activar varios a la vez: el worker los combina y va rotando cual busca primero en
                  cada escena, para que el video tenga material de fuentes distintas. Si uno falla o le falta
                  su API key, los demas siguen y el video se genera igual.
                </p>
              )}
            </div>

            <div className="grid grid-cols-1 gap-2">
              {PROVIDER_OPTIONS[type].map((opt) => {
                const key = `${type}:${opt.name}`;
                const isDefault = defaults[type] === opt.name;
                const isEnabled = enabled.has(key);
                const blocked = opt.monetizable === false;

                return (
                  <div key={opt.name} className="rounded-md border border-border p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex flex-wrap items-center gap-2">
                        {isMulti && (
                          <input
                            type="checkbox"
                            id={key}
                            checked={isEnabled}
                            disabled={blocked || pending === key}
                            onChange={(e) => toggleEnabled(type, opt.name, e.target.checked)}
                            className="h-4 w-4 rounded border-border"
                          />
                        )}
                        <label htmlFor={isMulti ? key : undefined} className="text-sm">
                          {opt.label}
                        </label>
                        <Badge variant={opt.free ? "secondary" : "outline"}>
                          {opt.free ? "gratis" : "pago"}
                        </Badge>
                        {opt.needsCredit && <Badge variant="outline">requiere credito</Badge>}
                        {blocked && <Badge variant="destructive">no monetizable</Badge>}
                      </div>

                      {!isMulti && (
                        <Button
                          size="sm"
                          variant={isDefault ? "default" : "outline"}
                          disabled={isDefault || pending === key}
                          onClick={() => setDefault(type, opt.name)}
                        >
                          {isDefault ? "Predeterminado" : "Usar"}
                        </Button>
                      )}
                    </div>

                    {opt.license && (
                      <p className="mt-2 text-xs text-muted-foreground">{opt.license}</p>
                    )}
                  </div>
                );
              })}
            </div>

            {isMulti && type === "stock" && (
              <>
                {activeStock.length === 0 && (
                  <p className="rounded-md border border-border bg-muted/50 p-3 text-xs text-muted-foreground">
                    Sin ningun banco seleccionado, el worker usa Pixabay + Pexels por defecto para no dejar
                    la generacion sin material.
                  </p>
                )}
                {activeStock.some((o) => o.needsCredit) && (
                  <p className="rounded-md border border-border bg-muted/50 p-3 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">Atribucion obligatoria:</span> con{" "}
                    {activeStock
                      .filter((o) => o.needsCredit)
                      .map((o) => o.label)
                      .join(", ")}{" "}
                    activo, sus terminos de API exigen acreditar la fuente y al autor. Los creditos exactos
                    de cada video aparecen en su pagina de detalle, listos para pegar en la descripcion de
                    YouTube.
                  </p>
                )}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
