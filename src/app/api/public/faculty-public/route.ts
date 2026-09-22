export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { facultyDisplayName } from "@/lib/faculty/facultyDisplayName";
import { experienceBreakdown, allPreviousExperienceEntries } from "@/lib/faculty/experienceCalc";
import { normalizeAcademicProfile } from "@/lib/faculty/academicProfileCompat";
import { migrateFacultyDoc, migrateUserDoc } from "@/lib/faculty/fieldRenames";
import type { FacultyMember, FMSUser, DegreeDetail } from "@/types";

// Public "meet the faculty" page — no auth, reached via a short, human-
// readable link keyed on employeeId alone (?employeeId=EMP0001), not the
// Firestore collegeId/docId pair. Safe only because employeeId is now
// enforced unique across every college (see the collectionGroup checks in
// POST/PATCH /api/college/faculty and its import route) — if two records
// still share an id (pre-existing data from before that check landed), this
// fails closed with 409 rather than guessing which one to show.
//
// HOD/PRINCIPAL/VICE_PRINCIPAL have no facultyMembers record of their own —
// their employeeId (FMSUser.employeeId) lives directly on their users/{uid}
// doc instead (see /api/college/faculty/me's own doc-comment) — so a
// facultyMembers miss falls back to a users collectionGroup lookup before
// giving up. Same ambiguity/uniqueness handling either way.
//
// Same field-allowlist security model as candidate-form/offer-acceptance:
// hand-picked response fields, not a raw doc dump. Everything HR/financial/
// personal stays server-side: marital status, salary/CTC, Aadhar/PAN,
// addresses, phone, teaching load (weekly credit hours), promotion history,
// DOB, family details, etc. never leave this allowlist.

// `doctoral` picks which year key is exposed: yearOfAward for Doctoral/
// Post-Doctoral entries, yearOfPassing for everything else. The other key is
// omitted (not set to undefined) so the JSON stays minimal.
function publicDegree(d: DegreeDetail | undefined, doctoral: boolean) {
  if (!d) return undefined;
  return {
    course: d.course,
    degreeType: d.degreeType,
    branch: d.branch,
    specialization: d.specialization,
    institutionName: d.institutionName,
    ...(doctoral ? { yearOfAward: d.yearOfAward } : { yearOfPassing: d.yearOfPassing }),
  };
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const employeeId = searchParams.get("employeeId")?.trim();
    if (!employeeId) {
      return NextResponse.json({ error: "employeeId is required" }, { status: 400 });
    }

    const db = getAdminDb();
    let matches = await db
      .collectionGroup("facultyMembers")
      .where("employeeId", "==", employeeId)
      .limit(2)
      .get();
    let isUserDoc = false;
    if (matches.empty) {
      matches = await db.collectionGroup("users").where("employeeId", "==", employeeId).limit(2).get();
      isUserDoc = true;
    }

    if (matches.empty) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (matches.size > 1) {
      console.error("[public/faculty-public GET] ambiguous employeeId across colleges:", employeeId);
      return NextResponse.json({ error: "This ID is ambiguous - contact the administrator" }, { status: 409 });
    }

    const facultyDoc = matches.docs[0];
    const collegeRef = facultyDoc.ref.parent.parent;
    const collegeSnap = await collegeRef?.get();

    // Lift legacy key names on un-migrated docs (qualification/experienceYears, personal keys).
    // HOD/Principal/VP records (isUserDoc) don't carry FacultyMember's top-level
    // highestQualification/specialization/officialEmail/joiningDate — fall back to
    // the academicProfile's own highestQualification and to dateOfJoining/collegeEmail.
    const faculty = isUserDoc
      ? (migrateUserDoc(facultyDoc.data()) as unknown as FMSUser)
      : (migrateFacultyDoc(facultyDoc.data()) as unknown as FacultyMember);
    const collegeName = (collegeSnap?.data() as { name?: string } | undefined)?.name ?? "";

    // Every college on this platform, so each past posting can be marked as
    // INTERNAL (somewhere in the group) or EXTERNAL. Resolved here rather than
    // in the browser: the public page is unauthenticated and has no business
    // being handed the group's college list just to label two headings.
    // Compared on a normalized name - the only thing an experience entry
    // stores is free text typed by the faculty member, so punctuation and
    // casing routinely differ from the college record.
    const normalizeName = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const collegeNames = new Set(
      (await db.collection("colleges").get()).docs
        .map((d) => normalizeName(((d.data() as { name?: string }).name ?? "")))
        .filter(Boolean)
    );
    const ap = normalizeAcademicProfile(faculty.academicProfile);
    const joiningDate = isUserDoc ? (faculty as FMSUser).dateOfJoining : (faculty as FacultyMember).joiningDate;

    return NextResponse.json({
      profile: {
        collegeName,
        name: facultyDisplayName(faculty),
        designation: faculty.designation,
        department: faculty.department,
        profilePhotoUrl: faculty.profilePhotoUrl || undefined,
        highestQualification: isUserDoc ? ap?.highestQualification : (faculty as FacultyMember).highestQualification,
        specialization: isUserDoc ? undefined : (faculty as FacultyMember).specialization,
        // Total Years of Experience - computed live from Date of Joining +
        // the Academic/Industry/Research Experience entries, same canonical
        // calc as Faculty Details, not the stored (and only periodically
        // re-saved) totalYearsOfExperience field.
        totalYearsOfExperience: experienceBreakdown(allPreviousExperienceEntries(ap), joiningDate).total,
        officialEmail: (isUserDoc ? (faculty as FMSUser).collegeEmail : (faculty as FacultyMember).officialEmail) || undefined,
        joiningYear: joiningDate ? joiningDate.toDate().getFullYear() : undefined,
        // Full date as well as the year: the public page counts service at
        // this college from it, and a year alone can be a year out.
        joiningDate: joiningDate ? joiningDate.toDate().toISOString().slice(0, 10) : undefined,

        education: ap
          ? {
              highestQualification: ap.highestQualification,
              ugDetails: publicDegree(ap.ugDetails, false),
              additionalUgDetails: (ap.additionalUgDetails ?? []).map((d) => publicDegree(d, false)),
              pgDetails: publicDegree(ap.pgDetails, false),
              additionalPgDetails: (ap.additionalPgDetails ?? []).map((d) => publicDegree(d, false)),
              phdDetails: publicDegree(ap.phdDetails, true),
              additionalPhdDetails: (ap.additionalPhdDetails ?? []).map((d) => publicDegree(d, true)),
              postdoctoralFellowshipDetails: publicDegree(ap.postdoctoralFellowshipDetails, true),
              phdStatus: ap.phdDetails?.status,
              netSletSetGateOthers: ap.netSletSetGateOthers,
              qualifiedExam: ap.qualifiedExam,
              qualifiedYear: ap.qualifiedYear,
            }
          : undefined,

        // Dates: the real fromDate/toDate the current forms write, plus the
        // legacy fromYear/toYear for records not re-saved yet - the public view
        // shows whichever is present (see publicProfileDates.ts). Omitted
        // (not undefined) keys are dropped by JSON serialisation anyway.
        academicExperience: (ap?.academicExperience ?? []).map((p) => ({
          institutionName: p.institutionName,
          designation: p.designation,
          fromDate: p.fromDate,
          toDate: p.toDate,
          fromYear: p.fromYear,
          toYear: p.toYear,
          // Whether this posting was at a college on this platform.
          isInternal: collegeNames.has(normalizeName(p.institutionName ?? "")),
        })),

        research: ap
          ? {
              publications: (ap.publications ?? []).map((p) => ({
                title: p.title,
                coAuthors: p.coAuthors,
                journalOrConference: p.journalOrConference,
                publicationYear: p.publicationYear,
                indexing: p.indexing,
              })),
              totalPublications: ap.totalPublications,
              totalCitations: ap.totalCitations,
              hIndex: ap.hIndex,
              i10Index: ap.i10Index,
              googleScholarId: ap.googleScholarId,
              scopusAuthorId: ap.scopusAuthorId,
              orcidId: ap.orcidId,
            }
          : undefined,

        recognition: ap
          ? {
              awardsRecognition: (ap.awardsRecognition ?? []).map((a) => ({
                titleOfAward: a.titleOfAward,
                awardingAgencyBody: a.awardingAgencyBody,
                dateOfAward: a.dateOfAward,
                year: a.year, // legacy fallback
              })),
              professionalMemberships: (ap.professionalMemberships ?? []).map((m) => ({
                body: m.body,
                bodyName: m.bodyName,
                memberSince: m.memberSince,
                sinceMonthYear: m.sinceMonthYear, // legacy fallbacks
                sinceYear: m.sinceYear,
              })),
              academicResponsibilities: (ap.academicResponsibilities ?? []).map((r) => ({
                category: r.category,
                otherCategory: r.otherCategory,
                description: r.description,
                fromDate: r.fromDate,
                toDate: r.toDate,
                fromYear: r.fromYear, // legacy fallbacks
                toYear: r.toYear,
              })),
              newLabsEstablished: ap.newLabsEstablished ?? [],
              fdpsWorkshopsMoocsCertifications: (ap.fdpsWorkshopsMoocsCertifications ?? []).map((t) => ({
                type: t.type,
                pleaseSpecifyType: t.pleaseSpecifyType,
                titleOfTheProgram: t.titleOfTheProgram,
                nameOfTheFacultyCoordinator: t.nameOfTheFacultyCoordinator,
                fromDate: t.fromDate,
                toDate: t.toDate,
                year: t.year, // legacy fallback
                duration: t.duration, // days - FDP/Workshop only
                numberOfWeeks: t.numberOfWeeks, // MOOC/Certification only
                place: t.place,
                modeOfTheProgram: t.modeOfTheProgram,
              })),
            }
          : undefined,

        // Faculty/HR-authored free text (Module 7) — included as-is, same as
        // every other academicProfile field here; nothing else on the record
        // routes into this bucket.
        otherInformation: ap?.otherInformation,
      },
    });
  } catch (err) {
    console.error("[public/faculty-public GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
