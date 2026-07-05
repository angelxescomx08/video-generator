import { db, themes } from "@/lib/db";
import { eq } from "drizzle-orm";
import { VideoForm } from "@/components/video-form";

export const dynamic = "force-dynamic";

export default async function NewVideoPage() {
  const activeThemes = await db.select().from(themes).where(eq(themes.isActive, true));

  return (
    <div className="max-w-xl space-y-6">
      <h1 className="text-2xl font-bold">Nuevo video</h1>
      <VideoForm themes={activeThemes.map((t) => ({ id: t.id, name: t.name }))} />
    </div>
  );
}
