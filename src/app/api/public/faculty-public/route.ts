export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import type { FacultyMember, DegreeDetail } from "@/types";

// Public "meet the faculty" page — no auth, reached via a short, human-
// readable link keyed on employeeId alone (?employeeId=EMP0001), not the
// Firestore collegeId/docId pair. Safe only because employeeId is now
// enforced unique across every college (see the collectionGroup checks in
// POST/PATCH /api/college/faculty and its import route) — if two records
// still share an id (pre-existing data from before that check landed), this
// fails closed with 409 rather than guessing which one to show.
//
// Same field-allowlist security model as candidate-form/offer-acceptance:
// hand-picked response fields, not a raw doc dump. Everything HR/financial/
// personal stays server-side: marital status, salary/CTC, Aadhar/PAN,
// addresses, phone, teaching load (weekly credit hours), promotion history,
// DOB, family details, etc. never leave this allowlist.

function publicDegree(d?: DegreeDetail) {
  if (!d) return undefined;
  return {
    degree: d.degree,
    branch: d.branch,
    specialization: d.specialization,
    universityOrInstitute: d.universityOrInstitute,
    yearOfCompletion: d.yearOfCompletion,
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
    const matches = await db
      .collectionGroup("facultyMembers")
      .where("employeeId", "==", employeeId)
      .limit(2)
      .get();

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

    const faculty = facultyDoc.data() as FacultyMember;
    const collegeName = (collegeSnap?.data() as { name?: string } | undefined)?.name ?? "";
    const ap = faculty.academicProfile;

    return NextResponse.json({
      profile: {
        collegeName,
        name: faculty.name,
        designation: faculty.designation,
        department: faculty.department,
        profilePhotoUrl: faculty.profilePhotoUrl || undefined,
        qualification: faculty.qualification,
        specialization: faculty.specialization,
        experienceYears: faculty.experienceYears,
        officialEmail: faculty.officialEmail || undefined,
        joiningYear: faculty.joiningDate ? faculty.joiningDate.toDate().getFullYear() : undefined,

        education: ap
          ? {
              highestQualification: ap.highestQualification,
              ugDetails: publicDegree(ap.ugDetails),
              pgDetails: publicDegree(ap.pgDetails),
              additionalPgDetails: (ap.additionalPgDetails ?? []).map(publicDegree),
              phdDetails: publicDegree(ap.phdDetails),
              additionalPhdDetails: (ap.additionalPhdDetails ?? []).map(publicDegree),
              postDoctoralDetails: publicDegree(ap.postDoctoralDetails),
              phdStatus: ap.phdStatus,
              netSletQualificationYear: ap.netSletQualificationYear,
              gateQualifiedYear: ap.gateQualifiedYear,
            }
          : undefined,

        previousInstitutions: (ap?.previousInstitutions ?? []).map((p) => ({
          institutionName: p.institutionName,
          designation: p.designation,
          fromYear: p.fromYear,
          toYear: p.toYear,
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
              authoredBooks: ap.authoredBooks ?? [],
            }
          : undefined,

        projects: ap
          ? {
              fundedProjects: (ap.fundedProjects ?? []).map((p) => ({
                title: p.title,
                fundingAgency: p.fundingAgency,
                year: p.year,
                status: p.status,
                piOrCoPi: p.piOrCoPi,
              })),
              consultancyProjects: (ap.consultancyProjects ?? []).map((p) => ({
                title: p.title,
                clientOrAgency: p.clientOrAgency,
                year: p.year,
                status: p.status,
              })),
              patents: ap.patents
                ? {
                    indianGranted: ap.patents.indianGranted,
                    indianFiled: ap.patents.indianFiled,
                    internationalGranted: ap.patents.internationalGranted,
                    internationalFiled: ap.patents.internationalFiled,
                  }
                : undefined,
            }
          : undefined,

        recognition: ap
          ? {
              awardEntries: (ap.awardEntries ?? []).map((a) => ({
                title: a.title,
                awardingBody: a.awardingBody,
                year: a.year,
              })),
              professionalMemberships: (ap.professionalMemberships ?? []).map((m) => ({
                body: m.body,
                otherName: m.otherName,
                sinceYear: m.sinceYear,
              })),
              adminResponsibilityEntries: (ap.adminResponsibilityEntries ?? []).map((r) => ({
                category: r.category,
                description: r.description,
                fromYear: r.fromYear,
                toYear: r.toYear,
              })),
              labsEstablished: ap.labsEstablished ?? [],
              trainingEntries: (ap.trainingEntries ?? []).map((t) => ({
                type: t.type,
                title: t.title,
                organizer: t.organizer,
                year: t.year,
              })),
              nationalExposure: ap.nationalExposure,
              internationalExposure: ap.internationalExposure,
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
