export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { summarizeBulkUpdate } from "@/lib/students/bulkUpdate";
import { MAX_BULK_UPDATE_ROWS, parseBulkUpdateRequest } from "@/lib/students/bulkUpdateRows";
import { resolveBulkUpdate } from "@/lib/students/bulkUpdateResolve";

// Classifies an "Update student data" file WITHOUT writing anything, so the Office sees every Fill / Overwrite
// (old -> new) before committing. Apply runs the same resolver again on fresh data - this is a preview, not a promise.
export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("COLLEGE_OFFICE");

    let body: { rows?: unknown; fields?: unknown; fillOnly?: unknown };
    try {
      body = (await readJsonBody(request)) as typeof body;
    } catch (err) {
      return badBodyResponse(err) ?? NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    const parsed = parseBulkUpdateRequest(body, MAX_BULK_UPDATE_ROWS);
    if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

    const results = await resolveBulkUpdate(getAdminDb(), session.collegeId, parsed.rows, parsed.fields, parsed.fillOnly);
    return NextResponse.json({ results, summary: summarizeBulkUpdate(results), maxRows: MAX_BULK_UPDATE_ROWS });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[students/bulk-update/preview]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
