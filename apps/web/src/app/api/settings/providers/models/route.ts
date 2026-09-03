import { listModelsForProvider } from "@video-generator/ai-providers";
import { NextResponse } from "next/server";
import { z } from "zod";

const querySchema = z.object({
  providerName: z.enum(["ollama", "openai", "gemini", "anthropic"]),
});

/**
 * Consulta en vivo (sin cachear) los modelos que el proveedor tiene disponibles ahora, para el
 * selector de /settings/providers. Ninguno de los cuatro cobra por este endpoint: es metadata, no
 * inferencia.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const parsed = querySchema.safeParse({ providerName: searchParams.get("providerName") });
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  try {
    const models = await listModelsForProvider(parsed.data.providerName);
    return NextResponse.json({ models });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Error desconocido consultando modelos" },
      { status: 502 },
    );
  }
}
