import { randomBytes } from "crypto";
import { createFirebaseUser } from "@/lib/firebase/authRest";

export type ProvisionResult =
  | { status: "created"; facultyId: string; employeeId: string; generatedPassword: string }
  | { status: "already_exists"; facultyId: string }
  | { status: "no_email" }
  | { status: "not_found" };

function generatePassword(): string {
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
  credentials?: { collegeEmail: string; password: string }
): Promise<ProvisionResult> {
  const letterSnap = await db.collection("colleges").doc(collegeId).collection("offerLetters").doc(offerId).get();
  if (!letterSnap.exists) return { status: "not_found" };

  const letter = letterSnap.data() as {
    candidateId?: string;
    candidateName?: string;
    designation?: string;
    department?: string;
    joiningDate?: { toDate?: () => Date } | string;
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
      const sysSnap = await db.collection("systemUsers").where("email", "==", collegeEmail).limit(1).get();
      if (sysSnap.empty) {
        console.warn("[facultyProvisioning] email already exists but no systemUsers doc found:", collegeEmail);
        return { status: "no_email" };
      }
      uid = sysSnap.docs[0].id;
    } else {
      throw err;
    }
  }

  const employeeId = await generateEmployeeId(db, collegeId);
  const department = letter.department ?? candidate.department ?? "";

  await db
    .collection("colleges")
    .doc(collegeId)
    .collection("users")
    .doc(uid)
    .set(
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

  const facultyRef = db.collection("colleges").doc(collegeId).collection("facultyMembers").doc();
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
    employmentType: "FULL_TIME",
    status: "ACTIVE",
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

  await db.collection("systemUsers").doc(uid).set({ uid, role: "PANEL_MEMBER", collegeId, email: collegeEmail, name }, { merge: true });

  return { status: "created", facultyId: facultyRef.id, employeeId, generatedPassword };
}
