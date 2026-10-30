export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeContext } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { formatDisplayName, effectiveDisplayNameSettings } from "@/lib/faculty/displayNameSettings";

// The faculty Display Names a screen or download swaps in for the Full Name (Settings > Website Display Name).
// { names: { [facultyMemberId | loginUid]: "AV VENU GOPAL" } } - only people who filled in BOTH parts, and only when
// the college ticked at least one place (otherwise empty and nothing is read). Display Names are not secret: the
// same values are what a ticked place prints for anyone who can open it. Read-only; a stored name is never changed.

export async function GET(request: Request) {
  try {
    const session = await requireCollegeContext(
      request,
      "PRINCIPAL", "VICE_PRINCIPAL", "HOD", "SUPER_ADMIN", "COLLEGE_OFFICE", "PANEL_MEMBER", "ACCOUNTS", "COLLEGE_ACCOUNTS", "FINANCE", "PURCHASE_DEPT",
      "COLLEGE_STAFF", "ACADEMICS", "IQAC_COORDINATOR", "T_AND_P", "R_AND_D", "PLACEMENT_DEPT", "LIBRARY", "EXAM_CELL", "WEBMASTER", "STUDENT",
      "CLASS_LEADER"
    );
    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);
    const settings = effectiveDisplayNameSettings((await collegeRef.collection("settings").doc("displayName").get()).data());
    if (!Object.values(settings).some(Boolean)) return NextResponse.json({ names: {} });

    const snap = await collegeRef.collection("facultyMembers").where("displaySurname", ">", "").get();
    const names: Record<string, string> = {};
    const ownEmail = session.email?.trim().toLowerCase();
    for (const d of snap.docs) {
      const f = d.data() as { displaySurname?: string; displayName?: string; honorific?: string; userUid?: string; collegeEmail?: string };
      const surname = f.displaySurname?.trim();
      const name = f.displayName?.trim();
      if (!surname || !name) continue;
      const shown = formatDisplayName(surname, name, f.honorific);
      names[d.id] = shown;
      if (f.userUid) names[f.userUid] = shown;
      // A login whose faculty record is not linked by userUid (older HOD / Principal setups) is still matched by its college email,
      // so the caller finds their own name under their login uid.
      if (ownEmail && f.collegeEmail?.trim().toLowerCase() === ownEmail && !names[session.uid]) names[session.uid] = shown;
    }
    return NextResponse.json({ names });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/faculty-display-names GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
