import { enqueuePublish } from "@/lib/queue";
import { z } from "zod";
import { NextResponse } from "next/server";

const bodySchema = z.object({ platformAccountId: z.string().uuid() });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json();
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  await enqueuePublish(id, parsed.data.platformAccountId);
  return NextResponse.json({ ok: true });
}
