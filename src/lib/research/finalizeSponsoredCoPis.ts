import type { Firestore } from "firebase-admin/firestore";
import type { SponsoredProjectCoPI } from "@/types";
import { facultyDisplayName } from "@/lib/faculty/facultyDisplayName";

// A Co-PI from this college is picked (department, then faculty) and never typed, so what is
// stored comes from the real facultyMembers record: name, department and the college's own name
// as affiliation. A Co-PI from elsewhere ("Other") is kept as the submitter typed it. Same idea
// as finalizePublicationDetails / finalizeIprInventors, except an Employee ID that matches nobody
// is refused outright here rather than quietly turned into an outside person.
export async function finalizeSponsoredCoPis(
  db: Firestore, collegeId: string, coPis: SponsoredProjectCoPI[]
): Promise<{ coPis: SponsoredProjectCoPI[]; internalAuthorUids: string[] } | { error: string }> {
  let collegeName: string | null = null;
  const out: SponsoredProjectCoPI[] = [];
  // Login uid of every internal Co-PI, stored on the record so it shows on THEIR dashboard at once.
  const internalAuthorUids = new Set<string>();

  for (const c of coPis) {
    if (c.isInternal !== true) {
      out.push({
        name: (c.name ?? "").trim(), department: (c.department ?? "").trim(), affiliation: (c.affiliation ?? "").trim(),
        isInternal: false,
      });
      continue;
    }
    const facultyId = (c.facultyId ?? "").trim();
    const snap = facultyId
      ? await db.collection("colleges").doc(collegeId).collection("facultyMembers").where("employeeId", "==", facultyId).limit(1).get()
      : null;
    const f = snap?.docs[0]?.data() as { legalName?: string; honorific?: string; department?: string; userUid?: string } | undefined;
    if (!f) return { error: `No faculty member found with Faculty ID "${facultyId}" - pick the Co-PI again` };
    if (collegeName === null) {
      const college = await db.collection("colleges").doc(collegeId).get();
      collegeName = (college.data() as { name?: string } | undefined)?.name ?? "";
    }
    if (f.userUid) internalAuthorUids.add(f.userUid);
    out.push({
      name: facultyDisplayName(f) || (c.name ?? "").trim(),
      department: f.department ?? (c.department ?? "").trim(),
      affiliation: collegeName,
      isInternal: true,
      facultyId,
    });
  }
  return { coPis: out, internalAuthorUids: [...internalAuthorUids] };
}
