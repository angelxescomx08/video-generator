import { z } from "zod";

/**
 * Catalogo de metricas de rendimiento de un video publicado. Es la fuente unica de verdad para tres
 * consumidores: el formulario manual de /videos/[id]/performance (labels + tooltips), el provider de
 * YouTube (que metricas pedir a la Analytics API) y el motor de aprendizaje global
 * (apps/worker/src/memory/performance.ts, que decide cuales son senal utilizable).
 *
 * La `importance` no es cosmetica: solo las metricas `critical` alimentan el aprendizaje global,
 * porque son las unicas que discriminan entre "el guion fallo" y "no tuvo distribucion". Las
 * `context` se guardan para poder interpretar las criticas, y las `vanity` se guardan solo para
 * mostrarlas (views absolutas no dicen nada sin un baseline).
 */
export const METRIC_IMPORTANCE = ["critical", "context", "vanity"] as const;
export type MetricImportance = (typeof METRIC_IMPORTANCE)[number];

export interface YoutubeMetricDef {
  /** Coincide con la columna de video_stats y con la llave del payload manual. */
  key: string;
  label: string;
  importance: MetricImportance;
  unit: "count" | "percent" | "seconds" | "hours";
  /** Que mide y por que importa (o por que no). */
  help: string;
  /** Ruta exacta en YouTube Studio para encontrarlo a mano. */
  whereToFind: string;
  /** Nombre de la metrica en la YouTube Analytics API, si se puede jalar automaticamente. */
  apiMetric?: string;
}

export const YOUTUBE_METRICS: readonly YoutubeMetricDef[] = [
  {
    key: "retentionAtStartPercentage",
    label: "Retencion a los 3 segundos",
    importance: "critical",
    unit: "percent",
    help: "De los que abrieron el video, cuantos siguen ahi al segundo 3. Es la nota del GANCHO y nada mas: si esto esta bajo, el problema son las primeras palabras del guion, no el resto del video. Es la metrica mas accionable de todas.",
    whereToFind:
      "Studio > el video > Estadisticas > pestana Interaccion > grafica 'Retencion de la audiencia'. Pasa el cursor sobre el segundo 3 y lee el porcentaje. Tarda hasta 2 dias en aparecer despues de subir el video.",
    apiMetric: "audienceWatchRatio",
  },
  {
    key: "stayedToWatchPercentage",
    label: "Se quedaron viendo (Shorts)",
    importance: "critical",
    unit: "percent",
    help: "En Shorts, el porcentaje que NO hizo swipe de inmediato. Mide la portada + el primer frame + el gancho juntos. Es el equivalente al CTR en videos largos: si esta bajo, ni siquiera le dieron oportunidad al guion.",
    whereToFind:
      "Studio > el video > Estadisticas > tarjeta 'Como han interactuado los usuarios'. Es el porcentaje de 'Se quedaron viendo' (el complemento de 'Saltaron el contenido').",
  },
  {
    key: "avgViewPercentage",
    label: "Porcentaje medio visto",
    importance: "critical",
    unit: "percent",
    help: "Que fraccion del video se ve en promedio. Es la nota del guion COMPLETO: mide si el desarrollo y el cierre sostienen lo que prometio el gancho. Comparable entre videos de distinta duracion, a diferencia de la duracion media.",
    whereToFind:
      "Studio > el video > Estadisticas > pestana Interaccion. Aparece como 'Porcentaje medio visto'. Si solo ves 'Duracion media de las visualizaciones', dividela entre la duracion total del video.",
    apiMetric: "averageViewPercentage",
  },
  {
    key: "impressionsCtr",
    label: "CTR de impresiones",
    importance: "critical",
    unit: "percent",
    help: "De cada 100 personas a las que YouTube les mostro la miniatura, cuantas hicieron clic. Mide TITULO Y MINIATURA, no el guion. Separarlo es lo que evita que la IA reescriba el guion cuando el problema era el titulo.",
    whereToFind:
      "Studio > el video > Estadisticas > pestana Alcance > 'Porcentaje de clics de las impresiones'. En Shorts suele no existir; ahi usa 'Se quedaron viendo'.",
    apiMetric: "impressionsClickThroughRate",
  },
  {
    key: "subscribersGained",
    label: "Suscriptores ganados",
    importance: "critical",
    unit: "count",
    help: "Cuanta gente se suscribio por este video. Es la senal de calidad mas honesta que existe: alguien vio el video y decidio que queria mas. Vale mucho mas que las views.",
    whereToFind: "Studio > el video > Estadisticas > pestana Audiencia > 'Suscriptores'.",
    apiMetric: "subscribersGained",
  },
  {
    key: "engagedViews",
    label: "Visualizaciones interesadas",
    importance: "context",
    unit: "count",
    help: "Veces que alguien vio mas alla de los primeros segundos. Sirve como tamano de muestra: con menos de ~100 cualquier porcentaje de arriba es ruido estadistico y no se debe usar para aprender.",
    whereToFind: "Studio > el video > Estadisticas > tarjeta 'Visualizaciones interesadas' (arriba).",
  },
  {
    key: "avgViewDurationSeconds",
    label: "Duracion media de visualizacion",
    importance: "context",
    unit: "seconds",
    help: "Segundos vistos en promedio. Util para leer la retencion en terminos absolutos, pero NO es comparable entre videos de distinta duracion — para eso usa el porcentaje medio visto.",
    whereToFind:
      "Studio > el video > Estadisticas > tarjeta 'Duracion media de las visualizaciones' (formato m:ss).",
    apiMetric: "averageViewDuration",
  },
  {
    key: "watchTimeHours",
    label: "Tiempo de visualizacion (horas)",
    importance: "context",
    unit: "hours",
    help: "Horas totales acumuladas. Es views x duracion media, asi que no aporta senal nueva sobre la calidad; importa para monetizacion, no para decidir como escribir el proximo guion.",
    whereToFind: "Studio > el video > Estadisticas > tarjeta 'Tiempo de visualizacion (horas)'.",
    apiMetric: "estimatedMinutesWatched",
  },
  {
    key: "impressions",
    label: "Impresiones",
    importance: "context",
    unit: "count",
    help: "Cuantas veces YouTube mostro la miniatura. Es el denominador del CTR. Tambien detecta el caso 'no fue malo, simplemente no lo distribuyeron': pocas impresiones explican pocas views sin que el contenido tenga la culpa.",
    whereToFind: "Studio > el video > Estadisticas > pestana Alcance > 'Impresiones'.",
    apiMetric: "impressions",
  },
  {
    key: "views",
    label: "Visualizaciones",
    importance: "vanity",
    unit: "count",
    help: "El total crudo. Depende mas de cuanto te empujo el algoritmo que de la calidad del video, y crece con la edad del video, asi que por si sola no sirve para comparar. Se guarda para mostrarla, no para aprender de ella.",
    whereToFind: "Studio > el video > Estadisticas > tarjeta de visualizaciones.",
    apiMetric: "views",
  },
  {
    key: "likes",
    label: "Likes",
    importance: "vanity",
    unit: "count",
    help: "Se interpreta solo como ratio sobre las views; el numero absoluto escala con la distribucion, no con la calidad.",
    whereToFind: "Studio > el video > Estadisticas > pestana Interaccion > 'Me gusta'.",
    apiMetric: "likes",
  },
  {
    key: "comments",
    label: "Comentarios",
    importance: "vanity",
    unit: "count",
    help: "Buen indicador de que el video genero conversacion, pero muy sensible al tema (la polemica comenta mas que la calidad). Se guarda como contexto.",
    whereToFind: "Studio > el video > Estadisticas > pestana Interaccion > 'Comentarios anadidos'.",
    apiMetric: "comments",
  },
  {
    key: "shares",
    label: "Compartidos",
    importance: "vanity",
    unit: "count",
    help: "Cuantas veces se compartio. Senal fuerte pero de volumen bajo: casi siempre son numeros demasiado chicos para aprender algo de ellos.",
    whereToFind: "Studio > el video > Estadisticas > pestana Interaccion > 'Compartidos'.",
    apiMetric: "shares",
  },
] as const;

export const CRITICAL_METRIC_KEYS = YOUTUBE_METRICS.filter((m) => m.importance === "critical").map(
  (m) => m.key,
);

/** Un punto de la curva de retencion: en `elapsedRatio` del video, `watchRatio` seguia viendo. */
export const retentionPointSchema = z.object({
  elapsedRatio: z.number().min(0).max(1),
  watchRatio: z.number().min(0),
});
export type RetentionPoint = z.infer<typeof retentionPointSchema>;

/**
 * Payload del formulario manual. Todo es opcional a proposito: YouTube libera las metricas en
 * momentos distintos (la curva de retencion tarda ~2 dias, el CTR no existe en Shorts), y forzar
 * campos obligatorios llevaria a inventar ceros — que el motor de aprendizaje leeria como
 * "rendimiento pesimo" en vez de "todavia no hay dato".
 */
export const manualStatsRequestSchema = z.object({
  views: z.number().int().min(0).optional(),
  likes: z.number().int().min(0).optional(),
  comments: z.number().int().min(0).optional(),
  shares: z.number().int().min(0).optional(),
  engagedViews: z.number().int().min(0).optional(),
  impressions: z.number().int().min(0).optional(),
  subscribersGained: z.number().int().min(0).optional(),
  watchTimeHours: z.number().min(0).optional(),
  avgViewDurationSeconds: z.number().min(0).optional(),
  avgViewPercentage: z.number().min(0).max(100).optional(),
  impressionsCtr: z.number().min(0).max(100).optional(),
  stayedToWatchPercentage: z.number().min(0).max(100).optional(),
  retentionAtStartPercentage: z.number().min(0).max(100).optional(),
  notes: z.string().max(2000).optional(),
});
export type ManualStatsRequest = z.infer<typeof manualStatsRequestSchema>;

/**
 * Muestra minima para que un porcentaje sea senal y no ruido. Por debajo de esto el motor de
 * aprendizaje global ignora el snapshot en vez de aprender de 12 visualizaciones.
 */
export const MIN_VIEWS_FOR_LEARNING = 100;

/**
 * Dias que deben pasar desde la publicacion antes de derivar aprendizaje de un video. YouTube sigue
 * repartiendo impresiones los primeros dias y la curva de retencion no existe hasta ~48h, asi que
 * medir antes es medir un video a medio distribuir.
 */
export const MIN_DAYS_FOR_LEARNING = 3;
