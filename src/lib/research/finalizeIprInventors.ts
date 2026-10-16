import type { Firestore } from "firebase-admin/firestore";
import type { IprInventor } from "@/types";
import { facultyDisplayName } from "@/lib/faculty/facultyDisplayName";

// Server-side finalization of submitted IprInventor[] - identical to
// publications' finalizePublicationDetails author loop (src/lib/publications/
// deriveFlatFields.ts), just Author renamed to Inventor: an Internal
// inventor's Faculty ID (or a Student's name) is re-verified/
// trusted the same way, and affiliation is resolved to the submitter's own
// college - never trust a client-submitted name/affiliation for an Internal
// inventor. An Internal Faculty inventor whose Faculty ID doesn't resolve is
// downgraded to External.
export async function finalizeIprInventors(
  db: Firestore, ownCollegeId: string, inventors: IprInventor[]
): Promise<{ inventors: IprInventor[]; internalAuthorUids: string[] }> {
  let ownCollegeName = "";
  async function ownCollege() {
    if (!ownCollegeName) {
      const snap = await db.collection("colleges").doc(ownCollegeId).get();
      ownCollegeName = (snap.data() as { name?: string } | undefined)?.name ?? "";
    }
    return ownCollegeName;
  }

  const finalized: IprInventor[] = [];
  // Login uid of every verified internal faculty inventor, stored on the record so it shows on THEIR dashboard at once.
  const internalAuthorUids = new Set<string>();
  for (const inv of inventors) {
    if (inv.isInternal && inv.authorType === "FACULTY" && inv.facultyId?.trim()) {
      const snap = await db.collection("colleges").doc(ownCollegeId).collection("facultyMembers")
        .where("employeeId", "==", inv.facultyId.trim()).limit(1).get();
      const f = snap.docs[0]?.data() as { legalName?: string; userUid?: string } | undefined;
      if (f) {
        if (f.userUid) internalAuthorUids.add(f.userUid);
        finalized.push({
          // legalName only (facultyDisplayName()); the entered name stays if a record has none.
          ...inv, isInternal: true, name: facultyDisplayName(f) || inv.name,
          affiliationCollegeId: ownCollegeId, affiliationCollegeName: await ownCollege(), affiliationCountry: undefined,
        });
        continue;
      }
      finalized.push({ ...inv, isInternal: false });
      continue;
    }
    // The registration number is optional - a student inventor with a name is still internal.
    if (inv.isInternal && inv.authorType === "STUDENT" && (inv.name?.trim() || inv.studentRegistrationNumber?.trim())) {
      finalized.push({ ...inv, isInternal: true, affiliationCollegeId: ownCollegeId, affiliationCollegeName: await ownCollege(), affiliationCountry: undefined });
      continue;
    }
    finalized.push({ ...inv, isInternal: false });
  }
  return { inventors: finalized, internalAuthorUids: [...internalAuthorUids] };
}
