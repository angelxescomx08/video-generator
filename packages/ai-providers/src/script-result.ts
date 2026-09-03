import { scriptGenerationResultSchema, type ScriptGenerationResult } from "@video-generator/types";

/**
 * Valida el guion que devolvio un LLM antes de darlo por bueno.
 *
 * Compartido por los cuatro providers a proposito: es el mismo contrato para todos, y es el espejo
 * de lo que `generateEDL` ya hacia con `editDecisionListSchema.safeParse`. Hasta ahora `generateScript`
 * hacia `json as ScriptGenerationResult` — un cast no comprueba nada en runtime, asi que un guion
 * con otra forma se guardaba en la base y reventaba etapas despues, con un error que no mencionaba
 * ni al provider ni al campo culpable.
 *
 * Lanza en vez de degradar porque el guion no tiene fallback (a diferencia del EDL): sin titulo o
 * sin escenas no hay video posible, y fallar aqui deja el mensaje junto a su causa. `runStage` marca
 * el video como `failed` y el error nombra al provider y al campo.
 */
export function parseScriptResult(providerName: string, json: unknown): ScriptGenerationResult {
  const parsed = scriptGenerationResultSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`${providerName} returned an invalid script: ${parsed.error.message}`);
  }
  return parsed.data;
}
