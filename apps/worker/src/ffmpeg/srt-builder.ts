import { writeFile } from "node:fs/promises";
import type { CaptionStyle, EDLScene } from "@video-generator/types";
import {
  chunkWordTimings,
  LONG_CHUNK_OPTIONS,
  SHORT_CHUNK_OPTIONS,
  type CaptionChunk,
} from "../captions/chunk-captions";
import { captionSafeArea } from "../captions/safe-area";

/**
 * Formatea un tiempo ASS (h:mm:ss.cc). Se redondea a centisegundos ANTES de descomponer: redondear
 * la parte fraccionaria por separado podia dar 100 centisegundos (10.999s -> "0:00:10.100"), un
 * timestamp invalido que libass no interpreta y que dejaba el ultimo bloque sin mostrarse.
 */
function toAssTime(seconds: number): string {
  const totalCs = Math.max(0, Math.round(seconds * 100));
  const cs = totalCs % 100;
  const totalSeconds = (totalCs - cs) / 100;
  const s = totalSeconds % 60;
  const m = Math.floor(totalSeconds / 60) % 60;
  const h = Math.floor(totalSeconds / 3600);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

/** ASS usa BGR con prefijo de alpha (&HAABBGGRR), no RGB — invertir los bytes es obligatorio. */
function hexToAssColor(hex: string, alphaHex = "00"): string {
  const clean = hex.replace("#", "").padEnd(6, "0");
  const r = clean.slice(0, 2);
  const g = clean.slice(2, 4);
  const b = clean.slice(4, 6);
  return `&H${alphaHex}${b}${g}${r}`.toUpperCase();
}

function alignmentFor(position: CaptionStyle["position"]): number {
  if (position === "top") return 8;
  if (position === "center") return 5;
  return 2;
}

/** Escapa los caracteres que libass interpreta como marcado dentro del texto de un evento. */
function escapeAssText(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\{/g, "\\{").replace(/\}/g, "\\}").replace(/\r?\n/g, "\\N");
}

/**
 * Resalte palabra por palabra con karaoke ASS (`\kf`), relativo al inicio del evento.
 *
 * Semantica de ASS: el texto aun "no cantado" se pinta con SecondaryColour y va pasando a
 * PrimaryColour segun avanza el karaoke. Por eso el estilo Karaoke define PrimaryColour = color de
 * resalte y SecondaryColour = color base (antes estaba invertido, asi que la palabra activa se
 * apagaba en vez de encenderse).
 */
function buildKaraokeText(chunk: CaptionChunk): string {
  return chunk.words
    .map((w) => {
      const centiseconds = Math.max(1, Math.round((w.endSeconds - w.startSeconds) * 100));
      return `{\\kf${centiseconds}}${escapeAssText(w.word)}`;
    })
    .join(" ");
}

type RenderableChunk = CaptionChunk & { karaoke: boolean };

/** Convierte cada escena en bloques cortos de subtitulo alineados a las palabras ya cronometradas. */
function buildChunks(scenes: EDLScene[], format: "long" | "short"): RenderableChunk[] {
  const options = format === "short" ? SHORT_CHUNK_OPTIONS : LONG_CHUNK_OPTIONS;

  return scenes.flatMap((scene): RenderableChunk[] => {
    if (scene.captionWordTimings && scene.captionWordTimings.length > 0) {
      return chunkWordTimings(scene.captionWordTimings, options).map((c) => ({ ...c, karaoke: true }));
    }
    // Sin timings por palabra solo podemos mostrar el texto durante toda la escena.
    if (!scene.captionText) return [];
    return [
      {
        words: [],
        text: scene.captionText,
        startSeconds: scene.startSeconds,
        endSeconds: scene.startSeconds + scene.durationSeconds,
        karaoke: false,
      },
    ];
  });
}

export async function buildAssSubtitleFile(params: {
  scenes: EDLScene[];
  style: CaptionStyle;
  format: "long" | "short";
  resolutionWidth: number;
  resolutionHeight: number;
  destPath: string;
}): Promise<{ path: string; chunkCount: number }> {
  const { scenes, style, format, resolutionWidth, resolutionHeight, destPath } = params;

  const baseColor = hexToAssColor(style.color);
  const highlightColor = style.highlightColor ? hexToAssColor(style.highlightColor) : baseColor;
  const alignment = alignmentFor(style.position);
  const safeArea = captionSafeArea(format, style.position);

  // Contorno negro grueso + sombra: es lo que garantiza legibilidad sobre CUALQUIER footage (cielo
  // claro, nieve, pared blanca). Un texto blanco sin contorno desaparece sobre fondos claros, que es
  // el error clasico de los subtitulos quemados. El recuadro semitransparente es opcional encima.
  const outlineColor = hexToAssColor("#000000");
  const borderStyle = style.backgroundBox ? 3 : 1;
  const backColor = style.backgroundBox ? hexToAssColor("#000000", "A0") : hexToAssColor("#000000", "80");
  const outlineWidth = format === "short" ? 5 : 3;
  const shadowDepth = format === "short" ? 2 : 1;

  const styleTail = [
    `${style.fontFamily}`,
    `${style.fontSizePx}`,
    // PrimaryColour, SecondaryColour, OutlineColour, BackColour
    "__PRIMARY__",
    "__SECONDARY__",
    outlineColor,
    backColor,
    "-1", // Bold: -1 = true. Los subtitulos de Shorts practicamente siempre van en negrita.
    "0",
    "0",
    "0",
    "100",
    "100",
    "0",
    "0",
    String(borderStyle),
    String(outlineWidth),
    String(shadowDepth),
    String(alignment),
    String(safeArea.marginLeft),
    String(safeArea.marginRight),
    String(safeArea.marginVertical),
    "1",
  ].join(",");

  // Dos estilos: "Karaoke" invierte primary/secondary para que la palabra activa se ENCIENDA con el
  // color de resalte, y "Plain" pinta todo el texto con el color base (sin karaoke, Primary manda).
  const karaokeStyle = `Style: Karaoke,${styleTail
    .replace("__PRIMARY__", highlightColor)
    .replace("__SECONDARY__", baseColor)}`;
  const plainStyle = `Style: Plain,${styleTail
    .replace("__PRIMARY__", baseColor)
    .replace("__SECONDARY__", baseColor)}`;

  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${resolutionWidth}
PlayResY: ${resolutionHeight}
ScaledBorderAndShadow: yes
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
${karaokeStyle}
${plainStyle}

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const chunks = buildChunks(scenes, format);
  const events = chunks
    .filter((c) => c.endSeconds > c.startSeconds && c.text.trim() !== "")
    .map((c) => {
      const text = c.karaoke ? buildKaraokeText(c) : escapeAssText(c.text);
      const styleName = c.karaoke ? "Karaoke" : "Plain";
      return `Dialogue: 0,${toAssTime(c.startSeconds)},${toAssTime(c.endSeconds)},${styleName},,0,0,0,,${text}`;
    });

  await writeFile(destPath, `${header}${events.join("\n")}\n`, "utf-8");
  return { path: destPath, chunkCount: events.length };
}
