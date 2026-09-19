import type { Firestore } from "firebase-admin/firestore";
import type { IprInventor } from "@/types";

// Server-side finalization of submitted IprInventor[] - identical to
// publications' finalizePublicationDetails author loop (src/lib/publications/
// deriveFlatFields.ts), just Author renamed to Inventor: an Internal
// inventor's Faculty ID (or Student Registration Number) is re-verified/
// trusted the same way, and affiliation is resolved to the submitter's own
// college - never trust a client-submitted name/affiliation for an Internal
// inventor. An Internal Faculty inventor whose Faculty ID doesn't resolve is
// downgraded to External.
export async function finalizeIprInventors(
  db: Firestore, ownCollegeId: string, inventors: IprInventor[]
): Promise<IprInventor[]> {
  let ownCollegeName = "";
  async function ownCollege() {
    if (!ownCollegeName) {
      const snap = await db.collection("colleges").doc(ownCollegeId).get();
      ownCollegeName = (snap.data() as { name?: string } | undefined)?.name ?? "";
    }
    return ownCollegeName;
  }

  const finalized: IprInventor[] = [];
  for (const inv of inventors) {
    if (inv.isInternal && inv.authorType === "FACULTY" && inv.facultyId?.trim()) {
      const snap = await db.collection("colleges").doc(ownCollegeId).collection("facultyMembers")
        .where("employeeId", "==", inv.facultyId.trim()).limit(1).get();
      const f = snap.docs[0]?.data() as { name?: string; legalName?: string } | undefined;
      if (f) {
        finalized.push({
          // Full Name (as per SSC) preferred, Name (as per PAN) only as a fallback -
          // same precedence facultyDisplayName() uses everywhere else.
          ...inv, isInternal: true, name: f.legalName?.trim() || f.name?.trim() || inv.name,
          affiliationCollegeId: ownCollegeId, affiliationCollegeName: await ownCollege(), affiliationCountry: undefined,
        });
        continue;
      }
      finalized.push({ ...inv, isInternal: false });
      continue;
    }
    if (inv.isInternal && inv.authorType === "STUDENT" && inv.studentRegistrationNumber?.trim()) {
      finalized.push({ ...inv, isInternal: true, affiliationCollegeId: ownCollegeId, affiliationCollegeName: await ownCollege(), affiliationCountry: undefined });
      continue;
    }
    finalized.push({ ...inv, isInternal: false });
  }
  return finalized;
}
