import { randomBytes } from "crypto";
import { createFirebaseUser } from "@/lib/firebase/authRest";
import type { EmploymentType } from "@/types";

export type ProvisionResult =
  | { status: "created"; facultyId: string; employeeId: string; generatedPassword: string }
  | { status: "already_exists"; facultyId: string }
  | { status: "no_email" }
  | { status: "email_taken" }
  | { status: "not_found" };

export type LinkExistingAccountResult =
  | { status: "linked"; facultyId: string; employeeId: string; assignedEmail: string }
  | { status: "already_exists"; facultyId: string }
  | { status: "not_found" }
  | { status: "existing_user_not_found" };

export function generatePassword(): string {
  return randomBytes(9).toString("base64url"); // 12 url-safe chars
}

async function generateEmployeeId(db: FirebaseFirestore.Firestore, collegeId: string): Promise<string> {
  const snap = await db.collection("colleges").doc(collegeId).collection("facultyMembers").count().get();
  const count = snap.data().count + 1;
  return `EMP${String(count).padStart(4, "0")}`;
}

// Shared by the offer-letters POST route (HOD sends the offer, supplying the
// faculty's college email + login credentials directly) and the manual
// /provision retry endpoint (falls back to the candidate's personal
// application email + a generated password when no college email was ever
// collected, e.g. retrying an older offer created before this flow existed).
export async function provisionFacultyFromOffer(
  db: FirebaseFirestore.Firestore,
  collegeId: string,
  offerId: string,
  credentials?: { collegeEmail: string; password: string },
  // Office-supplied extras from a faculty-account request (see
  // facultyAccountRequests) — fill in exactly the fields this function used
  // to always leave blank/wrong (qualification/specialization were always
  // "", employmentType was the invalid literal "FULL_TIME").
  profileFields?: { employmentType?: EmploymentType; qualification?: string; specialization?: string }
): Promise<ProvisionResult> {
  const letterSnap = await db.collection("colleges").doc(collegeId).collection("offerLetters").doc(offerId).get();
  if (!letterSnap.exists) return { status: "not_found" };

  const letter = letterSnap.data() as {
    candidateId?: string;
    candidateName?: string;
    designation?: string;
    department?: string;
    joiningDate?: { toDate?: () => Date } | string;
    status?: string;
  };
  if (!letter.candidateId) return { status: "not_found" };

  const existingFaculty = await db
    .collection("colleges")
    .doc(collegeId)
    .collection("facultyMembers")
    .where("candidateId", "==", letter.candidateId)
    .limit(1)
    .get();
  if (!existingFaculty.empty) {
    return { status: "already_exists", facultyId: existingFaculty.docs[0].id };
  }

  const candSnap = await db.collection("colleges").doc(collegeId).collection("candidates").doc(letter.candidateId).get();
  if (!candSnap.exists) return { status: "not_found" };

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
  // College email is the login username. Falls back to the candidate's personal
  // application email only when no college email was ever collected (legacy retry).
  const collegeEmail = credentials?.collegeEmail || candidate.email || "";
  const name = candidate.name ?? letter.candidateName ?? "";
  if (!collegeEmail) return { status: "no_email" };

  const now = new Date();
  let joiningDate: Date;
  if (letter.joiningDate && typeof (letter.joiningDate as { toDate?: () => Date }).toDate === "function") {
    joiningDate = (letter.joiningDate as { toDate: () => Date }).toDate();
  } else if (letter.joiningDate) {
    joiningDate = new Date(letter.joiningDate as string);
  } else {
    joiningDate = now;
  }

  const generatedPassword = credentials?.password || generatePassword();
  let uid: string;
  try {
    uid = await createFirebaseUser(collegeEmail, generatedPassword, name);
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && err.code === "auth/email-already-exists") {
      // The existingFaculty check above already returned "already_exists" if a
      // facultyMembers doc for this candidate exists — reaching here means no
      // such doc exists yet, so any systemUsers match on this email belongs to
      // a different person. Don't silently hijack their account; let the
      // caller fall back to an alternate email instead.
      return { status: "email_taken" };
    }
    throw err;
  }

  const employeeId = await generateEmployeeId(db, collegeId);
  const department = letter.department ?? candidate.department ?? "";

  const facultyRef = db.collection("colleges").doc(collegeId).collection("facultyMembers").doc();
  const batch = db.batch();

  batch.set(
    db.collection("colleges").doc(collegeId).collection("users").doc(uid),
    {
      uid,
      collegeId,
      name,
      email: collegeEmail,
      role: "PANEL_MEMBER",
      department,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
    { merge: true }
  );

  batch.set(facultyRef, {
    collegeId,
    candidateId: letter.candidateId,
    offerId,
    employeeId,
    name,
    collegeEmail,
    ...(candidate.email ? { email: candidate.email } : {}),
    phone: candidate.phone ?? "",
    department,
    designation: letter.designation ?? "Assistant Professor",
    qualification: profileFields?.qualification ?? "",
    specialization: profileFields?.specialization ?? "",
    experienceYears: 0,
    joiningDate,
    employmentType: profileFields?.employmentType ?? "PERMANENT",
    // Account creation is normally deferred until after the candidate accepts
    // (see Request Credentials on college-office/offers, fulfilled via
    // webmaster/credential-requests), so the accept-time flip in
    // offer-letters/[id]/route.ts PATCH will already have run and found no
    // faculty doc yet — go straight to ACTIVE here instead of relying on it.
    // Falls back to INTERVIEW_DONE for the rarer case of provisioning before
    // acceptance (e.g. a manual retry on a not-yet-accepted offer).
    status: letter.status === "ACCEPTED" ? "ACTIVE" : "INTERVIEW_DONE",
    userUid: uid,
    ...(candidate.courseId && candidate.preferredSubjectIds?.length
      ? {
          pendingTeachingPreference: {
            courseId: candidate.courseId,
            courseName: candidate.courseName ?? "",
            year: candidate.year ?? 1,
            subjectIds: candidate.preferredSubjectIds,
            subjectNames: candidate.preferredSubjectNames ?? [],
          },
        }
      : {}),
    createdAt: now,
    updatedAt: now,
  });

  batch.set(
    db.collection("systemUsers").doc(uid),
    { uid, role: "PANEL_MEMBER", collegeId, email: collegeEmail, name },
    { merge: true }
  );

  await batch.commit();

  return { status: "created", facultyId: facultyRef.id, employeeId, generatedPassword };
}

// Lets the Webmaster attach a new offer to a person's already-existing login
// (e.g. a re-hire, or someone who already holds another staff account at this
// college) instead of provisioning a brand-new Firebase Auth user -
// provisionFacultyFromOffer above has no way to do this: it either silently
// no-ops (candidate already has a facultyMembers doc) or hard-fails with
// "email_taken" when the target email belongs to somebody else's account, with
// no path to deliberately reuse that account. Reuses the existing account's
// own uid + email; no new Firebase Auth user or password is created, and the
// existing account's role/systemUsers doc is left untouched so linking can't
// accidentally change what the person already has access to.
export async function linkFacultyToExistingAccount(
  db: FirebaseFirestore.Firestore,
  collegeId: string,
  offerId: string,
  existingUid: string
): Promise<LinkExistingAccountResult> {
  const collegeRef = db.collection("colleges").doc(collegeId);
  const letterSnap = await collegeRef.collection("offerLetters").doc(offerId).get();
  if (!letterSnap.exists) return { status: "not_found" };

  const letter = letterSnap.data() as {
    candidateId?: string;
    candidateName?: string;
    designation?: string;
    department?: string;
    joiningDate?: { toDate?: () => Date } | string;
    status?: string;
  };
  if (!letter.candidateId) return { status: "not_found" };

  const existingFaculty = await collegeRef
    .collection("facultyMembers")
    .where("candidateId", "==", letter.candidateId)
    .limit(1)
    .get();
  if (!existingFaculty.empty) {
    return { status: "already_exists", facultyId: existingFaculty.docs[0].id };
  }

  const [candSnap, existingUserSnap] = await Promise.all([
    collegeRef.collection("candidates").doc(letter.candidateId).get(),
    collegeRef.collection("users").doc(existingUid).get(),
  ]);
  if (!candSnap.exists) return { status: "not_found" };
  if (!existingUserSnap.exists) return { status: "existing_user_not_found" };

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
  const existingUser = existingUserSnap.data() as { name?: string; email?: string };
  const name = candidate.name ?? letter.candidateName ?? existingUser.name ?? "";
  const collegeEmail = existingUser.email ?? candidate.email ?? "";

  const now = new Date();
  let joiningDate: Date;
  if (letter.joiningDate && typeof (letter.joiningDate as { toDate?: () => Date }).toDate === "function") {
    joiningDate = (letter.joiningDate as { toDate: () => Date }).toDate();
  } else if (letter.joiningDate) {
    joiningDate = new Date(letter.joiningDate as string);
  } else {
    joiningDate = now;
  }

  const employeeId = await generateEmployeeId(db, collegeId);
  const department = letter.department ?? candidate.department ?? "";

  const facultyRef = collegeRef.collection("facultyMembers").doc();
  await facultyRef.set({
    collegeId,
    candidateId: letter.candidateId,
    offerId,
    employeeId,
    name,
    collegeEmail,
    ...(candidate.email ? { email: candidate.email } : {}),
    phone: candidate.phone ?? "",
    department,
    designation: letter.designation ?? "Assistant Professor",
    qualification: "",
    specialization: "",
    experienceYears: 0,
    joiningDate,
    employmentType: "PERMANENT",
    status: letter.status === "ACCEPTED" ? "ACTIVE" : "INTERVIEW_DONE",
    userUid: existingUid,
    linkedExistingAccount: true,
    ...(candidate.courseId && candidate.preferredSubjectIds?.length
      ? {
          pendingTeachingPreference: {
            courseId: candidate.courseId,
            courseName: candidate.courseName ?? "",
            year: candidate.year ?? 1,
            subjectIds: candidate.preferredSubjectIds,
            subjectNames: candidate.preferredSubjectNames ?? [],
          },
        }
      : {}),
    createdAt: now,
    updatedAt: now,
  });

  return { status: "linked", facultyId: facultyRef.id, employeeId, assignedEmail: collegeEmail };
}
