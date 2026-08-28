import { db, themes } from "@/lib/db";
import { eq } from "drizzle-orm";
import { VideoForm } from "@/components/video-form";

export const dynamic = "force-dynamic";

export default async function NewVideoPage() {
  const activeThemes = await db.select().from(themes).where(eq(themes.isActive, true));
  const sortedThemes = [...activeThemes].sort((a, b) => {
    if (a.slug === "christianity") return -1;
    if (b.slug === "christianity") return 1;
    return 0;
  });

  return (
    <div className="max-w-xl space-y-6">
      <h1 className="text-2xl font-bold">Nuevo video</h1>
      <VideoForm themes={sortedThemes.map((t) => ({ id: t.id, name: t.name }))} />
    </div>
  );
}
