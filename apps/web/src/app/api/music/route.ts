import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadEnv } from "@video-generator/config";
import { db, musicTracks } from "@/lib/db";
import { YOUTUBE_AUDIO_GENRES, YOUTUBE_AUDIO_MOODS } from "@video-generator/types";
import { desc } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

const MAX_SIZE_BYTES = 30 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set([".mp3", ".wav", ".m4a", ".aac", ".ogg", ".opus", ".flac"]);

/** Campos que acompanan al archivo en el multipart. Los generos/moods se validan contra las listas
 * de YouTube para que la biblioteca use el mismo vocabulario que las sugerencias de la IA. */
const uploadMetaSchema = z.object({
  title: z.string().min(1).max(200),
  artist: z.string().max(200).optional(),
  attribution: z.string().max(500).optional(),
  durationSeconds: z.coerce.number().int().positive().optional(),
  genres: z.array(z.enum(YOUTUBE_AUDIO_GENRES)).max(3),
  moods: z.array(z.enum(YOUTUBE_AUDIO_MOODS)).max(3),
});

export async function GET() {
  const rows = await db.select().from(musicTracks).orderBy(desc(musicTracks.createdAt));
  return NextResponse.json(rows);
}

export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Se esperaba multipart/form-data" }, { status: 400 });

  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Falta el archivo" }, { status: 400 });
  if (file.size === 0) return NextResponse.json({ error: "El archivo esta vacio" }, { status: 400 });
  if (file.size > MAX_SIZE_BYTES) {
    return NextResponse.json({ error: `El archivo pasa de ${MAX_SIZE_BYTES / 1024 / 1024} MB` }, { status: 400 });
  }

  const extension = path.extname(file.name).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(extension)) {
    return NextResponse.json(
      { error: `Extension no soportada (${extension || "sin extension"}). Permitidas: ${[...ALLOWED_EXTENSIONS].join(", ")}` },
      { status: 400 },
    );
  }

  const parsed = uploadMetaSchema.safeParse({
    title: form.get("title") ?? undefined,
    artist: form.get("artist") || undefined,
    attribution: form.get("attribution") || undefined,
    durationSeconds: form.get("durationSeconds") || undefined,
    genres: form.getAll("genres").map(String),
    moods: form.getAll("moods").map(String),
  });
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const env = loadEnv();
  // path.resolve es obligatorio: web y worker corren con cwd distintos (apps/web y apps/worker), asi
  // que guardar una ruta relativa hacia "./data/music" hace que el worker busque el archivo en otra
  // carpeta real y ffmpeg falle con ENOENT. La ruta que va a la DB tiene que ser absoluta.
  const libraryDir = path.resolve(env.MUSIC_LIBRARY_DIR);
  await mkdir(libraryDir, { recursive: true });

  // Nombre generado, no el del usuario: evita colisiones y cualquier intento de path traversal.
  const storedName = `${randomUUID()}${extension}`;
  const filePath = path.join(libraryDir, storedName);
  await writeFile(filePath, Buffer.from(await file.arrayBuffer()));

  const [row] = await db
    .insert(musicTracks)
    .values({
      title: parsed.data.title,
      artist: parsed.data.artist,
      attribution: parsed.data.attribution,
      filePath,
      originalFilename: file.name,
      mimeType: file.type || null,
      sizeBytes: file.size,
      durationSeconds: parsed.data.durationSeconds,
      genres: parsed.data.genres,
      moods: parsed.data.moods,
    })
    .returning();

  return NextResponse.json(row, { status: 201 });
}
