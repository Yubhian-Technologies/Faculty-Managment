export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { requiredFacultyCount } from "@/lib/college/facultyRatio";
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

export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("HOD", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN");
    const body = (await request.json()) as {
      facultyId: string;
      subjectId: string;
      academicYear: string;
      semester: number;
      section?: string;
      hoursPerWeek?: number;
      totalHoursAllotted?: number;
    };

    if (!body.facultyId || !body.subjectId || !body.academicYear || !body.semester) {
      return NextResponse.json({ error: "facultyId, subjectId, academicYear, semester are required" }, { status: 400 });
    }

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);

    const [facultySnap, subjectSnap] = await Promise.all([
      collegeRef.collection("users").doc(body.facultyId).get(),
      collegeRef.collection("subjects").doc(body.subjectId).get(),
    ]);

    if (!facultySnap.exists) {
      return NextResponse.json({ error: "Faculty not found" }, { status: 400 });
    }
    if (!subjectSnap.exists) {
      return NextResponse.json({ error: "Subject not found" }, { status: 400 });
    }

    const faculty = facultySnap.data() as { name?: string; department?: string };
    const subject = subjectSnap.data() as { name?: string; code?: string; department?: string; hoursPerWeek?: number };

    // HOD may only assign within their own department; Principal/Super Admin can cross departments.
    if (session.role === "HOD") {
      const hodSnap = await collegeRef.collection("users").doc(session.uid).get();
      const hodDept = (hodSnap.data() as { department?: string } | undefined)?.department ?? "";
      if (!hodDept || faculty.department !== hodDept || subject.department !== hodDept) {
        return NextResponse.json({ error: "Faculty/subject must be in your department" }, { status: 403 });
      }
    }

    const now = new Date();
    const ref = await collegeRef.collection("teachingAssignments").add({
      collegeId: session.collegeId,
      facultyId: body.facultyId,
      facultyName: faculty.name ?? "",
      subjectId: body.subjectId,
      subjectName: subject.name ?? "",
      subjectCode: subject.code ?? "",
      department: subject.department ?? faculty.department ?? "",
      academicYear: body.academicYear,
      semester: Number(body.semester),
      section: body.section ?? "",
      hoursPerWeek: body.hoursPerWeek ?? subject.hoursPerWeek ?? 0,
      ...(body.totalHoursAllotted != null ? { totalHoursAllotted: Number(body.totalHoursAllotted) } : {}),
      assignedBy: session.uid,
      assignedByName: session.role,
      createdAt: now,
      updatedAt: now,
    });

    // Non-blocking ratio reference: surface whether this department is now
    // staffed at/beyond the 1:15 hiring-pipeline ratio, without preventing the
    // assignment (HOD/Principal still decide) — see faculty-requirement route
    // for the same STUDENT_FACULTY_RATIO used during hiring/vacancy sizing.
    let ratioWarning: string | undefined;
    const dept = subject.department ?? faculty.department ?? "";
    if (dept) {
      const [sectionsSnap, assignmentsSnap] = await Promise.all([
        collegeRef.collection("sections").where("department", "==", dept).get(),
        collegeRef.collection("teachingAssignments")
          .where("department", "==", dept)
          .where("academicYear", "==", body.academicYear)
          .get(),
      ]);
      const totalStudents = sectionsSnap.docs.reduce(
        (sum, d) => sum + ((d.data() as { studentCount?: number }).studentCount ?? 0), 0
      );
      const required = requiredFacultyCount(totalStudents);
      const distinctFaculty = new Set(
        assignmentsSnap.docs.map((d) => (d.data() as { facultyId?: string }).facultyId).filter(Boolean)
      );
      if (required > 0 && distinctFaculty.size >= required) {
        ratioWarning = `${dept} now has ${distinctFaculty.size} faculty assigned against a ratio-based requirement of ${required} (1:15 student-faculty ratio).`;
      }
    }

    return NextResponse.json({ id: ref.id, ...(ratioWarning ? { ratioWarning } : {}) }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/teaching-assignments POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const session = await requireCollegeMember("HOD", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN");
    const { searchParams } = new URL(request.url);
    const assignmentId = searchParams.get("id");
    if (!assignmentId) {
      return NextResponse.json({ error: "id required" }, { status: 400 });
    }

    const db = getAdminDb();
    await db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("teachingAssignments")
      .doc(assignmentId)
      .delete();

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/teaching-assignments DELETE]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
