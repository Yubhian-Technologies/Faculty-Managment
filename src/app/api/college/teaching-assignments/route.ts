export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import type { TeachingAssignment, TimetableSlot } from "@/types";

export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember(
      "HOD",
      "PRINCIPAL",
      "SUPER_ADMIN",
      "PANEL_MEMBER",
      "VICE_PRINCIPAL",
    );

    const { searchParams } = new URL(request.url);
    const myAssignments = searchParams.get("myAssignments") === "true";
    const deptView = searchParams.get("dept") === "true";
    const academicYear = searchParams.get("academicYear") ?? undefined;

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);

    let assignmentQuery: FirebaseFirestore.Query = collegeRef.collection("teachingAssignments");
    let timetableSlots: (TimetableSlot & { id: string })[] = [];

    if (deptView && session.role === "HOD") {
      // Resolve HOD's department from their user profile
      const hodSnap = await collegeRef
        .collection("users")
        .doc(session.uid)
        .get();
      const hodDept =
        (hodSnap.data() as { department?: string } | undefined)?.department ?? "";

      if (hodDept) {
        assignmentQuery = assignmentQuery.where("department", "==", hodDept);
      }

      if (academicYear) {
        assignmentQuery = assignmentQuery.where("academicYear", "==", academicYear);
      }
    } else {
      // Default: own assignments (myAssignments=true or any other caller)
      assignmentQuery = assignmentQuery.where("facultyId", "==", session.uid);

      if (academicYear) {
        assignmentQuery = assignmentQuery.where("academicYear", "==", academicYear);
      }

      // Fetch timetable slots for own assignments
      let slotQuery: FirebaseFirestore.Query = collegeRef
        .collection("timetableSlots")
        .where("facultyId", "==", session.uid);

      if (academicYear) {
        slotQuery = slotQuery.where("academicYear", "==", academicYear);
      }

      const slotsSnap = await slotQuery.get();
      timetableSlots = slotsSnap.docs.map(
        (d) => ({ id: d.id, ...d.data() } as TimetableSlot & { id: string }),
      );
    }

    const assignmentsSnap = await assignmentQuery.get();

    const assignments: (TeachingAssignment & { id: string })[] = assignmentsSnap.docs
      .map((d) => ({ id: d.id, ...d.data() } as TeachingAssignment & { id: string }))
      .sort((a, b) => {
        const ta =
          a.createdAt && typeof (a.createdAt as { toMillis?: () => number }).toMillis === "function"
            ? (a.createdAt as { toMillis: () => number }).toMillis()
            : new Date(a.createdAt as unknown as string).getTime();
        const tb =
          b.createdAt && typeof (b.createdAt as { toMillis?: () => number }).toMillis === "function"
            ? (b.createdAt as { toMillis: () => number }).toMillis()
            : new Date(b.createdAt as unknown as string).getTime();
        return tb - ta; // descending
      });

    return NextResponse.json({ assignments, timetableSlots });
  } catch (err) {
    if (
      err instanceof Error &&
      (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")
    ) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/teaching-assignments GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
