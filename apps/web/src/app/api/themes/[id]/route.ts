import { db, themes } from "@/lib/db";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

const updateThemeSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  systemPrompt: z.string().min(1).optional(),
  scriptPromptTemplate: z.string().min(1).optional(),
  defaultVoiceId: z.string().optional(),
  isActive: z.boolean().optional(),
});

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const theme = await db.query.themes.findFirst({ where: eq(themes.id, id) });
  if (!theme) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(theme);
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json();
  const parsed = updateThemeSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const [theme] = await db
    .update(themes)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(themes.id, id))
    .returning();

  return NextResponse.json(theme);
}
