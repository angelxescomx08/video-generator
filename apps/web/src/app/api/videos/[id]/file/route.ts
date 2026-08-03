import { db, videos } from "@/lib/db";
import { videoFileResponse } from "@/lib/video-file-response";
import { eq } from "drizzle-orm";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const video = await db.query.videos.findFirst({ where: eq(videos.id, id) });
  if (!video?.renderOutputPath) return Response.json({ error: "not rendered yet" }, { status: 404 });

  return videoFileResponse(video.renderOutputPath, request.headers.get("range"));
}
