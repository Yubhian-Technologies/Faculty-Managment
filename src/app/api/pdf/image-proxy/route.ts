export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { verifySession } from "@/lib/auth/verifySession";

// Firebase Storage has no CORS policy for this app's origin, so html2canvas
// (used by src/lib/pdf/htmlToPdf.ts to render the resume to a real PDF) can't
// read profile-photo pixel data cross-origin even though the underlying HTTP
// fetch succeeds - the browser just blocks JS from using the response. This
// route re-fetches the image server-side (not subject to browser CORS) so the
// client can inline it as a data: URI before capture. Restricted to the
// Firebase Storage host only, to avoid being an open proxy for arbitrary URLs.
const ALLOWED_HOSTS = new Set(["firebasestorage.googleapis.com"]);

export async function GET(request: Request) {
  const session = await verifySession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const target = searchParams.get("url");
  if (!target) return NextResponse.json({ error: "url is required" }, { status: 400 });

  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    return NextResponse.json({ error: "Invalid url" }, { status: 400 });
  }
  if (parsed.protocol !== "https:" || !ALLOWED_HOSTS.has(parsed.hostname)) {
    return NextResponse.json({ error: "URL not allowed" }, { status: 400 });
  }

  try {
    const upstream = await fetch(parsed.toString());
    if (!upstream.ok) return NextResponse.json({ error: "Fetch failed" }, { status: 502 });

    const buffer = Buffer.from(await upstream.arrayBuffer());
    return new Response(buffer, {
      headers: {
        "Content-Type": upstream.headers.get("content-type") ?? "application/octet-stream",
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (err) {
    console.error("[pdf/image-proxy GET]", err);
    return NextResponse.json({ error: "Fetch failed" }, { status: 502 });
  }
}
