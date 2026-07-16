export const dynamic = "force-dynamic";

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

async function createFacultyFromOffer(
  db: FirebaseFirestore.Firestore,
  collegeId: string,
  offerId: string
) {
  const letterSnap = await db
    .collection("colleges")
    .doc(collegeId)
    .collection("offerLetters")
    .doc(offerId)
    .get();
  if (!letterSnap.exists) return;

  const letter = letterSnap.data() as {
    candidateId?: string;
    candidateName?: string;
    designation?: string;
    department?: string;
    joiningDate?: { toDate?: () => Date } | string;
    ctcAnnual?: number;
    batchId?: string;
  };

  if (!letter.candidateId) return;

  // Check if faculty already created for this candidate
  const existingFaculty = await db
    .collection("colleges")
    .doc(collegeId)
    .collection("facultyMembers")
    .where("candidateId", "==", letter.candidateId)
    .limit(1)
    .get();
  if (!existingFaculty.empty) return; // already created

  // Fetch candidate for email + phone
  const candSnap = await db
    .collection("colleges")
    .doc(collegeId)
    .collection("candidates")
    .doc(letter.candidateId)
    .get();
  if (!candSnap.exists) return;

  const candidate = candSnap.data() as {
    name?: string;
    email?: string;
    phone?: string;
    department?: string;
    courseId?: string;
    courseName?: string;
    year?: number;
    preferredSubjectIds?: string[];
    preferredSubjectNames?: string[];
  };

  const email = candidate.email ?? "";
  const name = candidate.name ?? letter.candidateName ?? "";
  if (!email) return;

  const now = new Date();
  let joiningDate: Date;
  if (letter.joiningDate && typeof (letter.joiningDate as { toDate?: () => Date }).toDate === "function") {
    joiningDate = (letter.joiningDate as { toDate: () => Date }).toDate();
  } else if (letter.joiningDate) {
    joiningDate = new Date(letter.joiningDate as string);
  } else {
    joiningDate = now;
  }

  // Create Firebase Auth user — default password 12345678
  let uid: string;
  try {
    uid = await createFirebaseUser(email, DEFAULT_FACULTY_PASSWORD, name);
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && err.code === "auth/email-already-exists") {
      // User already has an account — look up existing UID via systemUsers
      const sysSnap = await db.collection("systemUsers").where("email", "==", email).limit(1).get();
      if (!sysSnap.empty) {
        uid = sysSnap.docs[0].id;
      } else {
        console.warn("[offer-letters] email already exists but no systemUsers doc found:", email);
        return;
      }
    } else {
      throw err;
    }
  }

  const employeeId = await generateEmployeeId(db, collegeId);
  const department = letter.department ?? candidate.department ?? "";

  // Login account (users collection)
  await db
    .collection("colleges")
    .doc(collegeId)
    .collection("users")
    .doc(uid)
    .set({
      uid,
      collegeId,
      name,
      email,
      role: "PANEL_MEMBER",
      department,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    }, { merge: true });

  // Faculty member record
  const facultyRef = db
    .collection("colleges")
    .doc(collegeId)
    .collection("facultyMembers")
    .doc();

  await facultyRef.set({
    collegeId,
    candidateId: letter.candidateId,
    offerId,
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
    ...(candidate.courseId && candidate.preferredSubjectIds?.length ? {
      pendingTeachingPreference: {
        courseId: candidate.courseId,
        courseName: candidate.courseName ?? "",
        year: candidate.year ?? 1,
        subjectIds: candidate.preferredSubjectIds,
        subjectNames: candidate.preferredSubjectNames ?? [],
      },
    } : {}),
    createdAt: now,
    updatedAt: now,
  });

  // Role mapping for session resolution
  await db.collection("systemUsers").doc(uid).set(
    { uid, role: "PANEL_MEMBER", collegeId, email, name },
    { merge: true }
  );
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireCollegeMember("ACCOUNTS", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN");
    const { id } = await params;
    const body = (await request.json()) as {
      status?: "DRAFT" | "SENT" | "ACCEPTED" | "REJECTED";
    };

    const db = getAdminDb();
    const now = new Date();
    const updates: Record<string, unknown> = { updatedAt: now };

    if (body.status) updates.status = body.status;

    await db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("offerLetters")
      .doc(id)
      .update(updates);

    // Auto-create faculty account as soon as the offer letter is sent
    if (body.status === "SENT") {
      await createFacultyFromOffer(db, session.collegeId, id);
    }

    // When candidate formally accepts, mark them APPROVED
    if (body.status === "ACCEPTED") {
      const letterSnap = await db
        .collection("colleges")
        .doc(session.collegeId)
        .collection("offerLetters")
        .doc(id)
        .get();
      const candidateId = (letterSnap.data() as { candidateId?: string }).candidateId;
      if (candidateId) {
        await db
          .collection("colleges")
          .doc(session.collegeId)
          .collection("candidates")
          .doc(candidateId)
          .update({ status: "APPROVED", updatedAt: now });
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[offer-letters/[id] PATCH]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireCollegeMember("ACCOUNTS", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN");
    const { id } = await params;
    const db = getAdminDb();

    await db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("offerLetters")
      .doc(id)
      .delete();

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[offer-letters/[id] DELETE]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
