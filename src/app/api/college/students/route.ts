export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import type { Section, StudentStatus } from "@/types";

// Sections a PANEL_MEMBER (faculty) is in charge of — students are only visible/
// editable within these. Returns [] if the faculty isn't assigned to any section.
async function getInchargeSections(
  db: FirebaseFirestore.Firestore,
  collegeId: string,
  uid: string
): Promise<Section[]> {
  const snap = await db
    .collection("colleges")
    .doc(collegeId)
    .collection("sections")
    .where("facultyInchargeUid", "==", uid)
    .get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Section);
}

async function getHodDept(db: FirebaseFirestore.Firestore, collegeId: string, uid: string): Promise<string> {
  const snap = await db.collection("colleges").doc(collegeId).collection("users").doc(uid).get();
  return (snap.data() as { department?: string } | undefined)?.department ?? "";
}

export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember("PANEL_MEMBER", "HOD", "PRINCIPAL", "SUPER_ADMIN");
    const { searchParams } = new URL(request.url);
    const sectionFilter = searchParams.get("section");
    const yearFilter = searchParams.get("year");

    const db = getAdminDb();
    let query: FirebaseFirestore.Query = db.collection("colleges").doc(session.collegeId).collection("students");

    if (session.role === "PANEL_MEMBER") {
      const sections = await getInchargeSections(db, session.collegeId, session.uid);
      if (sections.length === 0) {
        return NextResponse.json({ students: [] });
      }
      // Firestore `in` filters cap at 30 values — faculty are realistically in charge of a handful of sections.
      query = query.where("section", "in", sections.map((s) => s.name).slice(0, 30));
    } else if (session.role === "HOD") {
      const dept = await getHodDept(db, session.collegeId, session.uid);
      if (dept) query = query.where("department", "==", dept);
    }

    if (sectionFilter) query = query.where("section", "==", sectionFilter);
    if (yearFilter) query = query.where("year", "==", Number(yearFilter));

    const snap = await query.get();
    const students = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => ((a as { rollNumber?: string }).rollNumber ?? "").localeCompare((b as { rollNumber?: string }).rollNumber ?? ""));

    return NextResponse.json({ students });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/students GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("PANEL_MEMBER", "HOD", "PRINCIPAL", "SUPER_ADMIN");
    const body = (await request.json()) as {
      rollNumber: string;
      name: string;
      section: string;
      year: number;
      status?: StudentStatus;
    };

    if (!body.rollNumber?.trim() || !body.name?.trim() || !body.section?.trim() || !body.year) {
      return NextResponse.json({ error: "rollNumber, name, section, year are required" }, { status: 400 });
    }

    const db = getAdminDb();
    const sectionsSnap = await db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("sections")
      .where("name", "==", body.section.trim().toUpperCase())
      .where("year", "==", Number(body.year))
      .limit(1)
      .get();

    if (sectionsSnap.empty) {
      return NextResponse.json({ error: "Section not found" }, { status: 400 });
    }
    const sectionDoc = sectionsSnap.docs[0].data() as Section;

    if (session.role === "PANEL_MEMBER" && sectionDoc.facultyInchargeUid !== session.uid) {
      return NextResponse.json({ error: "You are not in charge of this section" }, { status: 403 });
    }
    if (session.role === "HOD") {
      const dept = await getHodDept(db, session.collegeId, session.uid);
      if (dept && sectionDoc.department !== dept) {
        return NextResponse.json({ error: "Section is not in your department" }, { status: 403 });
      }
    }

    const now = new Date();
    const ref = await db.collection("colleges").doc(session.collegeId).collection("students").add({
      collegeId: session.collegeId,
      department: sectionDoc.department,
      section: sectionDoc.name,
      year: Number(body.year),
      rollNumber: body.rollNumber.trim(),
      name: body.name.trim(),
      status: body.status ?? "REGULAR",
      createdAt: now,
      updatedAt: now,
    });

    return NextResponse.json({ id: ref.id }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/students POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
