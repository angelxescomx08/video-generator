import { db, publishedVideos, statsSyncRuns } from "@/lib/db";
import { enqueueStatsSyncRun } from "@/lib/queue";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

/** Starts a durable refresh: one queued item per published link gives the UI real progress. */
export async function POST() {
  const linked = await db.select({ id: publishedVideos.id }).from(publishedVideos).where(eq(publishedVideos.status, "published"));
  if (linked.length === 0) return NextResponse.json({ error: "no hay videos vinculados a YouTube todavia" }, { status: 409 });
  const [run] = await db.insert(statsSyncRuns).values({ totalCount: linked.length }).returning({ id: statsSyncRuns.id });
  await enqueueStatsSyncRun(run!.id, linked.map((video) => video.id));
  return NextResponse.json({ queued: true, videos: linked.length, syncRunId: run!.id });
}
