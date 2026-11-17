export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { readJsonBody } from "@/lib/http/readJsonBody";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { createAdjustment, departmentFaculty, listForDepartments, listMine, AdjustmentError, type CreateInput } from "@/lib/classAdjustments/server";
import { callerOf, errorResponse } from "@/lib/classAdjustments/routeHelpers";

// "Adjust / Swap a Class" (lib/classAdjustments/server.ts).
// GET  -> { myFacultyId, mine, isHod, department, departmentFaculty }
// POST { kind, date, slotId, toFacultyId, toAssignmentId, swapSlotId?, swapAssignmentId?, reason?, forFacultyId? }
//   A faculty member asks for their own period (PENDING until the colleague accepts). An HOD may arrange it for a
//   faculty member of their department (`forFacultyId`) - in force at once.

export async function GET() {
  try {
    const session = await requireCollegeMember("PANEL_MEMBER", "HOD");
    const db = getAdminDb();
    const caller = await callerOf(db, session);
    const isHod = caller.hodDepartments.length > 0;
    const [mine, department, faculty] = await Promise.all([
      listMine(db, session.collegeId, caller.facultyId),
      isHod ? listForDepartments(db, session.collegeId, caller.hodDepartments) : Promise.resolve([]),
      isHod ? departmentFaculty(db, session.collegeId, caller.hodDepartments) : Promise.resolve([]),
    ]);
    return NextResponse.json({ myFacultyId: caller.facultyId, mine, isHod, department, departmentFaculty: faculty });
  } catch (err) {
    return errorResponse(err, "class-adjustments GET");
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("PANEL_MEMBER", "HOD");
    const body = (await readJsonBody(request)) as Partial<CreateInput> & { forFacultyId?: unknown };
    const db = getAdminDb();
    const caller = await callerOf(db, session);
    const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
    const forOther = str(body.forFacultyId) && str(body.forFacultyId) !== caller.facultyId ? str(body.forFacultyId) : "";
    if (forOther && caller.hodDepartments.length === 0) throw new AdjustmentError("Only an HOD can arrange a class for someone else.", 403);
    const result = await createAdjustment(db, session.collegeId,
      { uid: caller.uid, name: caller.name, asHod: !!forOther, hodDepartments: caller.hodDepartments },
      {
        kind: body.kind === "SWAP" ? "SWAP" : body.kind === "ADJUST" ? "ADJUST" : (undefined as never),
        date: str(body.date), requesterFacultyId: forOther || caller.facultyId,
        slotId: str(body.slotId), toFacultyId: str(body.toFacultyId), toAssignmentId: str(body.toAssignmentId),
        swapSlotId: str(body.swapSlotId) || undefined, swapAssignmentId: str(body.swapAssignmentId) || undefined,
        reason: str(body.reason),
      });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    return errorResponse(err, "class-adjustments POST");
  }
}
