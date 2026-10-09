export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { verifySession } from "@/lib/auth/verifySession";
import { resolveHeldRoles } from "@/lib/auth/liveRoles";

// Cheap "is this browser's session still valid?" probe, polled by the dashboard (hooks/useSessionRevocationWatch.ts) so a
// login that was signed out everywhere - e.g. the College Office changed a faculty member's college email - is signed out
// on devices that still have a page open, within about a minute, instead of waiting for the ID token to expire.
// Read-only; it reuses the live role lookup the API guards already use (briefly cached), so it costs no extra reads.
export async function GET() {
  try {
    const session = await verifySession();
    if (!session) return NextResponse.json({ ok: false, code: "NO_SESSION" }, { status: 401 });
    const held = await resolveHeldRoles(session);
    if (held.length === 0) return NextResponse.json({ ok: false, code: "SESSION_REVOKED" }, { status: 401 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[auth/session-check GET]", err);
    return NextResponse.json({ ok: true }); // never sign anyone out because of a server hiccup
  }
}
