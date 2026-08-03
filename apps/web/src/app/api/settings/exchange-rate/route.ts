import { appSettings, db, DEFAULT_USD_TO_MXN_RATE, USD_TO_MXN_RATE_KEY } from "@/lib/db";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

const setRateSchema = z.object({ rate: z.number().positive() });

export async function GET() {
  const row = await db.query.appSettings.findFirst({ where: eq(appSettings.key, USD_TO_MXN_RATE_KEY) });
  const rate = row ? Number(row.value) : DEFAULT_USD_TO_MXN_RATE;
  return NextResponse.json({ rate });
}

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = setRateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  await db
    .insert(appSettings)
    .values({ key: USD_TO_MXN_RATE_KEY, value: parsed.data.rate.toString() })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: parsed.data.rate.toString(), updatedAt: new Date() },
    });

  return NextResponse.json({ rate: parsed.data.rate });
}
