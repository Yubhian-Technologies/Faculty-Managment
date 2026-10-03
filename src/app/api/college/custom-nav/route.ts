export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { verifySession } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { layoutRef, serializePage, toSummary } from "@/lib/customNav/store";
import type { CustomNavLayout, CustomPageSummary } from "@/types";

// What the sidebar needs for the signed-in login's college: the enabled custom
// tabs (no blocks) and the saved tab order per role. The client keeps only the
// tabs for roles the login holds and applies the order of the role it is
// working as; hidden tabs are filtered with the same hiddenItems list as
// built-in ones. Nothing here is sensitive - it names tabs, not their content.
export async function GET() {
  const empty = { pages: [] as CustomPageSummary[], order: {} as CustomNavLayout["order"] };
  try {
    const session = await verifySession();
    if (!session?.collegeId) return NextResponse.json(empty, { headers: { "Cache-Control": "no-store" } });

    const db = getAdminDb();
    const [pagesSnap, layoutSnap] = await Promise.all([
      db.collection("colleges").doc(session.collegeId).collection("customPages").where("enabled", "==", true).get(),
      layoutRef(db, session.collegeId).get(),
    ]);
    const pages = pagesSnap.docs.map((d) => toSummary(serializePage(d.id, d.data())));
    const order = (layoutSnap.exists ? (layoutSnap.data()?.order as CustomNavLayout["order"] | undefined) : undefined) ?? {};
    return NextResponse.json({ pages, order }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[college/custom-nav GET]", err);
    return NextResponse.json(empty);
  }
}
