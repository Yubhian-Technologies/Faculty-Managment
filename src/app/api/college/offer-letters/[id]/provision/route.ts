export const dynamic = "force-dynamic";

// Manually trigger faculty account creation for an already-sent offer letter.
// Used when an offer letter was marked SENT before the auto-provision feature was added.

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { createFirebaseUser } from "@/lib/firebase/authRest";

const DEFAULT_FACULTY_PASSWORD = "12345678";

async function generateEmployeeId(db: FirebaseFirestore.Firestore, collegeId: string): Promise<string> {
  const snap = await db
    .collection("colleges")
    .doc(collegeId)
    .collection("facultyMembers")
    .count()
    .get();
  const count = snap.data().count + 1;
  return `EMP${String(count).padStart(4, "0")}`;
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireCollegeMember("ACCOUNTS", "PRINCIPAL", "SUPER_ADMIN");
    const { id } = await params;
    const db = getAdminDb();

    const letterSnap = await db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("offerLetters")
      .doc(id)
      .get();

    if (!letterSnap.exists) {
      return NextResponse.json({ error: "Offer letter not found" }, { status: 404 });
    }

    const letter = letterSnap.data() as {
      candidateId?: string;
      candidateName?: string;
      designation?: string;
      department?: string;
      joiningDate?: { toDate?: () => Date } | string;
      ctcAnnual?: number;
      batchId?: string;
    };

    if (!letter.candidateId) {
      return NextResponse.json({ error: "No candidateId on letter" }, { status: 400 });
    }

    // Already provisioned?
    const existingFaculty = await db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("facultyMembers")
      .where("candidateId", "==", letter.candidateId)
      .limit(1)
      .get();
    if (!existingFaculty.empty) {
      return NextResponse.json({ ok: true, alreadyExists: true, facultyId: existingFaculty.docs[0].id });
    }

    const candSnap = await db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("candidates")
      .doc(letter.candidateId)
      .get();
    if (!candSnap.exists) {
      return NextResponse.json({ error: "Candidate not found" }, { status: 404 });
    }

    const candidate = candSnap.data() as { name?: string; email?: string; phone?: string; department?: string };
    const email = candidate.email ?? "";
    const name = candidate.name ?? letter.candidateName ?? "";
    if (!email) return NextResponse.json({ error: "Candidate has no email" }, { status: 400 });

    const now = new Date();
    let joiningDate: Date;
    if (letter.joiningDate && typeof (letter.joiningDate as { toDate?: () => Date }).toDate === "function") {
      joiningDate = (letter.joiningDate as { toDate: () => Date }).toDate();
    } else if (letter.joiningDate) {
      joiningDate = new Date(letter.joiningDate as string);
    } else {
      joiningDate = now;
    }

    let uid: string;
    try {
      uid = await createFirebaseUser(email, DEFAULT_FACULTY_PASSWORD, name);
    } catch (err) {
      if (err && typeof err === "object" && "code" in err && err.code === "auth/email-already-exists") {
        const sysSnap = await db.collection("systemUsers").where("email", "==", email).limit(1).get();
        if (!sysSnap.empty) {
          uid = sysSnap.docs[0].id;
        } else {
          return NextResponse.json({ error: "Email already registered but no systemUsers entry found" }, { status: 409 });
        }
      } else {
        throw err;
      }
    }

    const employeeId = await generateEmployeeId(db, session.collegeId);
    const department = letter.department ?? candidate.department ?? "";

    await db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("users")
      .doc(uid)
      .set({
        uid,
        collegeId: session.collegeId,
        name,
        email,
        role: "PANEL_MEMBER",
        department,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      }, { merge: true });

    const facultyRef = db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("facultyMembers")
      .doc();

    await facultyRef.set({
      collegeId: session.collegeId,
      candidateId: letter.candidateId,
      offerId: id,
      employeeId,
      name,
      email,
      phone: candidate.phone ?? "",
      department,
      designation: letter.designation ?? "Assistant Professor",
      qualification: "",
      specialization: "",
      experienceYears: 0,
      joiningDate,
      employmentType: "FULL_TIME",
      status: "ACTIVE",
      userUid: uid,
      createdAt: now,
      updatedAt: now,
    });

    await db.collection("systemUsers").doc(uid).set(
      { uid, role: "PANEL_MEMBER", collegeId: session.collegeId, email, name },
      { merge: true }
    );

    return NextResponse.json({ ok: true, facultyId: facultyRef.id, employeeId });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[offer-letters/provision POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
