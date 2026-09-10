import { db, statsSyncRuns } from "@/lib/db";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const run = await db.query.statsSyncRuns.findFirst({ where: eq(statsSyncRuns.id, id) });
  if (!run) return NextResponse.json({ error: "sincronizacion no encontrada" }, { status: 404 });
  return NextResponse.json(run);
}
