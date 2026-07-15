"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const PROVIDER_OPTIONS: Record<"ai" | "tts" | "stock" | "music", { name: string; label: string; free: boolean }[]> = {
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
  ],
  stock: [
    { name: "pixabay", label: "Pixabay", free: true },
    { name: "pexels", label: "Pexels", free: true },
    { name: "shutterstock", label: "Shutterstock", free: false },
    { name: "storyblocks", label: "Storyblocks", free: false },
  ],
  music: [{ name: "jamendo", label: "Jamendo (Creative Commons)", free: true }],
};

const SECTION_TITLES: Record<keyof typeof PROVIDER_OPTIONS, string> = {
  ai: "Generacion de guion (IA)",
  tts: "Narracion (TTS)",
  stock: "Material de video (stock footage)",
  music: "Musica de fondo (sin copyright)",
};

export function ProviderSettingsPanel({
  currentDefaults,
}: {
  currentDefaults: Record<string, string | undefined>;
}) {
  const [defaults, setDefaults] = useState(currentDefaults);
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

  return (
    <div className="space-y-8">
      {(Object.keys(PROVIDER_OPTIONS) as (keyof typeof PROVIDER_OPTIONS)[]).map((type) => (
        <div key={type} className="space-y-3">
          <h2 className="font-semibold">{SECTION_TITLES[type]}</h2>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {PROVIDER_OPTIONS[type].map((opt) => {
              const isDefault = defaults[type] === opt.name;
              return (
                <div
                  key={opt.name}
                  className="flex items-center justify-between rounded-md border border-border p-3"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm">{opt.label}</span>
                    <Badge variant={opt.free ? "secondary" : "outline"}>{opt.free ? "gratis" : "pago"}</Badge>
                  </div>
                  <Button
                    size="sm"
                    variant={isDefault ? "default" : "outline"}
                    disabled={isDefault || pending === `${type}:${opt.name}`}
                    onClick={() => setDefault(type, opt.name)}
                  >
                    {isDefault ? "Predeterminado" : "Usar"}
                  </Button>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
