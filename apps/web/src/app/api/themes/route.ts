import { db, themes } from "@/lib/db";
import { NextResponse } from "next/server";
import { z } from "zod";

const createThemeSchema = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  systemPrompt: z.string().min(1),
  scriptPromptTemplate: z.string().min(1),
  defaultVoiceId: z.string().optional(),
});

export async function GET() {
  const rows = await db.select().from(themes);
  return NextResponse.json(rows);
}

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = createThemeSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const [theme] = await db.insert(themes).values(parsed.data).returning();
  return NextResponse.json(theme, { status: 201 });
}
