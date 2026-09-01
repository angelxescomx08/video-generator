# CLAUDE.md

Guía para trabajar en este repo con Claude Code.

## Qué es esto

Monorepo pnpm que genera videos/Shorts de YouTube con IA: guion (LLM) → voz (TTS) → stock
footage libre de copyright → Edit Decision List (efectos/transiciones decididos por IA) →
render ffmpeg → publicación en YouTube/Facebook → polling de estadísticas → feedback loop que
retroalimenta la siguiente generación. Todo proveedor externo va detrás de un patrón adaptador.

## Comandos

```bash
pnpm install                # instala todo el workspace
pnpm docker:up:deps         # postgres + ollama + tts(piper) + adminer
pnpm db:generate            # genera una migración nueva tras cambiar packages/db/src/schema
pnpm db:migrate             # aplica migraciones pendientes
pnpm db:studio              # abre Drizzle Studio
pnpm db:seed                # inserta temas de ejemplo
pnpm dev                    # corre apps/web + apps/worker en paralelo (requiere docker:up:deps antes)
pnpm typecheck              # tsc --noEmit en todos los packages/apps
pnpm build                  # build de todos los packages/apps
pnpm start                  # corre apps/web + apps/worker ya buildeados (requiere pnpm build antes)
```

No hay suite de tests todavía — al agregar una, preferir tests unitarios puros para
`apps/worker/src/ffmpeg/edl-to-ffmpeg.ts` (no requiere spawnear ffmpeg real, ver su docstring).

## Ubicación de archivos clave

| Si necesitas... | Mira en |
|---|---|
| Cambiar el schema de la DB | `packages/db/src/schema/*.ts` (luego `pnpm db:generate`) |
| Entender el flujo de generación completo | `apps/worker/src/handlers/*.handler.ts` (uno por stage) + `apps/worker/src/index.ts` |
| Agregar/editar un proveedor de IA/TTS/stock/social | `packages/<tipo>-providers/src/*.provider.ts` + su `registry.ts` |
| Cambiar cómo se arma el video final (efectos, transiciones) | `apps/worker/src/ffmpeg/edl-to-ffmpeg.ts` y `apps/worker/src/ffmpeg/filters/*.ts` |
| Cambiar el formato de la Edit Decision List | `packages/types/src/edl.ts` (zod schema — validado en `build-edl.handler.ts`) |
| Cambiar cómo se recupera memoria/contexto para el prompt | `apps/worker/src/memory/retrieve.ts` y `prompts/script-prompt.builder.ts` |
| Cambiar qué aprende la IA del rendimiento pasado | `packages/analytics/src/learnings.ts` (+ `video-attributes.ts`) |
| Agregar un corte de analíticas o de costos | `packages/analytics/src/*-queries.ts` |
| Dibujar una gráfica nueva | `apps/web/src/components/charts/*` |
| Cambiar los rangos o la agrupación temporal | `packages/analytics/src/time-range.ts` |
| Tocar la UI | `apps/web/src/app/**` (App Router) y `apps/web/src/components/**` |
| Variables de entorno | `packages/config/src/env.ts` (zod schema — agregar ahí antes de usar `process.env` en cualquier otro lado) |

## Convenciones del monorepo

- **Nunca** llamar un SDK de proveedor externo (OpenAI, Pixabay, YouTube API, etc) fuera de su
  paquete `*-providers`. Todo el código de negocio pasa por `resolveProvider()` /
  `resolveStockProviders()` / `resolveSocialProvider()` — así el patrón adaptador se mantiene real.
- Los paquetes internos se referencian como `workspace:*` en `package.json` y se importan por su
  nombre de paquete (`@video-generator/db`, no rutas relativas cruzando `apps/`/`packages/`).
- El estado real de una generación vive en Postgres (`videos`, `generation_jobs`), **no** en el
  payload de los jobs de pg-boss — los jobs solo llevan `{ videoId }`. Si necesitas pasar datos
  entre stages, guárdalos en una columna de `videos` (ver `scenes`, `sceneAudio`, `sceneClips`,
  `edl`), no en el payload de la cola.
- Cada stage del worker sigue el mismo patrón: `runStage(videoId, STAGES.x, async () => {...})`
  de `apps/worker/src/pipeline/orchestrator.ts` — actualiza `generation_jobs` y marca
  `videos.status = 'failed'` automáticamente si el callback lanza. No dupliques ese manejo de
  errores a mano en un handler nuevo.
- Nunca edites a mano archivos dentro de `packages/db/src/migrations` — siempre
  `pnpm db:generate` después de cambiar el schema.
- Tokens OAuth (`platform_accounts.access_token`/`refresh_token`) se guardan cifrados con
  `encryptSecret`/`decryptSecret` de `@video-generator/config` — nunca insertes un token en claro.
- `apps/web` es el único proceso con acceso HTTP público; nunca debe ejecutar ffmpeg ni llamar
  directamente a un LLM/TTS de forma bloqueante en un request — eso es trabajo de `apps/worker`
  vía una cola.
- Toda agregación de analíticas vive en `@video-generator/analytics` y **agrega en Postgres, con una
  sola consulta por función**. La regla no es estética: `video_stats` crece sin techo (un snapshot
  cada 6h por video publicado, para siempre) y `cost_breakdown` es un `jsonb` por versión, así que
  traer filas para reducirlas en JS hace que el tiempo de respuesta crezca con la antigüedad del
  canal. Al agregar un corte nuevo, sigue el patrón: `DISTINCT ON` para "lo último de cada video",
  `jsonb_to_recordset` para desarmar costos, y una ventana de días en todo lo que mire histórico.
- Las pantallas de analíticas son componentes de servidor que lanzan sus consultas en **un solo
  `Promise.all`**, no en `await` encadenados: cada await suelto es un viaje más a la base antes de
  poder pintar. Las gráficas son SVG renderizado en el servidor (`components/charts/`), sin librería
  de gráficas — por eso `/analytics/costs` y `/videos/[id]/analytics` bajan ~168 B de JS al cliente.
- El rango y la agrupación temporal (día/semana/mes/año) viven en la **URL** (`?r=90d&g=week`), no en
  estado de cliente: así las pantallas siguen siendo componentes de servidor, el filtro sobrevive a
  un refresco y se puede compartir como enlace. `TimeControls` son `<Link>`, no botones.
- Al elegir la forma de una gráfica: dato acumulado o continuo → línea; "cuánto hubo en este periodo"
  → columnas; categorías nominales → barras horizontales de UN color; parte-de-un-todo → barra de
  composición; dos magnitudes continuas → nube de puntos; dos dimensiones categóricas cruzadas →
  mapa de calor con rampa secuencial; una secuencia donde cada paso es subconjunto del anterior →
  embudo; y cuando la historia es un solo número, una casilla, no una gráfica.
- **`views` de YouTube es un contador ACUMULADO.** Agrupar por periodo sumando todas las capturas del
  periodo cuenta el mismo video una vez por captura. El patrón correcto está en `getChannelSeries`:
  `DISTINCT ON` para la última captura de cada video dentro del cubo, y `lag()` para el delta.
- Cada gráfica lleva un `howToRead` (**qué mide / cómo leerla / qué hacer / de dónde sale**) y una
  tabla de respaldo. No es decoración: los tonos claros de la paleta no llegan a 3:1 sobre el fondo
  blanco, y la regla de la guía de dataviz para ese caso es que los valores sean legibles fuera del
  color.
- Al tocar la paleta de series (`--chart-*` en `globals.css`), vuelve a correr el validador de la
  guía de dataviz contra los fondos reales de la app: el orden de los colores es el mecanismo que
  garantiza que se distingan bajo daltonismo, no una decisión estética.

## Patrón adaptador (repetido en ai/tts/stock/social-providers)

Cada paquete tiene la misma forma: `types.ts` (interfaz), un archivo por proveedor
(`x.provider.ts`), y `registry.ts` con la lógica de selección (tabla `provider_configs` primero,
env var como fallback). Al agregar un proveedor nuevo: implementar la interfaz, agregarlo al
`switch` del registry, y agregar sus env vars a `packages/config/src/env.ts` +
`.env.example`. No se necesita tocar nada más — ni la UI (`/settings/providers` ya lista los
nombres conocidos) ni los handlers del worker (llaman siempre a través del registry).

## Notas de implementación específicas

- `packages/db/src/schema/video-memory.ts`: la dimensión del embedding (`EMBEDDING_DIMENSIONS`,
  hoy 768 para `nomic-embed-text` de Ollama) debe coincidir con el modelo de `EMBEDDING_PROVIDER`.
  Cambiar de proveedor de embeddings a uno con otra dimensión requiere una migración de columna.
- El render de video usa `concat` (no `xfade`) entre escenas por defecto — ver la sección de
  limitaciones conocidas en el README antes de "arreglar" las transiciones crossfade, es una
  decisión deliberada por sincronía audio/video, no un bug.
- El feedback del usuario se embebe inmediatamente en la API route
  (`apps/web/src/app/api/videos/[id]/feedback/route.ts`), no en el worker — es la única lógica de
  memoria que vive en `apps/web` en vez de `apps/worker`, porque es una escritura barata y no
  bloquea ningún render.
- Los paquetes internos (`packages/*`) exponen `main`/`types` apuntando directo a `./src/index.ts`
  (sin paso de build propio) — funciona en `dev` (tsx/webpack transpilan TS al vuelo) y en el build
  de `apps/web` (Next bundlea las fuentes TS de los workspaces), pero `node` puro no puede resolver
  esos imports `.ts`. Por eso `apps/worker`'s `start` corre `tsx src/index.ts` en vez de
  `node dist/index.js`: el `dist/` que genera `pnpm --filter worker build` (tsc) queda con imports
  a paquetes hermanos que un `node` normal no puede cargar.
- Los scripts `build`/`start` de `apps/web` cargan el `.env` de la raíz con `dotenv-cli` y fuerzan
  `-v NODE_ENV=production` explícito: el `.env` trae `NODE_ENV=development` para `dev`, y como
  `dotenv-cli` no sobreescribe variables ya puestas en el entorno, sin ese `-v` el build de Next
  corre en modo dev y rompe el prerender (`<Html> should not be imported outside of pages/_document`).
- **Del EDL que devuelve el LLM, lo único que sobrevive al render son los `effect` de cada escena.**
  El worker recalcula tiempos (`reconcileSceneTiming` sobre la duración medida del TTS), reasigna
  clips, y pisa `captions.enabled`/`style`; y `transitionOut` ni siquiera se aplica (el render encadena
  con `concat`). Por eso los campos que el worker sobreescribe llevan `.default()` en
  `packages/types/src/edl.ts`: pedírselos al modelo solo agrandaba la superficie donde el EDL entero
  podía fallar la validación. Al agregar un campo nuevo al EDL, pregúntate primero si el worker lo va
  a pisar — si sí, va con default y fuera del `responseSchema` del provider.
- **Nunca analices `transitionTypes` como causa de rendimiento.** Se guarda en el EDL pero no se
  renderiza (ver el punto anterior), así que cruzarlo contra la retención mide una decisión que nunca
  llegó a pantalla. Está anotado en `video-attributes.ts` para que no se agregue como dimensión.
- `generateEDL` de Gemini **requiere `responseSchema`**, igual que `generateScript`. Sin él,
  `responseMimeType: "application/json"` hace que devuelva JSON, pero no JSON con la forma del EDL, y
  `editDecisionListSchema.safeParse` lo rechaza: el video cae al fallback determinista pagando igual
  la llamada. Pasó en los primeros 19 videos del canal y el único rastro era un `logger.warn`.
- `edl.generatedBy` (`"ai" | "fallback"`) marca quién decidió el montaje. Es el canario de lo
  anterior: si empieza a salir `"fallback"` en la UI o en los logs, la generación de EDL está rota,
  no es un detalle cosmético — significa que el video se montó sin decisiones editoriales.
- **Una escena es un plano**, así que `SECONDS_PER_SCENE` en `script-prompt.builder.ts` decide cada
  cuánto cambia la imagen — es la palanca de retención más barata del pipeline y por eso está
  separada por formato (`short: 5`, `long: 10`). Los cortes rápidos son una recomendación de formato
  vertical; aplicarle ese ritmo a un video largo de 10 min daría 120 escenas y 120 descargas de stock
  sin ganar nada. Subir los cortes NO cambia el presupuesto de palabras: reparte las mismas palabras
  entre más escenas, así que cada escena queda en una sola frase.
- El fetch de stock **deduplica clips dentro de un mismo video** (los ya usados se prueban al final,
  no se descartan). Sin eso, dos escenas con keywords parecidas reciben el mismo clip del banco y el
  plano no cambia justo donde debería — y el problema empeora cuantas más escenas hay. Si en los logs
  `uniqueClips < scenes`, es que varias escenas están pidiendo lo mismo en `visualKeywords`.
- **El motor de aprendizaje solo puede aprender de atributos que VARÍAN entre videos.** Una dimensión
  donde todos los videos caen en el mismo grupo no está "esperando muestra": no puede aprender nunca,
  porque no existe el grupo contra el cual comparar. `analyzeCoverage` en `learnings.ts` distingue
  esos casos (`sin_variacion` vs `muestra_insuficiente`) y la UI los muestra en
  "Lo que la IA todavía no puede aprender". Antes de agregar una dimensión nueva, revisa en la base
  si el atributo de verdad varía — si el pipeline lo genera siempre igual, la dimensión nace muerta.
- `pnpm start` (raíz) requiere haber corrido `pnpm build` antes — solo levanta lo ya compilado,
  no compila nada. Usa el mismo puerto 3001 que `dev` para `apps/web`; si tienes otro proceso local
  en ese puerto (de otro proyecto), falla con `EADDRINUSE`.
