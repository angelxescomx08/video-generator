import { randomUUID } from "node:crypto";
import { FacebookProvider } from "@video-generator/social-providers";
import { NextResponse } from "next/server";

export async function GET() {
  const provider = new FacebookProvider();
  const url = provider.getAuthUrl(randomUUID());
  return NextResponse.redirect(url);
}
