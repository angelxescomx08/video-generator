import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { db, videos, platformAccounts, musicTracks } from "@/lib/db";
import { desc, eq } from "drizzle-orm";
import { VideoMusicPanel } from "@/components/video-music-panel";
import { VideoStatusPanel } from "@/components/job-status-badge";
import { FeedbackForm } from "@/components/feedback-form";
import { PublishPanel } from "@/components/publish-panel";
import { VideoVersionsPanel } from "@/components/video-versions-panel";
import { CostPanel } from "@/components/cost-panel";
import { AttributionPanel } from "@/components/attribution-panel";
import { AudioLibraryPanel } from "@/components/audio-library-panel";
import { YoutubeMetadataPanel } from "@/components/youtube-metadata-panel";
import { DeleteVideoButton } from "@/components/delete-video-button";
import type { EditDecisionList } from "@video-generator/types";

export const dynamic = "force-dynamic";

export default async function VideoDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const video = await db.query.videos.findFirst({ where: eq(videos.id, id) });
  if (!video) notFound();

  const accounts = await db.select().from(platformAccounts).where(eq(platformAccounts.isActive, true));
  const tracks = await db.select().from(musicTracks).orderBy(desc(musicTracks.createdAt));

  const edl = video.edl as EditDecisionList | null;
  const IN_PROGRESS = !["ready", "published", "failed"].includes(video.status);

  return (
    <div className="max-w-3xl space-y-10">
      <header className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold">{video.title ?? "Video sin titulo"}</h1>
          <p className="text-sm text-muted-foreground">
            {video.format} · {video.topic ?? "sin topico especifico"}
          </p>
        </div>
        <DeleteVideoButton videoId={video.id} />
      </header>

      {/* 1. Estado — el loader y el guion/descripcion generados */}
      <VideoStatusPanel initialVideo={video} />

      {/* 2. Metadata — los campos que se suben a YouTube, con sus limites reales */}
      <Section title="Metadata para YouTube">
        <YoutubeMetadataPanel
          title={video.title}
          description={video.description}
          tags={video.tags}
          format={video.format}
        />
      </Section>

      {/* 3. Edicion — lo que se puede cambiar sin regenerar, y el historial de versiones */}
      <Section
        title="Edicion"
        description="Ajustes que solo re-renderizan el video, sin volver a gastar en IA ni en voz."
      >
        {edl && (
          <VideoMusicPanel
            videoId={video.id}
            tracks={tracks}
            currentTrackId={edl.audio?.backgroundMusicTrackId ?? null}
            currentLabel={
              edl.audio?.backgroundMusicPath ? (edl.audio.backgroundMusicLabel ?? "Musica de fondo") : null
            }
            suggestion={edl.audio?.youtubeAudioLibrary ?? null}
            disabled={IN_PROGRESS}
          />
        )}
        <VideoVersionsPanel videoId={video.id} />
      </Section>

      {/* 3. Costos — el total de produccion y en que se fue */}
      <Section title="Costos">
        <CostPanel videoId={video.id} />
      </Section>

      {/* 4. Recursos — lo que hace falta para publicar en regla */}
      <Section
        title="Recursos y creditos"
        description="Sugerencias de musica y los creditos del material usado, para la descripcion del video."
      >
        <AudioLibraryPanel suggestion={edl?.audio?.youtubeAudioLibrary ?? null} />
        <AttributionPanel
          sceneClips={video.sceneClips as React.ComponentProps<typeof AttributionPanel>["sceneClips"]}
        />
      </Section>

      {/* 5. Publicar y 6. Feedback */}
      {video.status === "ready" && (
        <Section title="Publicar">
          <PublishPanel
            videoId={video.id}
            accounts={accounts.map((a) => ({
              id: a.id,
              label: `${a.platform}: ${a.accountLabel ?? a.externalAccountId ?? a.id}`,
            }))}
          />
        </Section>
      )}

      <Section title="Feedback" description="Alimenta la memoria que usa la IA para el proximo video del tema.">
        <FeedbackForm videoId={video.id} />
      </Section>

      {/* 7. Rendimiento — las estadisticas reales, que es de donde sale el aprendizaje global */}
      <Section
        title="Rendimiento"
        description="Como le fue una vez publicado. Es la senal mas fuerte que tiene la IA, porque son datos de la audiencia y no una opinion."
      >
        <Link
          href={`/videos/${video.id}/performance`}
          className="flex items-center justify-between gap-4 rounded-md border border-border p-4 transition-colors hover:bg-muted/50"
        >
          <div className="space-y-1">
            <p className="text-sm font-medium">Registrar como le fue</p>
            <p className="text-xs text-muted-foreground">
              Jala las metricas de YouTube con un boton o escribelas a mano. Los patrones que salen de aqui se
              aplican a todos los temas del canal, no solo a este.
            </p>
          </div>
          <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        </Link>
      </Section>
    </div>
  );
}

/** Agrupa los paneles en bloques con titulo, para que la pagina se lea como secciones y no como
 * una pila larga de tarjetas sueltas. */
function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-4">
      <div className="border-b border-border pb-2">
        <h2 className="text-lg font-semibold">{title}</h2>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      <div className="space-y-6">{children}</div>
    </section>
  );
}
