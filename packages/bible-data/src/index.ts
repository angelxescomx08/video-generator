import bible from "./reina-valera-1909.json";

export interface BiblePassage { reference: string; text: string; score: number; }
type Bible = Record<string, Record<string, Record<string, string>>>;
const data = bible as Bible;

/** Local lexical retrieval keeps every proposed reference traceable to the bundled RVR1909 text. */
export function searchBible(query: string, limit = 8): BiblePassage[] {
  const terms = normalize(query).split(" ").filter((word) => word.length >= 4);
  if (terms.length === 0) return [];
  const hits: BiblePassage[] = [];
  for (const [book, chapters] of Object.entries(data)) {
    for (const [chapter, verses] of Object.entries(chapters)) {
      for (const [verse, verseText] of Object.entries(verses)) {
        const haystack = normalize(`${book} ${verseText}`);
        const score = terms.reduce((sum, term) => sum + (haystack.includes(term) ? 1 : 0), 0);
        if (score > 0) hits.push({ reference: `${book} ${chapter}:${verse} (RVR1909)`, text: verseText, score });
      }
    }
  }
  return hits.sort((a, b) => b.score - a.score || a.reference.localeCompare(b.reference)).slice(0, limit);
}

function normalize(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}
