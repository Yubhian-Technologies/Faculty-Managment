export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { writeAuditLogSafe } from "@/lib/audit/safeAuditLog";
import { ChunkedBatch } from "@/lib/firestore/chunkedBatch";
import { checkRows, MAX_IMPORT_ROWS, type ImportRow } from "@/lib/hiring/candidateImport";

// Candidate Excel import (HR > Candidates > Import; the HOD / Principal may use it too).
//   body { rows: ImportRow[], vacancyRequestId?: string, apply?: boolean }
// apply false (default) = check only, writes nothing. apply true = adds every row that passed as a candidate, and -
// when a hiring request is picked - attaches each to it (a PENDING application, as the careers page does). Rows that
// fail are never written; the response lists every row's result.
export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("HR", "HOD", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN");
    const body = (await readJsonBody(request)) as { rows?: ImportRow[]; vacancyRequestId?: string; apply?: boolean };
    const rows = Array.isArray(body.rows) ? body.rows : [];
    if (rows.length === 0) return NextResponse.json({ error: "The file has no candidate rows." }, { status: 400 });
    if (rows.length > MAX_IMPORT_ROWS) return NextResponse.json({ error: `Upload at most ${MAX_IMPORT_ROWS} candidates at a time.` }, { status: 400 });
    const clean: ImportRow[] = rows.map((r) => ({
      name: String(r?.name ?? ""), email: String(r?.email ?? ""), mobile: String(r?.mobile ?? ""),
      source: String(r?.source ?? ""), referredBy: String(r?.referredBy ?? ""), address: String(r?.address ?? ""),
    }));

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);
    let vacancy: { id: string; department: string; position: string } | null = null;
    if (body.vacancyRequestId) {
      const v = await collegeRef.collection("vacancyRequests").doc(body.vacancyRequestId).get();
      if (!v.exists) return NextResponse.json({ error: "Hiring request not found. It may have been deleted." }, { status: 404 });
      if (v.get("status") !== "APPROVED") return NextResponse.json({ error: "Candidates can be attached only to an approved hiring request." }, { status: 409 });
      vacancy = { id: v.id, department: String(v.get("department") ?? ""), position: String(v.get("position") ?? "") };
    }

    const existingSnap = await collegeRef.collection("candidates").select("name", "email", "phone").get();
    const existing = existingSnap.docs.map((d) => ({ id: d.id, name: String(d.get("name") ?? ""), email: d.get("email") as string | undefined, phone: d.get("phone") as string | undefined }));
    const results = checkRows(clean, existing);
    const good = results.filter((r): r is Extract<typeof r, { ok: true }> => r.ok);
    if (!body.apply) return NextResponse.json({ results, ready: good.length });

    const actor = (await collegeRef.collection("users").doc(session.uid).get()).get("name") ?? "Unknown";
    const now = new Date();
    const batch = new ChunkedBatch(db);
    for (const r of good) {
      const cRef = collegeRef.collection("candidates").doc();
      batch.set(cRef, {
        collegeId: session.collegeId, ...r.candidate, resumeUrl: "",
        ...(r.candidate.source === "REFERRAL" ? { referralType: "EXTERNAL", referralInfluenceType: "NONE" } : {}),
        addedByUid: session.uid, addedByName: actor, importedAt: now, createdAt: now, updatedAt: now,
      });
      if (vacancy) {
        batch.set(collegeRef.collection("candidateApplications").doc(), {
          collegeId: session.collegeId, candidateId: cRef.id, vacancyRequestId: vacancy.id, batchId: "",
          department: vacancy.department, position: vacancy.position, currentStage: "DEMO", status: "PENDING",
          isShortlisted: false, hasArrived: false, addedByUid: session.uid, addedByName: actor, createdAt: now, updatedAt: now,
        });
      }
    }
    await batch.commit();
    await writeAuditLogSafe(db, session.collegeId, {
      action: "CANDIDATES_IMPORTED", performedBy: session.uid, performedByName: actor, targetId: vacancy?.id ?? "",
      details: { count: good.length, skipped: results.length - good.length, ...(vacancy ? { vacancyRequestId: vacancy.id, position: vacancy.position } : {}) },
    });
    return NextResponse.json({ results, added: good.length });
  } catch (err) {
    const badBody = badBodyResponse(err);
    if (badBody) return badBody;
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "You do not have access, or your session has expired. Sign in again to continue." }, { status: 401 });
    }
    console.error("[college/candidates/import POST]", err);
    return NextResponse.json({ error: "Unable to complete the request. Try again; if it continues, contact the administrator." }, { status: 500 });
  }
}
