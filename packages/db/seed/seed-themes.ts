import { db, pool } from "../src/client";
import { themes } from "../src/schema";

const seedThemes = [
  {
    slug: "christianity",
    name: "Cristianismo / Biblia",
    description: "Videos devocionales y reflexiones basadas en la Biblia.",
    systemPrompt:
      "Eres un guionista cristiano que crea reflexiones bíblicas breves, cálidas y esperanzadoras, " +
      "fieles al texto original, sin ser divisivo entre denominaciones.",
    scriptPromptTemplate:
      "Escribe el guion de un video sobre: {{topic}}. " +
      "Duración objetivo: {{targetDurationSeconds}} segundos. " +
      "Incluye un versículo bíblico relevante y una aplicación práctica para la vida diaria. " +
      "Contexto de generaciones previas (no repetir exactamente): {{memory}} " +
      "Feedback reciente a considerar: {{feedback}}",
    defaultVoiceId: "es_ES-davefx-medium",
    defaultMusicTags: ["ambient", "peaceful", "worship"],
  },
  {
    slug: "general",
    name: "General",
    description: "Tema genérico de ejemplo para probar otros nichos.",
    systemPrompt: "Eres un guionista versátil que crea contenido educativo e interesante.",
    scriptPromptTemplate:
      "Escribe el guion de un video sobre: {{topic}}. " +
      "Duración objetivo: {{targetDurationSeconds}} segundos. " +
      "Contexto de generaciones previas (no repetir exactamente): {{memory}} " +
      "Feedback reciente a considerar: {{feedback}}",
    defaultVoiceId: "en_US-lessac-medium",
    defaultMusicTags: ["upbeat", "corporate"],
  },
];

async function main() {
  for (const theme of seedThemes) {
    await db.insert(themes).values(theme).onConflictDoNothing({ target: themes.slug });
  }
  console.log(`Seeded ${seedThemes.length} themes`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
