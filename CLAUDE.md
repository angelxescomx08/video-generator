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
