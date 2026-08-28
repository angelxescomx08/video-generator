/**
 * Diff a nivel de "token" entre el texto original y el texto ya limpiado por
 * `sanitizePromptText`. Sirve para mostrarle al usuario exactamente que se quito/cambio,
 * en vez de solo contadores agregados.
 *
 * Es una funcion PURA (sin dependencias) por la misma razon que el sanitizer: corre igual
 * en el cliente que en el server.
 */

export type DiffSegment = { type: "equal" | "removed" | "added"; value: string };

/** Alnum juntos, no-alnum-no-espacio juntos (puntuacion/emoji/simbolos), o espacios juntos. */
const TOKEN_RE = /[\p{L}\p{N}]+|[^\S\r\n]+|[\r\n]+|[^\p{L}\p{N}\s]+/gu;

function tokenize(text: string): string[] {
  return text.match(TOKEN_RE) ?? [];
}

/** Por encima de esto el diff O(n*m) se vuelve caro; se cae a un resultado sin alinear. */
const MAX_TOKENS_FOR_DIFF = 4000;

/**
 * LCS clasico sobre tokens. Devuelve los segmentos en orden, colapsando tokens consecutivos
 * del mismo tipo para que el render no fragmente cada palabra en su propio <span>.
 */
export function diffText(before: string, after: string): DiffSegment[] {
  if (before === after) return after ? [{ type: "equal", value: after }] : [];

  const a = tokenize(before);
  const b = tokenize(after);

  if (a.length > MAX_TOKENS_FOR_DIFF || b.length > MAX_TOKENS_FOR_DIFF) {
    const segments: DiffSegment[] = [];
    if (before) segments.push({ type: "removed", value: before });
    if (after) segments.push({ type: "added", value: after });
    return segments;
  }

  const n = a.length;
  const m = b.length;
  // lcs[i][j] = longitud de la LCS entre a[i..] y b[j..]. Indices siempre en rango por los
  // bucles de abajo, de ahi los "!" en vez de checks redundantes.
  const lcs: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i]![j] =
        a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }

  const raw: DiffSegment[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      raw.push({ type: "equal", value: a[i]! });
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      raw.push({ type: "removed", value: a[i]! });
      i++;
    } else {
      raw.push({ type: "added", value: b[j]! });
      j++;
    }
  }
  while (i < n) raw.push({ type: "removed", value: a[i++]! });
  while (j < m) raw.push({ type: "added", value: b[j++]! });

  const merged: DiffSegment[] = [];
  for (const seg of raw) {
    const last = merged[merged.length - 1];
    if (last && last.type === seg.type) {
      last.value += seg.value;
    } else {
      merged.push({ ...seg });
    }
  }
  return merged;
}
