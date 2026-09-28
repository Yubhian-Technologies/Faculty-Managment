export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { loadTimetableContext } from "@/lib/timetable/loadContext";
import { getHodDepartmentScope, canHodEditDepartment, ownDepartmentNames } from "@/lib/departments/scope";
import { isTimetableIncharge } from "@/lib/departments/timetableIncharge";
import { resolveRequestedSemester } from "@/lib/college/semester";
import { inchargeOwnDepartmentNames, isCrossDepartmentLender, loadDraft } from "@/lib/timetable/draftAccess";
import { parseWordTable } from "@/lib/timetable/import/parseWordTable";
import { parseExcelGrid } from "@/lib/timetable/import/parseExcelGrid";
import { matchTimetableGrid } from "@/lib/timetable/import/parseGrid";

const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5MB - a timetable grid is a tiny document; bounds parse time

// Parses an uploaded Word (.docx) or Excel (.xlsx) timetable grid for ONE
// section and reports what would be placed, without writing anything. The
// same file/sectionId, re-posted to .../import/confirm with the placements
// the HOD kept, is what actually lands them in the section's TimetableDraft -
// see that route's own doc-comment for why a draft, not published slots.
export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember(
      "HOD", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN", "PANEL_MEMBER", "COLLEGE_STAFF",
    );

    const formData = await request.formData();
    const file = formData.get("file");
    const sectionId = formData.get("sectionId");
    if (!(file instanceof File)) return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    if (typeof sectionId !== "string" || !sectionId) {
      return NextResponse.json({ error: "sectionId is required" }, { status: 400 });
    }
    if (file.size > MAX_FILE_BYTES) return NextResponse.json({ error: "File too large (max 5MB)" }, { status: 400 });

    const isDocx = file.name.toLowerCase().endsWith(".docx");
    const isXlsx = file.name.toLowerCase().endsWith(".xlsx");
    if (!isDocx && !isXlsx) {
      return NextResponse.json({ error: "Only .docx or .xlsx files are supported" }, { status: 400 });
    }

    const db = getAdminDb();
    const semesterField = formData.get("semester");
    const semesterParam = typeof semesterField === "string" && semesterField ? Number(semesterField) : null;

    let requestedSemester: number | null | undefined;
    if (semesterParam != null) {
      const collegeRef = db.collection("colleges").doc(session.collegeId);
      const sectionSnap = await collegeRef.collection("sections").doc(sectionId).get();
      if (!sectionSnap.exists) return NextResponse.json({ error: "Section not found" }, { status: 404 });
      const section = sectionSnap.data() as { courseId: string; year: number };
      const semesterResult = await resolveRequestedSemester(db, session.collegeId, section.courseId, section.year, semesterParam);
      if (!semesterResult.ok) return NextResponse.json({ error: semesterResult.error }, { status: 400 });
      requestedSemester = semesterResult.semester;
    }

    const ctx = await loadTimetableContext(db, session.collegeId, sectionId, requestedSemester);
    if (!ctx) return NextResponse.json({ error: "Section not found" }, { status: 404 });
    if (!ctx.timing) {
      return NextResponse.json({ error: "No period timing is configured for this course year." }, { status: 409 });
    }

    // Same dual-path authorization the hand-edit draft route enforces - an
    // import is just another way of writing into the same draft.
    if (session.role === "HOD") {
      const scope = await getHodDepartmentScope(db, session.collegeId, session.uid);
      if (
        !canHodEditDepartment(scope, ctx.section.department) &&
        !(await isCrossDepartmentLender(db, session.collegeId, ownDepartmentNames(scope), sectionId))
      ) {
        return NextResponse.json({ error: "This section isn't in your department" }, { status: 403 });
      }
    } else if (session.role === "PANEL_MEMBER" || session.role === "COLLEGE_STAFF") {
      const ok = await isTimetableIncharge(db, session.collegeId, session.uid, ctx.section.courseId, ctx.section.year);
      if (!ok) {
        const myNames = await inchargeOwnDepartmentNames(db, session.collegeId, session.uid);
        const lending = await isCrossDepartmentLender(db, session.collegeId, myNames, sectionId);
        if (!lending) {
          return NextResponse.json({ error: "You are not the Timetable Incharge for this course & year" }, { status: 403 });
        }
      }
    }

    let grid;
    try {
      const arrayBuffer = await file.arrayBuffer();
      grid = isDocx
        ? await parseWordTable(Buffer.from(arrayBuffer))
        : await parseExcelGrid(arrayBuffer);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not read this file.";
      return NextResponse.json({ error: message }, { status: 400 });
    }

    const existingDraft = await loadDraft(db, session.collegeId, sectionId, ctx.currentSemester);
    const result = matchTimetableGrid(grid, ctx, existingDraft?.slots ?? []);
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });

    return NextResponse.json({ placements: result.placements });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/timetable/import POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
