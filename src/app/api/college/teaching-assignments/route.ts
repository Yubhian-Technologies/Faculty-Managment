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
    const deptView = searchParams.get("dept") === "true";
    const requestedFacultyId = searchParams.get("facultyId");

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);

    let assignmentQuery: FirebaseFirestore.Query = collegeRef.collection("teachingAssignments");
    let timetableSlots: (TimetableSlot & { id: string })[] = [];

    if (deptView && session.role === "HOD") {
      // Resolve HOD's department from their user profile
      const hodSnap = await collegeRef.collection("users").doc(session.uid).get();
      const hodDept = (hodSnap.data() as { department?: string } | undefined)?.department ?? "";
      if (hodDept) assignmentQuery = assignmentQuery.where("department", "==", hodDept);
    } else {
      // Viewing a specific faculty member's assignments — HOD/Principal/SuperAdmin may look up anyone;
      // everyone else (including a faculty viewing their own "Teaching Load") is restricted to themselves.
      const canViewOthers = ["HOD", "PRINCIPAL", "SUPER_ADMIN"].includes(session.role);
      const facultyId = requestedFacultyId && canViewOthers ? requestedFacultyId : session.uid;

      assignmentQuery = assignmentQuery.where("facultyId", "==", facultyId);

      const slotsSnap = await collegeRef
        .collection("timetableSlots")
        .where("facultyId", "==", facultyId)
        .get();
      timetableSlots = slotsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as TimetableSlot & { id: string }));
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
    const session = await requireCollegeMember("HOD", "PRINCIPAL", "SUPER_ADMIN");
    const body = (await request.json()) as {
      facultyId: string;
      facultyName: string;
      courseId: string;
      sectionId: string;
      subjectId: string;
      hoursPerWeek?: number;
      slots?: { day: string; periodNumber: number; classroom?: string }[];
    };

    const { facultyId, facultyName, courseId, sectionId, subjectId } = body;
    if (!facultyId || !courseId || !sectionId || !subjectId) {
      return NextResponse.json({ error: "facultyId, courseId, sectionId and subjectId are required" }, { status: 400 });
    }

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);

    const [courseSnap, sectionSnap, subjectSnap] = await Promise.all([
      collegeRef.collection("courses").doc(courseId).get(),
      collegeRef.collection("sections").doc(sectionId).get(),
      collegeRef.collection("subjects").doc(subjectId).get(),
    ]);
    if (!courseSnap.exists) return NextResponse.json({ error: "Course not found" }, { status: 404 });
    if (!sectionSnap.exists) return NextResponse.json({ error: "Section not found" }, { status: 404 });
    if (!subjectSnap.exists) return NextResponse.json({ error: "Subject not found" }, { status: 404 });

    const course = courseSnap.data() as { name: string; departmentId: string };
    const section = sectionSnap.data() as { name: string; year: number; department: string };
    const subject = subjectSnap.data() as { name: string; code: string; hoursPerWeek: number };

    // Conflict check: this faculty already teaching this exact section+subject?
    const existing = await collegeRef.collection("teachingAssignments")
      .where("facultyId", "==", facultyId)
      .where("sectionId", "==", sectionId)
      .where("subjectId", "==", subjectId)
      .limit(1)
      .get();
    if (!existing.empty) {
      return NextResponse.json({ error: "This faculty is already assigned to this subject for this section" }, { status: 409 });
    }

    const now = new Date();
    const ref = collegeRef.collection("teachingAssignments").doc();

    await ref.set({
      collegeId: session.collegeId,
      facultyId,
      facultyName: facultyName ?? "",
      department: section.department,
      departmentId: course.departmentId,
      courseId,
      courseName: course.name,
      year: section.year,
      sectionId,
      sectionName: section.name,
      subjectId,
      subjectName: subject.name,
      subjectCode: subject.code,
      hoursPerWeek: body.hoursPerWeek != null ? Number(body.hoursPerWeek) : subject.hoursPerWeek,
      assignedBy: session.uid,
      assignedByName: session.role,
      createdAt: now,
      updatedAt: now,
    });

    // Create any staged timetable slots (day + period) for this assignment
    const createdSlots: string[] = [];
    if (body.slots?.length) {
      for (const slot of body.slots) {
        const conflict = await collegeRef.collection("timetableSlots")
          .where("sectionId", "==", sectionId)
          .where("day", "==", slot.day)
          .where("periodNumber", "==", slot.periodNumber)
          .limit(1)
          .get();
        if (!conflict.empty) {
          return NextResponse.json({
            error: `Conflict: Section ${section.name} already has a subject scheduled on ${slot.day} period ${slot.periodNumber}`,
            assignmentId: ref.id,
          }, { status: 409 });
        }
        const slotRef = collegeRef.collection("timetableSlots").doc();
        await slotRef.set({
          collegeId: session.collegeId,
          department: section.department,
          assignmentId: ref.id,
          facultyId,
          facultyName: facultyName ?? "",
          courseId,
          year: section.year,
          sectionId,
          subjectId,
          subjectName: subject.name,
          day: slot.day,
          periodNumber: slot.periodNumber,
          classroom: slot.classroom ?? null,
          createdAt: now,
          updatedAt: now,
        });
        createdSlots.push(slotRef.id);
      }
    }

    return NextResponse.json({ id: ref.id, slotIds: createdSlots }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/teaching-assignments POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
