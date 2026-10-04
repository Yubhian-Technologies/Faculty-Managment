export const dynamic = "force-dynamic";

import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { invalidateSectionCountCache } from "@/lib/students/sectionCounts";
import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { archiveStudent } from "@/lib/students/archiveStudent";
import { actorOf } from "@/lib/audit/actorOf";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";

const MAX_STUDENTS_PER_CALL = 400;
// Each student is several reads/writes plus an Auth update - a few at a time
// keeps a 400-student call quick without hammering either service.
const CONCURRENCY = 5;

// Bulk removal for the College Office roster tab. Deliberately takes a flat
// studentIds array rather than separate "all" / "by department" modes - the
// page already lets Office filter the visible roster (search/department/year)
// and select-all within that view, so "delete everyone in a department" and
// "delete all students" both resolve to the same call as "delete selected",
// just with a bigger id list. Capped; callers with more than the cap split
// into multiple sequential calls.
//
// "Remove" ARCHIVES each student exactly as the single-student DELETE does (see
// lib/students/archiveStudent.ts): the record is kept in archivedStudents, the
// login is disabled, nothing is erased. A student with an unreturned library
// book is skipped and reported in `blocked` rather than failing the batch; a
// student that fails part-way can simply be removed again (the archive step is
// idempotent).
export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("COLLEGE_OFFICE", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN");
    invalidateSectionCountCache(session.collegeId); // student counts on the Sections list change with this write
    const body = (await readJsonBody(request)) as { studentIds: string[] };

    const studentIds = Array.isArray(body.studentIds)
      ? Array.from(new Set(body.studentIds.filter((id): id is string => typeof id === "string" && id.trim() !== "")))
      : [];
    if (studentIds.length === 0) {
      return NextResponse.json({ error: "studentIds is required" }, { status: 400 });
    }
    if (studentIds.length > MAX_STUDENTS_PER_CALL) {
      return NextResponse.json(
        { error: `At most ${MAX_STUDENTS_PER_CALL} students per call - split into multiple requests` },
        { status: 400 }
      );
    }

    const db = getAdminDb();
    const adminAuth = await getAdminAuth();
    const actor = await actorOf(db, session.collegeId, session.uid, session.email);

    const skipped: string[] = [];
    const blocked: { id: string; reason: string }[] = [];
    const failed: { id: string; reason: string }[] = [];
    let archivedCount = 0;

    for (let i = 0; i < studentIds.length; i += CONCURRENCY) {
      const chunk = studentIds.slice(i, i + CONCURRENCY);
      const results = await Promise.all(
        chunk.map(async (id) => {
          try {
            return { id, result: await archiveStudent(db, adminAuth, session.collegeId, id, actor, "BULK_REMOVED_BY_USER") };
          } catch (err) {
            console.error("[college/students/bulk-delete] archive failed", id, err);
            return { id, error: true as const };
          }
        })
      );
      for (const r of results) {
        if ("error" in r) failed.push({ id: r.id, reason: "Could not be removed - try again" });
        else if (r.result.ok) archivedCount++;
        else if (r.result.code === "NOT_FOUND") skipped.push(r.id);
        else blocked.push({ id: r.id, reason: r.result.reason });
      }
    }

    if (archivedCount === 0 && blocked.length === 0 && failed.length === 0) {
      return NextResponse.json({ error: "No matching students to remove" }, { status: 400 });
    }

    await writeAuditLog(db, session.collegeId, {
      action: "STUDENTS_BULK_DELETED",
      performedBy: session.uid,
      performedByName: actor.name,
      details: { count: archivedCount, skipped: skipped.length, blocked: blocked.length, failed: failed.length, archived: true },
    });

    // `deletedCount` keeps the field name the roster page already reads.
    return NextResponse.json({ ok: true, deletedCount: archivedCount, archivedCount, skipped, blocked, failed });
  } catch (err) {
    const badBody = badBodyResponse(err);
    if (badBody) return badBody;
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/students/bulk-delete POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
