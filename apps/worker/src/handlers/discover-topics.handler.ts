import { resolveEmbeddingProvider, resolveProvider } from "@video-generator/ai-providers";
import type { ProposedTopic, TopicResearchSource } from "@video-generator/ai-providers";
import { db, themes, topicProposals, videoMemory, videos } from "@video-generator/db";
import { discoverTopicsPayloadSchema, type DiscoverTopicsPayload } from "@video-generator/queue";
import { resolveSearchProvider, type SearchResult } from "@video-generator/search-providers";
import { cosineDistance, desc, eq, inArray, sql } from "drizzle-orm";
import { logger } from "../util/logger";

/**
 * Propone temas de video buscando en la web abierta.
 *
 * Es la contraparte de `discover-dimensions`: aquel mira hacia adentro (que tienen en comun los
 * guiones que funcionaron), este mira hacia afuera (de que se podria hablar). Y comparte su regla
 * central: **la IA propone, el dato dispone.** El modelo redacta ideas; quien decide si una idea es
 * nueva no es el modelo diciendo "creo que no lo hemos hecho", sino la distancia coseno contra los
 * guiones que el canal ya publico.
 *
 * Ese detalle importa mas de lo que parece. Preguntarle al LLM si ya se conto algo parecido es
 * pedirle que recuerde 30 guiones que nunca ha visto completos: contesta que no y se produce el
 * video repetido. La comprobacion semantica no depende de su memoria ni de su sinceridad.
 */

/** Cuantas ideas se piden por corrida. */
const MAX_PROPOSALS = 5;

/** Cuantos resultados web entran al prompt. Mas que esto solo diluye la senal y sube el costo. */
const SEARCH_RESULTS = 10;

/**
 * A partir de que similitud una propuesta se considera repetida.
 *
 * 0.82 sale de mirar el rango real: dos guiones del mismo canal sobre temas distintos rondan
 * 0.5-0.7 (comparten tono, formato y vocabulario), asi que un umbral tipico de 0.9 no dispararia
 * nunca y uno de 0.7 marcaria como repetido casi todo. Se guarda la similitud de TODAS las
 * propuestas, tambien las que pasan, para poder mover este numero mirando datos y no a ojo.
 */
const DUPLICATE_THRESHOLD = 0.82;

export async function handleDiscoverTopics(payload: DiscoverTopicsPayload): Promise<void> {
  const { themeId, query } = discoverTopicsPayloadSchema.parse(payload);

  const theme = await db.query.themes.findFirst({ where: eq(themes.id, themeId) });
  if (!theme) throw new Error(`Theme ${themeId} not found`);

  const searchQuery = query?.trim() || defaultQueryFor(theme.name);

  // La busqueda no tumba la corrida si falla: el modelo puede proponer desde su propio conocimiento
  // y el prompt ya contempla `sources` vacio. Es peor quedarse sin ninguna propuesta que quedarse
  // sin fuentes, y la UI marca cuales no traen respaldo.
  let sources: SearchResult[] = [];
  try {
    const search = await resolveSearchProvider();
    sources = await search.search({ query: searchQuery, limit: SEARCH_RESULTS, language: "es" });
    logger.info(`Busqueda de temas: ${sources.length} resultados de ${search.name}`, { query: searchQuery });
  } catch (err) {
    logger.warn("La busqueda web fallo; se propone sin fuentes", { error: (err as Error).message });
  }

  // Los titulos ya hechos son un filtro barato que evita gastar propuestas en lo obvio. El filtro
  // que de verdad decide es el semantico, mas abajo.
  const previous = await db
    .select({ id: videos.id, title: videos.title })
    .from(videos)
    .where(eq(videos.themeId, themeId))
    .orderBy(desc(videos.createdAt))
    .limit(60);

  const provider = await resolveProvider();
  const { result: proposals } = await provider.proposeTopics({
    themeName: theme.name,
    themeDescription: theme.description ?? undefined,
    sources: sources.map(toResearchSource),
    alreadyCovered: previous.map((p) => p.title).filter((t): t is string => Boolean(t)),
    maxProposals: MAX_PROPOSALS,
  });

  const usable = proposals.filter(isUsable);
  if (usable.length === 0) {
    logger.warn("La IA no devolvio ninguna propuesta de tema bien formada", { recibidas: proposals.length });
    return;
  }

  const rows = [];
  for (const proposal of usable) {
    const match = await findMostSimilarScript(themeId, `${proposal.title}. ${proposal.idea}`);
    const isDuplicate = match !== null && match.similarity >= DUPLICATE_THRESHOLD;

    rows.push({
      themeId,
      title: proposal.title.trim(),
      idea: proposal.idea.trim(),
      angle: proposal.angle.trim(),
      // Solo las fuentes que el modelo dijo estar usando, no las 10 de la busqueda: es lo que
      // permite verificar la idea concreta en vez de releer toda la corrida.
      sources: sources
        .filter((s) => proposal.sourceUrls?.includes(s.url))
        .map((s) => ({ title: s.title, url: s.url, source: s.source })),
      status: isDuplicate ? ("duplicate" as const) : ("pending" as const),
      similarityScore: match ? match.similarity.toFixed(4) : null,
      similarToVideoId: match?.videoId ?? null,
      searchQuery,
    });
  }

  await db.insert(topicProposals).values(rows);

  const duplicates = rows.filter((r) => r.status === "duplicate").length;
  logger.info(
    `Temas propuestos: ${rows.length - duplicates} nuevos, ${duplicates} descartados por parecidos a videos ya hechos`,
  );
}

/**
 * El guion anterior mas parecido a una idea, por distancia coseno sobre los embeddings que el
 * pipeline ya guarda en `video_memory`.
 *
 * Se compara contra los GUIONES (`contentType = 'script'`) y no contra los titulos porque un titulo
 * es una frase de gancho: dos titulos muy distintos pueden esconder la misma historia, y es la
 * historia lo que no se quiere repetir.
 */
async function findMostSimilarScript(
  themeId: string,
  text: string,
): Promise<{ videoId: string; similarity: number } | null> {
  const embeddingProvider = await resolveEmbeddingProvider();
  const { result: embedding } = await embeddingProvider.embed({ text });

  const [row] = await db
    .select({
      videoId: videoMemory.videoId,
      similarity: sql<number>`1 - (${cosineDistance(videoMemory.embedding, embedding)})`,
    })
    .from(videoMemory)
    .where(sql`${videoMemory.themeId} = ${themeId} AND ${videoMemory.contentType} = 'script'`)
    .orderBy((t) => cosineDistance(videoMemory.embedding, embedding))
    .limit(1);

  if (!row?.videoId) return null;
  return { videoId: row.videoId, similarity: Number(row.similarity) };
}

/**
 * Consulta por defecto cuando el usuario no escribe una.
 *
 * Va en español y pide explicitamente lo poco conocido: buscar el nombre del tema a secas devuelve
 * las mismas paginas introductorias siempre, que es justo el material del que NO puede salir una
 * idea que el canal no haya contado ya.
 */
function defaultQueryFor(themeName: string): string {
  return `${themeName} datos poco conocidos hallazgos historicos sorprendentes`;
}

function toResearchSource(result: SearchResult): TopicResearchSource {
  return { title: result.title, url: result.url, snippet: result.snippet, source: result.source };
}

/** Una propuesta sin idea desarrollada no sirve: es lo que se le pasa al guionista tal cual. */
function isUsable(proposal: ProposedTopic): boolean {
  return (
    Boolean(proposal?.title?.trim()) &&
    Boolean(proposal?.angle?.trim()) &&
    (proposal?.idea?.trim().length ?? 0) >= 40
  );
}
