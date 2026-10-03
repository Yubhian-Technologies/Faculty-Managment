export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { verifySession } from "@/lib/auth/verifySession";
import { resolveHeldRoles } from "@/lib/auth/liveRoles";
import { getAdminDb } from "@/lib/firebase/admin";
import { pageRef, serializePage, visibilityRef } from "@/lib/customNav/store";
import { resolveNavVisibility } from "@/lib/navVisibilityDefaults";
import { customPageHref } from "@/types";
import type { NavVisibilitySettings } from "@/types";

// One page's content for a signed-in college login. Access is checked here, not
// just in the sidebar: the page must be enabled, one of the login's CURRENT
// roles must be among the page's roles, and the tab must not be switched off
// for that role in the college's nav-visibility settings. Anything else looks
// like a page that doesn't exist.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await verifySession();
    if (!session?.collegeId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { id } = await params;

    const db = getAdminDb();
    const [snap, visSnap, held] = await Promise.all([
      pageRef(db, session.collegeId, id).get(),
      visibilityRef(db, session.collegeId).get(),
      resolveHeldRoles(session),
    ]);
    const notFound = () => NextResponse.json({ error: "Page not found" }, { status: 404 });
    if (!snap.exists) return notFound();

    const page = serializePage(snap.id, snap.data()!);
    if (!page.enabled) return notFound();

    const { hiddenItems } = resolveNavVisibility(visSnap.exists ? (visSnap.data() as NavVisibilitySettings) : undefined);
    const href = customPageHref(id);
    const allowed = page.roles.some((r) => held.includes(r) && !hiddenItems[r]?.includes(href));
    if (!allowed) return notFound();

    return NextResponse.json({ page }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[college/custom-nav/pages/[id] GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
