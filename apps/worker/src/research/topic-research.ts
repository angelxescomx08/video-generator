import type { TopicResearchSource } from "@video-generator/ai-providers";
import { searchBible } from "@video-generator/bible-data";
import { loadEnv } from "@video-generator/config";
import { resolveSearchProvider, trimSnippet, type SearchResult } from "@video-generator/search-providers";
import type { CostItem } from "@video-generator/types";
import { logger } from "../util/logger";

const RESULTS_PER_QUERY = 4;
const BIBLICAL_THEME = /biblia|biblic|cristian|evangel/;

export interface TopicResearch {
  sources: TopicResearchSource[];
  cost?: CostItem;
}

/** Las consultas separan texto biblico, interpretacion y contexto para no pedirle a un solo ranking
 * que represente perspectivas distintas. */
export function researchQueriesFor(themeName: string, topic: string): string[] {
  if (BIBLICAL_THEME.test(themeName)) {
    return [
      `${topic} versiculos biblicos contexto`,
      `${topic} interpretacion teologos comentaristas biblicos`,
      `${topic} contexto historico opiniones teologicas`,
    ];
  }
  return [`${topic} fuentes primarias contexto historico`, `${topic} analisis expertos perspectivas`];
}

/**
 * Investiga una idea justo antes de escribir su guion. La fuente biblica local no cuesta ni falla;
 * la web complementa con interpretaciones y contexto y nunca frena la produccion si no responde.
 */
export async function researchTopic(themeName: string, topic: string | null): Promise<TopicResearch> {
  if (!topic?.trim()) return { sources: [] };

  const bibleSources = BIBLICAL_THEME.test(themeName) ? localBibleSources(topic) : [];
  let provider;
  try {
    provider = await resolveSearchProvider();
  } catch (error) {
    logger.warn("No se pudo resolver buscador para investigar la idea", { error: (error as Error).message });
    return { sources: bibleSources };
  }

  const queries = researchQueriesFor(themeName, topic);
  const settled = await Promise.allSettled(
    queries.map((query) => provider.search({ query, limit: RESULTS_PER_QUERY, language: "es" })),
  );
  const webSources = settled.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
  const failures = settled.filter((result) => result.status === "rejected");
  if (failures.length > 0) {
    logger.warn("Algunas consultas de investigacion fallaron", { provider: provider.name, failed: failures.length });
  }

  const env = loadEnv();
  const cost: CostItem = {
    stage: "research",
    providerType: "search",
    providerName: provider.name,
    isFree: env.SEARCH_COST_PER_QUERY_USD === 0,
    isLocal: provider.name === "playwright" || provider.name === "searxng",
    amountUsd: env.SEARCH_COST_PER_QUERY_USD * queries.length,
    units: queries.length,
    unitKind: "searches",
    detail: `${queries.length} consultas (${webSources.length} resultados web; ${bibleSources.length} pasajes locales)`,
  };

  return { sources: deduplicate([...bibleSources, ...webSources.map(toResearchSource)]), cost };
}

function localBibleSources(topic: string): TopicResearchSource[] {
  const matches = searchBible(topic, RESULTS_PER_QUERY);
  return matches.map((passage) => ({
    title: passage.reference,
    url: `bible://rvr1909/${encodeURIComponent(passage.reference)}`,
    snippet: trimSnippet(passage.text),
    source: "Biblia Reina-Valera 1909",
  }));
}

function toResearchSource(result: SearchResult): TopicResearchSource {
  return { title: result.title, url: result.url, snippet: trimSnippet(result.snippet), source: result.source };
}

function deduplicate(sources: TopicResearchSource[]): TopicResearchSource[] {
  const seen = new Set<string>();
  return sources.filter((source) => {
    if (seen.has(source.url)) return false;
    seen.add(source.url);
    return true;
  });
}
