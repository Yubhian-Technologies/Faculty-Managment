export const dynamic = "force-dynamic";

import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { planNeighbourConnection, type ConnectionInput } from "@/lib/departments/neighbourConnection";
import { findBranchClaimConflicts, branchClaimConflictMessage, type DepartmentClaimRow } from "@/lib/departments/managedBranches";
import { syncNeighbourLinksForCollege } from "@/lib/departments/neighbourLinks";

// Connects (or disconnects) a PARENT/GHOST department to/from a neighbour,
// from the PARENT/GHOST's own screen - the reverse entry point of the
// existing neighbour-side tick-box flow (PATCH /api/college/departments,
// managedDepartments/secondaryDepartments). Principal/VP/Super Admin ONLY,
// deliberately never an HOD - even the PARENT/GHOST's own HOD - because the
// actual write lands on a DIFFERENT department's doc (the neighbour) that
// the caller doesn't own, which is a materially different trust boundary
// than every other field this HOD can edit on their own department. See
// planNeighbourConnection's own doc-comment (src/lib/departments/
// neighbourConnection.ts) for exactly which fields get written and why.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireCollegeMember("PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN");
    const { id: deptId } = await params;

    const body = (await readJsonBody(request)) as { neighbourDepartmentId: string | null };
    if (body.neighbourDepartmentId !== null && typeof body.neighbourDepartmentId !== "string") {
      return NextResponse.json({ error: "neighbourDepartmentId must be a string or null" }, { status: 400 });
    }

    const db = getAdminDb();
    const deptsColl = db.collection("colleges").doc(session.collegeId).collection("departments");

    const result = await db.runTransaction(async (tx) => {
      const fresh = await tx.get(deptsColl);
      const all: ConnectionInput[] = fresh.docs.map((d) => ({ id: d.id, ...(d.data() as object) })) as ConnectionInput[];
      const dept = all.find((d) => d.id === deptId);
      if (!dept) return { error: "Department not found", status: 404 as const };

      const plan = planNeighbourConnection(dept, all, body.neighbourDepartmentId);
      if ("error" in plan) return { error: plan.error, status: 400 as const };

      if (plan.connectTo) {
        // Re-check the one-owner-per-branch rule inside the transaction, same as a
        // manual managedDepartments edit would - the plan only adds `dept.name`
        // itself (never a child's name) to managedDepartments, so this is the only
        // name that can possibly newly collide with another manager.
        const conflicts = findBranchClaimConflicts(
          fresh.docs.map((d) => ({ ...(d.data() as DepartmentClaimRow), id: d.id })),
          [dept.name],
          plan.connectTo.departmentId
        );
        if (conflicts.length > 0) return { error: branchClaimConflictMessage(conflicts), status: 409 as const };
      }

      const now = new Date();
      if (plan.disconnectFrom) {
        tx.update(deptsColl.doc(plan.disconnectFrom.departmentId), {
          managedDepartments: plan.disconnectFrom.managedDepartments,
          secondaryDepartments: plan.disconnectFrom.secondaryDepartments,
          updatedAt: now,
        });
      }
      if (plan.connectTo) {
        tx.update(deptsColl.doc(plan.connectTo.departmentId), {
          managedDepartments: plan.connectTo.managedDepartments,
          secondaryDepartments: plan.connectTo.secondaryDepartments,
          updatedAt: now,
        });
      }
      return { ok: true as const };
    });

    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    // Advisory neighbourLinks mirror - best-effort, never blocks or undoes the
    // connection itself (see syncNeighbourLinksForCollege's own doc-comment).
    await syncNeighbourLinksForCollege(db, session.collegeId)
      .catch((e) => console.error("[college/departments/[id]/neighbour PATCH] neighbourLinks resync failed:", e));

    return NextResponse.json({ ok: true });
  } catch (err) {
    const badBody = badBodyResponse(err);
    if (badBody) return badBody;
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/departments/[id]/neighbour PATCH]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
