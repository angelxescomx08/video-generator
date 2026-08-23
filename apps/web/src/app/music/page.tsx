import { db, musicTracks } from "@/lib/db";
import { desc } from "drizzle-orm";
import { MusicUploadForm } from "@/components/music-upload-form";
import { MusicLibraryList } from "@/components/music-library-list";
import { BACKGROUND_MUSIC_LEVELS, DEFAULT_BACKGROUND_MUSIC_DB } from "@video-generator/types";

export const dynamic = "force-dynamic";

export default async function MusicLibraryPage() {
  const tracks = await db.select().from(musicTracks).orderBy(desc(musicTracks.createdAt));

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Musica</h1>
        <p className="text-sm text-muted-foreground">
          Tu biblioteca de canciones. Se suben una vez y se pueden poner en cualquier video como musica
          de fondo; cambiar la cancion solo vuelve a correr ffmpeg, no gasta llamadas de IA ni de voz.
        </p>
      </div>

      <MusicUploadForm />

      <div className="space-y-3">
        <h2 className="font-semibold">Canciones ({tracks.length})</h2>
        <MusicLibraryList tracks={tracks} />
      </div>

      <div className="space-y-2 rounded-lg border border-border bg-muted/50 p-4">
        <h2 className="text-sm font-semibold">Sobre el volumen de fondo</h2>
        <p className="text-xs text-muted-foreground">
          La musica se mezcla por debajo de la narracion. Por defecto queda en{" "}
          <span className="font-medium text-foreground">{DEFAULT_BACKGROUND_MUSIC_DB} dB</span>, que cumple
          la recomendacion de accesibilidad de la W3C (al menos 20 dB por debajo de la voz) y cae en el
          rango que se usa para locucion (-20 a -25 dB).
        </p>
        <ul className="space-y-1 text-xs text-muted-foreground">
          {BACKGROUND_MUSIC_LEVELS.map((level) => (
            <li key={level.id}>
              <span className="font-medium text-foreground">
                {level.label} ({level.db} dB)
              </span>{" "}
              — {level.hint}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
