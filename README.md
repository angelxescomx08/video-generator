# Video Generator

Generador de videos largos y Shorts de YouTube usando IA, con material de stock libre de
copyright, narración por voz sintética, subtítulos, publicación en YouTube/Facebook, y un loop
de memoria + feedback que mejora la generación con el tiempo.

## Arquitectura

```
apps/web (Next.js UI + API routes) --encola job--> pg-boss (tablas en Postgres) --pull--> apps/worker
apps/web y apps/worker comparten Postgres (Drizzle) via packages/db
apps/worker es el unico proceso que llama a los adapters de IA/TTS/stock/social y corre ffmpeg
```

- **apps/web** nunca llama a un LLM/TTS/ffmpeg directamente: solo encola jobs y lee estado de la DB.
- **apps/worker** es un proceso Node de larga duración que consume las colas de pg-boss y hace
  el trabajo pesado (LLM, TTS, descarga de stock footage, render con ffmpeg, publicación).
- Todo proveedor externo va detrás de un **patrón adaptador**: se puede cambiar de proveedor
  (IA, voz, stock footage) sin tocar el resto del código, vía variables de entorno o la tabla
  `provider_configs`.

## Stack

- Next.js 15 + TypeScript, Tailwind CSS + shadcn/ui (componentes en `apps/web/src/components/ui`)
- Postgres (con extensión `pgvector`) vía Docker, ORM Drizzle
- Cola de jobs: `pg-boss` (usa el mismo Postgres, sin Redis)
- Monorepo pnpm workspaces
- Render de video: worker Node + ffmpeg (`fluent-ffmpeg`)

## Estructura del proyecto

| Carpeta | Contenido |
|---|---|
| `apps/web` | UI Next.js: dashboard, creación de videos, temas, feedback, settings, analytics, y las API routes |
| `apps/worker` | Proceso que consume pg-boss: genera guion, TTS, stock footage, EDL, render ffmpeg, publicación, stats |
| `packages/db` | Schema Drizzle, cliente, migraciones, seed de temas |
| `packages/config` | Validación de env vars (zod) y utilidades de cifrado de tokens OAuth |
| `packages/types` | Tipos compartidos: Edit Decision List (EDL), DTOs de requests |
| `packages/queue` | Cliente pg-boss + nombres de colas + schemas de payload |
| `packages/ai-providers` | Adaptador de IA de texto: Ollama (default), OpenAI, Gemini, Anthropic |
| `packages/tts-providers` | Adaptador de voz: Piper/Coqui (locales, gratis), ElevenLabs, Azure (pago) |
| `packages/stock-providers` | Adaptador de stock footage: Pixabay/Pexels (gratis), Shutterstock/Storyblocks (pago) |
| `packages/social-providers` | Adaptador de redes: YouTube Data/Analytics API, Facebook Graph API |
| `docker/` | Dockerfiles e init scripts (Postgres extensions, servidor HTTP de Piper) |

## Requisitos

- Node.js >= 20, pnpm >= 9
- Docker Desktop (para Postgres, Ollama, Piper, Adminer)
- ffmpeg (si corres `apps/worker` fuera de Docker; el contenedor `worker` ya lo incluye)

## Setup inicial

```bash
pnpm install
cp .env.example .env        # completa las API keys que quieras usar
pnpm docker:up:deps         # levanta postgres + ollama + tts (piper) + adminer
pnpm db:migrate             # aplica el schema
pnpm db:seed                # inserta temas de ejemplo (cristianismo/biblia + general)
pnpm dev                    # corre web (localhost:3000) y worker en paralelo
```

Primera vez con Ollama, descarga el modelo:

```bash
docker exec -it <container_ollama> ollama pull llama3.1:8b
docker exec -it <container_ollama> ollama pull nomic-embed-text
```

## Docker Compose

- `pnpm docker:up:deps` levanta solo `postgres`, `ollama`, `tts`, `adminer` — ideal para dev,
  corriendo `web`/`worker` nativos con `pnpm dev` para HMR rápido.
- `pnpm docker:up` levanta todo el stack en contenedores (incluye `web` y `worker`), útil para
  probar un entorno "todo dockerizado" más parecido a producción.
- Adminer queda disponible en `http://localhost:8081` para inspeccionar la base de datos.

## El patrón adaptador (cómo cambiar de proveedor)

Cada tipo de proveedor externo (IA, TTS, stock footage, redes sociales) define una interfaz en
`packages/<tipo>-providers/src/types.ts` y expone un `registry.ts` con una función
`resolveProvider()` que:

1. Busca una fila `is_default=true` en la tabla `provider_configs` para ese `provider_type`.
2. Si no hay override en DB, usa la variable de entorno correspondiente (`AI_PROVIDER`,
   `TTS_PROVIDER`, etc).

Para agregar un proveedor nuevo: crear `mi-proveedor.provider.ts` implementando la interfaz,
registrarlo en el `switch` de `registry.ts`, y listo — nada más en el codebase necesita cambiar.
La UI en `/settings/providers` permite cambiar el default sin tocar `.env`.

## Cómo agregar un tema nuevo

Los temas viven en la tabla `themes` (no hardcodeados). Desde `/themes/new` en la UI se puede
crear uno con: `system_prompt` (personalidad/estilo de la IA), `script_prompt_template` (usa
`{{topic}}`, `{{memory}}`, `{{feedback}}`), y una voz por defecto. El tema "cristianismo/biblia"
viene precargado por el seed, pero el sistema es genérico para cualquier nicho.

## Pipeline de generación (paso a paso)

1. **generate-script**: recupera memoria semántica (pgvector) + hechos ya usados + feedback
   reciente del tema, arma el prompt y llama al `AIProvider` para generar guion + escenas.
2. **generate-tts**: sintetiza audio por escena (permite timing preciso por escena).
3. **fetch-stock-footage**: busca clips por palabras clave de cada escena en los proveedores de
   stock habilitados (Pixabay + Pexels por defecto), respetando orientación (vertical para Shorts).
4. **build-edl**: concatena el audio de las escenas, pide a la IA una Edit Decision List (efectos,
   transiciones, subtítulos por escena); si la IA falla, usa un EDL determinístico de respaldo.
5. **render-video**: ffmpeg arma el video final (ken burns, zoom punch, subtítulos quemados, mezcla
   de audio) según el EDL.
6. **publish-video** (acción manual del usuario): sube el video a YouTube y/o Facebook.
7. **poll-stats**: job recurrente (cada 6h) que trae vistas/likes/retención y, si detecta señales
   fuertes, genera feedback automático que retroalimenta la siguiente generación del mismo tema.

## Memoria y feedback de la IA

Postgres + `pgvector` funcionan como memoria de largo plazo: cada guion generado y cada feedback
(manual o derivado de estadísticas) se embeben y guardan en `video_memory`. Antes de generar un
guion nuevo, se recupera el top-k más similar semánticamente (para tono/estilo consistente) más
una lista exacta de "no repetir" (`generation_history`, ej. versículos ya usados) y un resumen de
feedback reciente — todo se inyecta en el prompt. Ver `apps/worker/src/memory/retrieve.ts`.

## Variables de entorno

Ver `.env.example` para la lista completa con comentarios. Los proveedores gratuitos (Ollama,
Piper, Pixabay, Pexels) no requieren nada además de tenerlos corriendo/con API key gratuita; los
de pago (OpenAI, Gemini, Anthropic, ElevenLabs, Azure, Shutterstock, Storyblocks) requieren su
propia API key.

## Troubleshooting

- **ffmpeg not found**: instala ffmpeg localmente si corres el worker fuera de Docker, o usa
  `FFMPEG_PATH` en `.env` para apuntar al binario.
- **Ollama responde vacío/error**: confirma que el modelo esté descargado (`ollama pull ...`)
  dentro del contenedor.
- **pgvector: type "vector" does not exist**: la extensión no se creó; revisa que
  `docker/postgres/init/001-extensions.sql` corrió (solo se ejecuta en un volumen de datos nuevo;
  si el volumen ya existía, corre el SQL manualmente).
- **No se encuentra stock footage**: revisa que `PIXABAY_API_KEY`/`PEXELS_API_KEY` estén seteadas.

## Limitaciones conocidas / roadmap

- Las transiciones `crossfade`/`fade_black` del EDL están modeladas en el tipo y hay un helper de
  `xfade` (`apps/worker/src/ffmpeg/filters/crossfade.ts`) pero el pipeline de render por defecto
  usa `concat` (corte simple) entre escenas para garantizar sincronía exacta audio/video; migrar a
  transiciones con solape requiere también crossfade de audio en los mismos puntos.
- El OAuth de Facebook no captura todavía el Page ID (`externalAccountId`) automáticamente; hay
  que setearlo a mano (ej. con `pnpm db:studio`) la primera vez antes de publicar en esa cuenta.
- No hay selección de música de fondo automática todavía (el campo existe en el EDL/tema pero no
  hay un adapter de música de stock conectado).
- Autenticación de la app web (multi-usuario) no está implementada; pensado para uso personal/single-tenant.
