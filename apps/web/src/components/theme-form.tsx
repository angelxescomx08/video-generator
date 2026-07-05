"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { Theme } from "@video-generator/db";

export function ThemeForm({ initial }: { initial?: Theme }) {
  const router = useRouter();
  const isEdit = Boolean(initial);
  const [slug, setSlug] = useState(initial?.slug ?? "");
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [systemPrompt, setSystemPrompt] = useState(initial?.systemPrompt ?? "");
  const [scriptPromptTemplate, setScriptPromptTemplate] = useState(initial?.scriptPromptTemplate ?? "");
  const [defaultVoiceId, setDefaultVoiceId] = useState(initial?.defaultVoiceId ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const url = isEdit ? `/api/themes/${initial!.id}` : "/api/themes";
      const method = isEdit ? "PATCH" : "POST";
      const payload = isEdit
        ? { name, description, systemPrompt, scriptPromptTemplate, defaultVoiceId }
        : { slug, name, description, systemPrompt, scriptPromptTemplate, defaultVoiceId };

      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error("Error al guardar el tema");
      router.push("/themes");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {!isEdit && (
        <div className="space-y-2">
          <Label htmlFor="slug">Slug (identificador unico)</Label>
          <Input id="slug" value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="ej. estoicismo" required />
        </div>
      )}
      <div className="space-y-2">
        <Label htmlFor="name">Nombre</Label>
        <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="description">Descripcion</Label>
        <Textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="systemPrompt">System prompt (personalidad/estilo de la IA)</Label>
        <Textarea
          id="systemPrompt"
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          rows={4}
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="scriptPromptTemplate">
          Template de guion (usa {"{{topic}}"}, {"{{memory}}"}, {"{{feedback}}"})
        </Label>
        <Textarea
          id="scriptPromptTemplate"
          value={scriptPromptTemplate}
          onChange={(e) => setScriptPromptTemplate(e.target.value)}
          rows={5}
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="defaultVoiceId">Voz por defecto (TTS)</Label>
        <Input id="defaultVoiceId" value={defaultVoiceId} onChange={(e) => setDefaultVoiceId(e.target.value)} />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button type="submit" disabled={submitting}>
        {submitting ? "Guardando..." : isEdit ? "Guardar cambios" : "Crear tema"}
      </Button>
    </form>
  );
}
