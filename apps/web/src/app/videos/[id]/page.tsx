import { notFound } from "next/navigation";
import { db, videos, platformAccounts } from "@/lib/db";
import { eq } from "drizzle-orm";
import { VideoStatusPanel } from "@/components/job-status-badge";
import { FeedbackForm } from "@/components/feedback-form";
import { PublishPanel } from "@/components/publish-panel";
import { VideoVersionsPanel } from "@/components/video-versions-panel";
import { DeleteVideoButton } from "@/components/delete-video-button";

export const dynamic = "force-dynamic";

export default async function VideoDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const video = await db.query.videos.findFirst({ where: eq(videos.id, id) });
  if (!video) notFound();

  const accounts = await db.select().from(platformAccounts).where(eq(platformAccounts.isActive, true));

  return (
    <div className="max-w-2xl space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{video.title ?? "Video sin titulo"}</h1>
          <p className="text-sm text-muted-foreground">{video.format} - {video.topic ?? "sin topico especifico"}</p>
        </div>
        <DeleteVideoButton videoId={video.id} />
      </div>

      <VideoStatusPanel initialVideo={video} />

      <VideoVersionsPanel videoId={video.id} />

      {video.status === "ready" && (
        <div className="space-y-2">
          <h3 className="font-semibold">Publicar</h3>
          <PublishPanel
            videoId={video.id}
            accounts={accounts.map((a) => ({ id: a.id, label: `${a.platform}: ${a.accountLabel ?? a.externalAccountId ?? a.id}` }))}
          />
        </div>
      )}

      <FeedbackForm videoId={video.id} />
    </div>
  );
}
