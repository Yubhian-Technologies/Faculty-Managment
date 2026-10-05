export const dynamic = "force-dynamic";

import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { writeAuditLogSafe } from "@/lib/audit/safeAuditLog";
import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import type { PersonalDetailsInput } from "@/lib/firestore/personalDetails";
import { supportingStaffPersonalUpdate } from "@/lib/supportingStaff/personalUpdate";
import { normalizeSupportingStaffProfile } from "@/lib/faculty/academicProfileCompat";
import { migrateSupportingStaffDoc } from "@/lib/faculty/fieldRenames";
import { withLegacyPersonalKeysDeleted } from "@/lib/faculty/legacyKeyDeletes";
import { syncLinkedLoginName } from "@/lib/roles/loginSync";

// A Supporting Staff member's OWN record - the counterpart of /api/college/faculty/me for the COLLEGE_STAFF login.
// Their details live on the supportingStaff record (linked by userUid); the login (users/systemUsers) only mirrors
// name and photo. Everything the managing role controls (Employee ID, College Email, Designation, Department,
// Category, Date of Joining, Status) is never accepted here.

const UNLINKED_MESSAGE = "Your login is not linked to a staff record yet, so there are no staff details to show or edit. Please contact your HOD or College Office to link it.";

async function findOwnRecord(db: FirebaseFirestore.Firestore, collegeId: string, uid: string) {
  const snap = await db.collection("colleges").doc(collegeId).collection("supportingStaff").where("userUid", "==", uid).limit(1).get();
  return snap.empty ? null : snap.docs[0];
}

export async function GET() {
  try {
    const session = await requireCollegeMember("COLLEGE_STAFF");
    const doc = await findOwnRecord(getAdminDb(), session.collegeId, session.uid);
    if (!doc) return NextResponse.json({ staff: null, linkStatus: "UNLINKED", message: UNLINKED_MESSAGE });
    return NextResponse.json({ staff: { id: doc.id, ...migrateSupportingStaffDoc(doc.data()) } });
  } catch (err) {
    const badBody = badBodyResponse(err);
    if (badBody) return badBody;
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/supporting-staff/me GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// Must stay non-blank when sent - the Add wizard requires each of these.
const REQUIRED_IF_PRESENT = ["legalName", "mobileNo", "highestQualification"] as const;

export async function PATCH(request: Request) {
  try {
    const session = await requireCollegeMember("COLLEGE_STAFF");
    const body = (await readJsonBody(request)) as Partial<{
      legalName: string;
      nameAsPerPan: string;
      apaarFacultyId: string;
      highestQualification: string;
      email: string;
      mobileNo: string;
      additionalPhoneNumbers: { label?: string; number: string }[];
      supportingStaffProfile: Record<string, unknown>;
      profilePhotoUrl: string;
    }> & PersonalDetailsInput;

    for (const key of REQUIRED_IF_PRESENT) {
      if (body[key] !== undefined && !String(body[key]).trim()) {
        return NextResponse.json({ error: `${key} cannot be blanked out - it is a required field` }, { status: 400 });
      }
    }

    const db = getAdminDb();
    const doc = await findOwnRecord(db, session.collegeId, session.uid);
    if (!doc) return NextResponse.json({ error: UNLINKED_MESSAGE, code: "STAFF_RECORD_NOT_LINKED" }, { status: 404 });
    const current = doc.data() as { profilePhotoUrl?: string; legalName?: string; nameAsPerPan?: string };

    // Empty string clears the photo; anything else must be a real upload of this login's own (the value already
    // stored always passes, so a save that does not touch the photo can re-send it).
    if (
      body.profilePhotoUrl !== undefined && body.profilePhotoUrl !== "" && body.profilePhotoUrl !== (current.profilePhotoUrl ?? "") &&
      (!body.profilePhotoUrl.startsWith("https://firebasestorage.googleapis.com/") ||
        !body.profilePhotoUrl.includes(encodeURIComponent(`profile-photos/${session.uid}_`)))
    ) {
      return NextResponse.json({ error: "Invalid photo URL" }, { status: 400 });
    }

    const updates: Record<string, unknown> = { updatedAt: new Date(), ...supportingStaffPersonalUpdate(body) };
    if (body.legalName !== undefined) updates.legalName = body.legalName.trim();
    for (const key of ["nameAsPerPan", "apaarFacultyId", "email", "mobileNo", "highestQualification"] as const) {
      if (body[key] !== undefined) updates[key] = typeof body[key] === "string" ? body[key].trim() : body[key];
    }
    if (body.additionalPhoneNumbers !== undefined) {
      updates.additionalPhoneNumbers = body.additionalPhoneNumbers
        .map((p) => ({ ...(p.label?.trim() ? { label: p.label.trim() } : {}), number: p.number?.trim() ?? "" }))
        .filter((p) => p.number);
    }
    if (body.supportingStaffProfile !== undefined) updates.supportingStaffProfile = normalizeSupportingStaffProfile(body.supportingStaffProfile);
    if (body.profilePhotoUrl !== undefined) updates.profilePhotoUrl = body.profilePhotoUrl;

    // The record is the source of truth: written first, then the login mirror.
    await doc.ref.update(withLegacyPersonalKeysDeleted(updates, FieldValue.delete()));

    const loginSync: Record<string, string> = {};
    if (body.profilePhotoUrl !== undefined) loginSync.profilePhotoUrl = body.profilePhotoUrl;
    if (body.legalName !== undefined || body.nameAsPerPan !== undefined) {
      // The login's display name follows Full Name (as per SSC) first, Name (as per PAN) only as a fallback.
      const legalName = body.legalName !== undefined ? body.legalName : current.legalName;
      const panName = body.nameAsPerPan !== undefined ? body.nameAsPerPan : current.nameAsPerPan;
      loginSync.name = legalName?.trim() || panName?.trim() || "";
    }
    if (Object.keys(loginSync).length > 0) await syncLinkedLoginName(db, session.collegeId, doc.ref, session.uid, loginSync);

    const actorName = loginSync.name || current.legalName || "Unknown";
    await writeAuditLogSafe(db, session.collegeId, { action: "USER_UPDATED", performedBy: session.uid, performedByName: actorName, targetId: doc.id, details: { role: session.role, self: true, record: "supportingStaff" } });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const badBody = badBodyResponse(err);
    if (badBody) return badBody;
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/supporting-staff/me PATCH]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
