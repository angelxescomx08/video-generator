/**
 * Categorias de video de YouTube utiles para este pipeline (IDs de la API, verificados 2026-08-23).
 *
 * IMPORTANTE: YouTube NO tiene categoria de "Religion" ni "Espiritualidad". El contenido religioso
 * se reparte entre Education (si ensena algo) y People & Blogs (si es testimonio/opinion), que es la
 * duda tipica al publicar contenido cristiano.
 *
 * La lista completa de la API tiene mas IDs (y algunos ya no son asignables al subir), asi que aqui
 * solo estan los que tienen sentido para video narrado generado por este proyecto.
 */
export const YOUTUBE_CATEGORIES = [
  {
    id: "27",
    label: "Educacion",
    hint: "Ensena o explica algo: estudios biblicos, historia, divulgacion, tutoriales.",
  },
  {
    id: "22",
    label: "Gente y blogs",
    hint: "Testimonio, reflexion personal, opinion. Es el cajon por defecto de YouTube.",
  },
  {
    id: "24",
    label: "Entretenimiento",
    hint: "Contenido narrativo cuyo fin es entretener mas que ensenar.",
  },
  { id: "25", label: "Noticias y politica", hint: "Actualidad y analisis de noticias." },
  { id: "26", label: "Como hacerlo y estilo", hint: "Guias practicas, rutinas, estilo de vida." },
  { id: "28", label: "Ciencia y tecnologia", hint: "Divulgacion cientifica o tecnica." },
  {
    id: "29",
    label: "ONG y activismo",
    hint: "Organizaciones sin fines de lucro y causas sociales.",
  },
  { id: "10", label: "Musica", hint: "El video es la musica en si (alabanza, covers)." },
  { id: "20", label: "Videojuegos", hint: "Gameplay y contenido de videojuegos." },
  { id: "17", label: "Deportes", hint: "Contenido deportivo." },
] as const;

export type YoutubeCategoryId = (typeof YOUTUBE_CATEGORIES)[number]["id"];

/** Cajon por defecto de YouTube cuando no se declara categoria. */
export const DEFAULT_YOUTUBE_CATEGORY_ID = "22";

export function youtubeCategoryLabel(id: string | null | undefined): string | null {
  return YOUTUBE_CATEGORIES.find((c) => c.id === id)?.label ?? null;
}
