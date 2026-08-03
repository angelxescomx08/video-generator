import { db, videoVersions } from "@/lib/db";
import { videoFileResponse } from "@/lib/video-file-response";
import { and, eq } from "drizzle-orm";

export async function GET(request: Request, { params }: { params: Promise<{ id: string; versionId: string }> }) {
  const { id, versionId } = await params;
  const version = await db.query.videoVersions.findFirst({
    where: and(eq(videoVersions.id, versionId), eq(videoVersions.videoId, id)),
  });
  if (!version) return Response.json({ error: "version not found" }, { status: 404 });

  return videoFileResponse(version.renderOutputPath, request.headers.get("range"));
}
