import { facultyDisplayName } from "@/lib/faculty/facultyDisplayName";

// Faculty single source of truth. A faculty member's details live on the facultyMembers record; the
// login (colleges/{c}/users) is identity + access plus a derived mirror. The switch below turns the
// new behaviour ON per college so every other college stays byte-identical:
//   FACULTY_SINGLE_SOURCE_COLLEGES=<collegeId>[,<collegeId>...]   (unset/empty = OFF everywhere)

export function singleSourceColleges(raw: string | undefined = process.env.FACULTY_SINGLE_SOURCE_COLLEGES): Set<string> {
  return new Set((raw ?? "").split(",").map((s) => s.trim()).filter(Boolean));
}

export function isSingleSourceCollege(collegeId: string | undefined | null, raw?: string): boolean {
  if (!collegeId) return false;
  return (raw === undefined ? singleSourceColleges() : singleSourceColleges(raw)).has(collegeId);
}

// Fields the login only MIRRORS from the faculty record (see syncLinkedLoginName / setLinkedFacultyPhoto).
// Everything else on the login (uid, role, isActive, email, seatRoles, seatIds, departments, ...) is
// identity/access and is never taken from the faculty record.
export const FACULTY_OWNED_MIRRORED_KEYS = ["name", "profilePhotoUrl", "employeeId", "department", "designation", "mobileNo"] as const;

// Personal / statutory details (PersonalDetailsInput) plus the academic profile: the profile CONTENT of a
// faculty member. In a switched-on college it is written to the faculty record only.
export const FACULTY_PERSONAL_KEYS = [
  "gender", "dateOfBirth", "legalName", "nameAsPerAadhar", "nameAsPerPan", "fatherName", "motherName", "religion", "caste", "subCaste",
  "aadharNo", "panNo", "passportNo", "differentlyAbled", "differentlyAbledDetails", "bankAccountNumber", "ifscCode", "bankName", "bankBranch",
  "bankOtherDetails", "emergencyContactName", "emergencyContactRelation", "emergencyContactMobileNo", "ratificationStatus",
  "ratificationProceedingsNumber", "ratificationDate", "ratifications", "maritalStatus", "spouseName", "numberOfChildren", "temporaryAddress",
  "permanentAddressSameAsTemporary", "permanentAddress", "bloodGroup", "motherTongue", "languagesKnown", "height", "weightKg", "pfNumber",
  "uanNumber", "esiNumber",
] as const;
export const FACULTY_PROFILE_BODY_KEYS = [...FACULTY_PERSONAL_KEYS, "academicProfile", "academicProfileChanges"] as const;

// Everything the merge takes from the faculty record when it is non-empty.
export const FACULTY_OWNED_KEYS = [...FACULTY_OWNED_MIRRORED_KEYS, ...FACULTY_PERSONAL_KEYS, "academicProfile"] as const;

const isEmpty = (v: unknown): boolean =>
  v === undefined || v === null || (typeof v === "string" && v.trim() === "") ||
  (Array.isArray(v) && v.length === 0) ||
  (typeof v === "object" && !Array.isArray(v) && Object.keys(v as object).length === 0 && !(v instanceof Date) &&
    typeof (v as { toDate?: unknown }).toDate !== "function");

type Obj = Record<string, unknown>;

// `lifted` = migrateFacultyDoc(facultyDoc), `login` = the (migrated) login doc. Default precedence is
// unchanged ({...lifted, ...login}); with `facultyWins` the faculty value replaces the login's mirrored copy,
// but ONLY when the faculty value is non-empty - a blank on the faculty record never hides a value the login
// still holds (no data is hidden, nothing is written).
export function mergeFacultyWithLogin<L extends Obj>(lifted: Obj, login: L, facultyWins: boolean): L & Obj {
  const merged: Obj = { ...lifted, ...login };
  if (!facultyWins) return merged as L & Obj;
  for (const key of FACULTY_OWNED_KEYS) {
    const facultyValue = key === "name" ? facultyDisplayName(lifted as { legalName?: string }) : lifted[key];
    if (!isEmpty(facultyValue)) merged[key] = facultyValue;
  }
  return merged as L & Obj;
}

// ─── Write guard (R1 / R4) ─────────────────────────────────────────────────
// In a switched-on college the login-side routes (users/me, users/[uid]) must not write a faculty member's
// profile content or mirrored identity fields onto the LOGIN: the faculty record is the single source, and a
// second copy on the login would silently shadow it. The route refuses (409, nothing written) and says where
// to edit. Never deletes or rewrites anything that already exists.

const IDENTITY_FIELDS: { key: "name" | "employeeId" | "phone"; label: string }[] = [
  { key: "name", label: "Name" }, { key: "employeeId", label: "Employee ID" }, { key: "phone", label: "Mobile number" },
];

export interface SingleSourceBlock { status: 409; message: string; fields: string[] }

export function singleSourceBlockFor(requestBody: object, login: Obj): SingleSourceBlock | null {
  const body = requestBody as Obj;
  const fields: string[] = [];
  for (const key of FACULTY_PROFILE_BODY_KEYS) if (body[key] !== undefined) fields.push(key);
  // Identity fields count only when they actually CHANGE the login's stored value - the staff edit form
  // re-sends every field, and an unchanged re-send must keep working.
  for (const { key, label } of IDENTITY_FIELDS) {
    const sent = body[key];
    if (typeof sent !== "string") continue;
    const stored = typeof login[key] === "string" ? (login[key] as string) : "";
    if (sent.trim() !== stored.trim()) fields.push(label);
  }
  if (fields.length === 0) return null;
  return {
    status: 409,
    fields,
    message: "This person's details are kept on their Faculty record. Edit them from the Faculty profile page so the two never disagree. Nothing was changed.",
  };
}

export async function hasLinkedFacultyRecord(db: FirebaseFirestore.Firestore, collegeId: string, uid: string): Promise<boolean> {
  const snap = await db.collection("colleges").doc(collegeId).collection("facultyMembers").where("userUid", "==", uid).limit(1).get();
  return !snap.empty;
}
