import { notFound } from "next/navigation";
import { db, themes } from "@/lib/db";
import { eq } from "drizzle-orm";
import { ThemeForm } from "@/components/theme-form";

export const dynamic = "force-dynamic";

export default async function EditThemePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const theme = await db.query.themes.findFirst({ where: eq(themes.id, id) });
  if (!theme) notFound();

  return (
    <div className="max-w-xl space-y-6">
      <h1 className="text-2xl font-bold">Editar tema: {theme.name}</h1>
      <ThemeForm initial={theme} />
    </div>
  );
}
