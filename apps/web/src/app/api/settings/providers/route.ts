import { db, providerConfigs } from "@/lib/db";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

const setDefaultSchema = z.object({
  providerType: z.enum(["ai", "tts", "stock", "social"]),
  providerName: z.string().min(1),
});

export async function GET() {
  const rows = await db.select().from(providerConfigs);
  return NextResponse.json(rows);
}

/** Sets a provider as the default for its type (unsets any previous default of the same type). */
export async function POST(request: Request) {
  const body = await request.json();
  const parsed = setDefaultSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  await db
    .update(providerConfigs)
    .set({ isDefault: false })
    .where(eq(providerConfigs.providerType, parsed.data.providerType));

  const existing = await db.query.providerConfigs.findFirst({
    where: and(
      eq(providerConfigs.providerType, parsed.data.providerType),
      eq(providerConfigs.providerName, parsed.data.providerName),
    ),
  });

  const row = existing
    ? (
        await db
          .update(providerConfigs)
          .set({ isDefault: true, isEnabled: true, updatedAt: new Date() })
          .where(eq(providerConfigs.id, existing.id))
          .returning()
      )[0]
    : (
        await db
          .insert(providerConfigs)
          .values({ providerType: parsed.data.providerType, providerName: parsed.data.providerName, isDefault: true })
          .returning()
      )[0];

  return NextResponse.json(row);
}
