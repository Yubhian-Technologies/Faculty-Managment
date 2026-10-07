export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { resolveRollMapping } from "@/lib/students/rollMappingResolve";
import { summarizeRollMapping } from "@/lib/students/rollMapping";
import { MAX_ROLL_MAP_ROWS, parseRollMapRows } from "@/lib/students/rollMappingRows";

// Classifies an "Import Roll Nos" file WITHOUT writing anything, so the Office
// sees exactly what would happen before committing to it. The apply endpoint
// runs the same resolver again at write time - this is a preview, not a
// promise, and a roll can be claimed by somebody else in between.
export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("COLLEGE_OFFICE");

    let body: { rows?: unknown; replaceExisting?: unknown };
    try {
      body = (await readJsonBody(request)) as typeof body;
    } catch (err) {
      return badBodyResponse(err) ?? NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    const parsed = parseRollMapRows(body.rows);
    if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

    const db = getAdminDb();
    const results = await resolveRollMapping(db, session.collegeId, parsed.rows, body.replaceExisting === true);

    return NextResponse.json({
      results,
      summary: summarizeRollMapping(results),
      maxRows: MAX_ROLL_MAP_ROWS,
    });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[students/map-roll-numbers/preview]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
