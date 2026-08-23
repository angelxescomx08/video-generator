import type { ScriptScene } from "@video-generator/types";
import { WORDS_PER_MINUTE } from "./script-prompt.builder";

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** Corta `text` en el limite de oracion mas cercano a `maxWords` sin pasarse (conserva al menos una oracion). */
function truncateAtSentence(text: string, maxWords: number): string {
  const sentences = text.trim().match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [text];
  let words = 0;
  const kept: string[] = [];
  for (const sentence of sentences) {
    const sentenceWords = countWords(sentence);
    if (kept.length > 0 && words + sentenceWords > maxWords) break;
    kept.push(sentence);
    words += sentenceWords;
  }
  return (kept.length > 0 ? kept : sentences.slice(0, 1)).join(" ").trim();
}

/**
 * Red de seguridad determinista (sin llamar de nuevo al LLM): si el guion generado se paso del
 * presupuesto de palabras a pesar de la instruccion del prompt, recorta las escenas proporcionalmente
 * para que la duracion narrada real no se dispare muy por encima del target (p.ej. pedir 140s y
 * recibir un guion que narraria 211s). Recorta por oracion completa, nunca a la mitad de una frase.
 */
export function clampScenesToWordBudget(scenes: ScriptScene[], maxWords: number): ScriptScene[] {
  const totalWords = scenes.reduce((sum, s) => sum + countWords(s.narrationText), 0);
  if (totalWords <= maxWords || totalWords === 0) return scenes;

  const ratio = maxWords / totalWords;
  return scenes.map((scene) => {
    const sceneWords = countWords(scene.narrationText);
    const budget = Math.max(1, Math.round(sceneWords * ratio));
    const narrationText = truncateAtSentence(scene.narrationText, budget);
    const newWordCount = countWords(narrationText);
    return {
      ...scene,
      narrationText,
      estimatedDurationSeconds: Math.round((newWordCount / WORDS_PER_MINUTE) * 60),
    };
  });
}
