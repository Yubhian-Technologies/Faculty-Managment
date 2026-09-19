export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { buildPersonalDetailsUpdate, type PersonalDetailsInput } from "@/lib/firestore/personalDetails";
import { syncTrainingEntryCoConductors } from "@/lib/faculty/syncTrainingEntryCoConductors";
import { normalizeAcademicProfile } from "@/lib/faculty/academicProfileCompat";
import { migrateFacultyDoc, migrateUserDoc } from "@/lib/faculty/fieldRenames";
import { withLegacyFacultyKeysDeleted } from "@/lib/faculty/legacyKeyDeletes";
import { FieldValue } from "firebase-admin/firestore";
import type { TrainingEntry } from "@/types";

const FINANCIAL_ACADEMIC_KEYS = ["monthlySalary", "grossAnnualCTC", "incrementsAwarded", "fundingConsultancyRevenueGeneration"];
// Researcher IDs go through R&D verification (POST /api/college/research-profile)
// instead - stripped here so a direct PATCH can't set them unverified.
const RESEARCH_PROFILE_KEYS = ["orcidId", "scopusAuthorId", "researcherId", "googleScholarId", "irinsProfile"];

// Self-service lookup for "My Profile" pages. Two different data shapes can hold
// "this person's own details" depending on how their account was provisioned:
//  - PANEL_MEMBER (hired through the Faculty Register) gets a THIN login doc at
//    colleges/{id}/users/{uid} plus a separate, richer FacultyMember record
//    (colleges/{id}/facultyMembers/{facultyId}) linked back via userUid.
//  - HOD/PRINCIPAL/VICE_PRINCIPAL (provisioned via POST /api/college/users) have
//    no separate FacultyMember record at all - their academicProfile and personal
//    details live directly ON their own colleges/{id}/users/{uid} doc.
// So: try the FacultyMember link first, and only fall back to the caller's own
// user doc if that comes up empty - that fallback is what makes HOD/Principal
// "My Profile" show anything beyond name/email/role.
export async function GET() {
  try {
    const session = await requireCollegeMember(
      "PANEL_MEMBER", "HOD", "PRINCIPAL", "VICE_PRINCIPAL",
      "COLLEGE_OFFICE", "COLLEGE_STAFF", "DEAN", "IQAC_COORDINATOR",
      "T_AND_P", "R_AND_D", "PLACEMENT_DEPT", "LIBRARY", "EXAM_CELL", "WEBMASTER", "COLLEGE_ACCOUNTS"
    );

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);

    const facultySnap = await collegeRef
      .collection("facultyMembers")
      .where("userUid", "==", session.uid)
      .limit(1)
      .get();

    if (!facultySnap.empty) {
      const facultyDoc = facultySnap.docs[0];
      const assignmentsSnap = await collegeRef
        .collection("teachingAssignments")
        .where("facultyId", "==", facultyDoc.id)
        .get();

      return NextResponse.json({
        faculty: { id: facultyDoc.id, ...migrateFacultyDoc(facultyDoc.data()) },
        teachingAssignments: assignmentsSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
      });
    }

    const userSnap = await collegeRef.collection("users").doc(session.uid).get();
    if (!userSnap.exists) {
      return NextResponse.json({ faculty: null, teachingAssignments: [] });
    }

    return NextResponse.json({
      faculty: { id: userSnap.id, ...migrateUserDoc(userSnap.data() ?? {}) },
      teachingAssignments: [],
    });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/faculty/me GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// Self-service PATCH for PANEL_MEMBER - updates the facultyMembers doc (and syncs
// basic fields back to the thin users/{uid} doc so name/photo stay consistent).
// Employment fields (designation, department, joiningDate, employmentType, status,
// employeeId, collegeEmail) are never overwritten here - those belong to HR/admin.
export async function PATCH(request: Request) {
  try {
    const session = await requireCollegeMember("PANEL_MEMBER");

    const body = (await request.json()) as Partial<{
      name: string;
      email: string;
      phone: string;
      // Identity & Employment fields a Faculty member may edit about
      // themselves - deliberately excludes employeeId, collegeEmail,
      // designation, department, joiningDate, employeeCategory and
      // aicteFacultyId, which stay HR/HOD-controlled (see PATCH
      // /api/college/faculty/[id], HOD/Principal/VP only).
      apaarFacultyId: string;
      highestQualification: string;
      specialization: string;
      additionalPhoneNumbers: { label?: string; number: string }[];
      academicProfile: Record<string, unknown>;
      profilePhotoUrl: string;
    }> & PersonalDetailsInput;

    if (
      body.profilePhotoUrl !== undefined &&
      body.profilePhotoUrl !== "" &&
      !body.profilePhotoUrl.startsWith("https://firebasestorage.googleapis.com/")
    ) {
      return NextResponse.json({ error: "Invalid photo URL" }, { status: 400 });
    }

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);

    const facultySnap = await collegeRef
      .collection("facultyMembers")
      .where("userUid", "==", session.uid)
      .limit(1)
      .get();

    if (facultySnap.empty) {
      return NextResponse.json({ error: "Faculty record not found" }, { status: 404 });
    }

    const facultyDoc = facultySnap.docs[0];
    const now = new Date();

    const facultyUpdates: Record<string, unknown> = { updatedAt: now, ...buildPersonalDetailsUpdate(body) };
    if (body.name?.trim()) facultyUpdates.name = body.name.trim();
    if (body.email?.trim()) facultyUpdates.email = body.email.trim();
    if (body.phone !== undefined) facultyUpdates.phone = body.phone;
    if (body.apaarFacultyId !== undefined) facultyUpdates.apaarFacultyId = body.apaarFacultyId;
    if (body.highestQualification?.trim()) facultyUpdates.highestQualification = body.highestQualification.trim();
    if (body.specialization !== undefined) facultyUpdates.specialization = body.specialization;
    if (body.additionalPhoneNumbers !== undefined) {
      facultyUpdates.additionalPhoneNumbers = body.additionalPhoneNumbers.filter((p) => p.number?.trim());
    }
    if (body.profilePhotoUrl !== undefined) facultyUpdates.profilePhotoUrl = body.profilePhotoUrl;
    if (body.academicProfile !== undefined) {
      const ap = { ...normalizeAcademicProfile(body.academicProfile) };
      for (const k of FINANCIAL_ACADEMIC_KEYS) delete ap[k];
      for (const k of RESEARCH_PROFILE_KEYS) delete ap[k];
      facultyUpdates.academicProfile = ap;
    }

    const previousFacultyData = facultyDoc.data() as { legalName?: string; name?: string; academicProfile?: { fdpsWorkshopsMoocsCertifications?: TrainingEntry[] } };

    // Full Name (as per SSC) preferred, Name (as per PAN) only as a fallback -
    // same precedence facultyDisplayName() uses everywhere else.
    const effectiveLegalName = body.legalName !== undefined ? body.legalName : previousFacultyData.legalName;
    const effectiveName = body.name?.trim() ? body.name.trim() : previousFacultyData.name;
    const newDisplayName = effectiveLegalName?.trim() || effectiveName?.trim() || "";
    const oldDisplayName = previousFacultyData.legalName?.trim() || previousFacultyData.name?.trim() || "";
    const displayNameChanged = (body.legalName !== undefined || !!body.name?.trim()) && newDisplayName !== oldDisplayName;

    // Drop the old-named twin of any key written above on a not-yet-migrated doc.
    await facultyDoc.ref.update(withLegacyFacultyKeysDeleted(facultyUpdates, FieldValue.delete()));

    // A faculty's display name is copied into teachingAssignments/timetableSlots/
    // Section at assignment/incharge-set time and never re-read afterward - a
    // self-service rename here must cascade into every one of those copies too,
    // same as the HOD/Principal-side PATCH /api/college/faculty/[id] does.
    if (displayNameChanged) {
      try {
        const collegeRef = db.collection("colleges").doc(session.collegeId);

        const [assignmentsSnap, slotsSnap] = await Promise.all([
          collegeRef.collection("teachingAssignments").where("facultyId", "==", facultyDoc.id).get(),
          collegeRef.collection("timetableSlots").where("facultyId", "==", facultyDoc.id).get(),
        ]);
        for (const [snapshot, field] of [[assignmentsSnap, "facultyName"], [slotsSnap, "facultyName"]] as const) {
          for (let i = 0; i < snapshot.docs.length; i += 400) {
            const chunk = snapshot.docs.slice(i, i + 400);
            const chunkBatch = db.batch();
            for (const doc of chunk) chunkBatch.update(doc.ref, { [field]: newDisplayName, updatedAt: now });
            await chunkBatch.commit();
          }
        }

        // Section.facultyInchargeUid holds either this faculty's linked login
        // uid or, on some older records, the FacultyMember doc id itself - see
        // PATCH /api/college/faculty/[id]'s own doc-comment on this.
        const inchargeCandidates = session.uid !== facultyDoc.id ? [session.uid, facultyDoc.id] : [facultyDoc.id];
        const sectionsSnap = await collegeRef.collection("sections").where("facultyInchargeUid", "in", inchargeCandidates).get();
        for (let i = 0; i < sectionsSnap.docs.length; i += 400) {
          const chunk = sectionsSnap.docs.slice(i, i + 400);
          const chunkBatch = db.batch();
          for (const doc of chunk) chunkBatch.update(doc.ref, { facultyInchargeName: newDisplayName, updatedAt: now });
          await chunkBatch.commit();
        }
      } catch (cascadeErr) {
        console.error("[college/faculty/me PATCH] facultyName cascade failed:", cascadeErr);
      }
    }

    if (body.academicProfile !== undefined) {
      try {
        const ownerName = previousFacultyData.legalName?.trim() || previousFacultyData.name?.trim() || "";
        const nextEntries = (facultyUpdates.academicProfile as { fdpsWorkshopsMoocsCertifications?: TrainingEntry[] } | undefined)?.fdpsWorkshopsMoocsCertifications;
        await syncTrainingEntryCoConductors(
          db, session.collegeId, facultyDoc.id, ownerName,
          normalizeAcademicProfile(previousFacultyData.academicProfile)?.fdpsWorkshopsMoocsCertifications, nextEntries
        );
      } catch (syncErr) {
        console.error("[college/faculty/me PATCH] co-conductor sync failed:", syncErr);
      }
    }

    // Keep the thin users/{uid} doc in sync so auth store reflects latest name/photo
    const userUpdates: Record<string, unknown> = { updatedAt: now };
    if (body.name?.trim()) userUpdates.name = body.name.trim();
    if (body.email?.trim()) userUpdates.email = body.email.trim();
    if (body.phone !== undefined) userUpdates.phone = body.phone;
    if (body.profilePhotoUrl !== undefined) userUpdates.profilePhotoUrl = body.profilePhotoUrl;
    await collegeRef.collection("users").doc(session.uid).update(userUpdates);

    if (body.name?.trim() || body.profilePhotoUrl !== undefined) {
      await db.collection("systemUsers").doc(session.uid).set(
        {
          ...(body.name?.trim() ? { name: body.name.trim() } : {}),
          ...(body.profilePhotoUrl !== undefined ? { profilePhotoUrl: body.profilePhotoUrl } : {}),
        },
        { merge: true }
      );
    }

    const facultyData = facultyDoc.data() as { name?: string };
    await collegeRef.collection("auditLogs").add({
      collegeId: session.collegeId,
      action: "FACULTY_UPDATED",
      performedBy: session.uid,
      performedByName: facultyData.name ?? "Unknown",
      targetId: facultyDoc.id,
      details: { self: true },
      timestamp: now,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/faculty/me PATCH]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
