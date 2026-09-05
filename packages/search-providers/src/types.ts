/**
 * Busqueda en la web abierta, detras del mismo patron adaptador que stock/tts/social.
 *
 * Va en su propio paquete y NO como una herramienta del LLM a proposito. Si la busqueda fuera un
 * `tool` del modelo (el grounding de Gemini, por ejemplo), el sistema quedaria atado a los
 * proveedores que soportan herramientas y a su formato: cambiar `AI_PROVIDER` a Ollama apagaria la
 * funcion entera. Aqui la busqueda ocurre ANTES de llamar al modelo y sus resultados entran al
 * prompt como texto, asi que funciona identico con Ollama, OpenAI, Gemini o Anthropic — ninguno
 * necesita saber usar herramientas.
 */

export interface SearchResult {
  title: string;
  url: string;
  /** Extracto de la pagina. Es lo que acaba en el prompt, asi que importa mas que el titulo. */
  snippet: string;
  /** Dominio, para poder mostrar de donde salio sin volver a parsear la URL. */
  source: string;
}

export interface SearchRequest {
  query: string;
  /** Cuantos resultados como maximo. Los proveedores devuelven menos si no hay mas. */
  limit?: number;
  /** Codigo de idioma preferido ("es"). No todos los proveedores lo respetan. */
  language?: string;
}

export interface WebSearchProvider {
  readonly name: string;
  search(req: SearchRequest): Promise<SearchResult[]>;
  /** True si el proveedor responde. Se usa para el aviso en la UI antes de gastar una corrida. */
  healthCheck(): Promise<boolean>;
}

/** Dominio de una URL, tolerante a URLs mal formadas (algunos motores devuelven basura). */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url.slice(0, 40);
  }
}

/** Recorta un extracto para que 10 resultados no se coman el prompt entero. */
export function trimSnippet(text: string, maxChars = 320): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= maxChars) return clean;
  const cut = clean.slice(0, maxChars);
  const lastSpace = cut.lastIndexOf(" ");
  return `${lastSpace > maxChars * 0.7 ? cut.slice(0, lastSpace) : cut}...`;
}
