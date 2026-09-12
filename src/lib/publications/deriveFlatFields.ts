import type { Firestore } from "firebase-admin/firestore";
import type { PublicationDetails, PublicationAuthor } from "@/types";

// Server-side finalization of a submitted PublicationDetails: for each
// Internal author, re-verifies their Employee ID against a real
// facultyMembers record in the submitter's OWN college and pulls the
// name + login uid from that record (never trust a client-submitted name/
// isInternal for an Internal author - the whole point is it's looked up,
// not typed). An Internal author with no matching record is downgraded to
// External rather than silently accepted. `internalAuthorUids` is every
// verified Internal author's own login uid - stored on the publication so
// it shows on THEIR profile too, not just the submitter's (see
// api/college/publications/route.ts GET). Also derives the legacy flat
// ResearchPublication fields (title/journalOrConference/coAuthors/
// publicationYear/indexing/driveLink/citation) so every existing consumer
// of that flat shape (R&D's table, CSV export) keeps working unchanged.
export async function finalizePublicationDetails(
  db: Firestore, ownCollegeId: string, details: PublicationDetails
): Promise<{ details: PublicationDetails; internalAuthorUids: string[] }> {
  let ownCollegeName = "";
  const authors: PublicationAuthor[] = [];
  const internalAuthorUids: string[] = [];
  async function ownCollege() {
    if (!ownCollegeName) {
      const collegeSnap = await db.collection("colleges").doc(ownCollegeId).get();
      ownCollegeName = (collegeSnap.data() as { name?: string } | undefined)?.name ?? "";
    }
    return ownCollegeName;
  }

  for (const a of details.authors) {
    if (a.isInternal && a.authorType === "FACULTY" && a.facultyId?.trim()) {
      const snap = await db.collection("colleges").doc(ownCollegeId).collection("facultyMembers")
        .where("employeeId", "==", a.facultyId.trim()).limit(1).get();
      const f = snap.docs[0]?.data() as { name?: string; legalName?: string; userUid?: string } | undefined;
      if (f) {
        if (f.userUid) internalAuthorUids.push(f.userUid);
        authors.push({
          ...a, isInternal: true, name: f.name || f.legalName || a.name,
          affiliationCollegeId: ownCollegeId, affiliationCollegeName: await ownCollege(), affiliationCountry: undefined,
        });
        continue;
      }
      // Faculty ID didn't resolve - not verified, downgrade to External.
      authors.push({ ...a, isInternal: false });
      continue;
    }
    if (a.isInternal && a.authorType === "STUDENT" && a.studentRegistrationNumber?.trim()) {
      // No student directory to verify against - trusted as entered, no
      // internalAuthorUids entry (no login to cross-link their profile to).
      authors.push({ ...a, isInternal: true, affiliationCollegeId: ownCollegeId, affiliationCollegeName: await ownCollege(), affiliationCountry: undefined });
      continue;
    }
    // Not a verified Internal author - keep as External with whatever
    // affiliation was submitted (the client already excludes the caller's
    // own college from that picker).
    authors.push({ ...a, isInternal: false });
  }

  const finalized: PublicationDetails = {
    ...details,
    authors,
    internalAuthorsCount: authors.filter((a) => a.isInternal).length,
    externalAuthorsCount: authors.filter((a) => !a.isInternal).length,
  };
  return { details: finalized, internalAuthorUids };
}

export function deriveFlatFields(details: PublicationDetails) {
  const venueName = details.type === "JOURNAL" ? details.journalName
    : details.type === "CONFERENCE" ? details.conferenceName
    : details.type === "BOOK_CHAPTER" ? details.bookName
    : details.publisherName;
  const year = Number(details.monthYearOfPublication?.slice(0, 4));

  return {
    title: details.title,
    journalOrConference: venueName ?? "",
    coAuthors: details.authors.map((a) => a.name).filter(Boolean).join(", "),
    publicationYear: Number.isFinite(year) && year > 0 ? year : new Date().getFullYear(),
    indexing: (details.indexedIn ?? []).join(", "),
    driveLink: (details.type === "TEXT_BOOK" ? details.providedBookLink : details.publishedPaperLink) ?? "",
    citation: details.citeAs ?? "",
  };
}

// Human-readable list of what changed between two PublicationDetails - shown
// to R&D when an already-APPROVED record is edited and sent back for
// re-verification, so they see exactly what to re-check instead of a blank
// resubmission.
export function summarizeChanges(before: PublicationDetails, after: PublicationDetails): string[] {
  const changes: string[] = [];
  const fieldLabels: Partial<Record<keyof PublicationDetails, string>> = {
    type: "Type of Publication", title: "Title", researchDomain: "Research Domain", sdgGoals: "SDG Mapped",
    journalName: "Journal Name", conferenceName: "Conference Name", organizedBy: "Organized By",
    bookName: "Book Name", isExtensionOfConference: "Extension of Conference",
    providedBookLink: "Book Link", isPublisherInRnDPolicyAnnexure: "Publisher in R&D Annexure",
    publisherName: "Publisher Name", issnNumber: "ISSN Number", isbnNumber: "ISBN Number",
    indexedIn: "Indexed", quartile: "Quartile", impactFactor: "Impact Factor",
    monthYearOfPublication: "Month & Year of Publication", monthYearOfIndex: "Month & Year of Index",
    scopusOrWosLink: "Scopus/WoS Link", publishedPaperLink: "Published Paper Link", doi: "DOI", citeAs: "Citation",
    hasInternationalCollaboration: "International Collaboration", hasIndustryCollaboration: "Industry Collaboration",
  };
  for (const key of Object.keys(fieldLabels) as (keyof PublicationDetails)[]) {
    if (JSON.stringify(before[key] ?? null) !== JSON.stringify(after[key] ?? null)) {
      changes.push(`${fieldLabels[key]} changed`);
    }
  }
  if (before.authors.length !== after.authors.length || JSON.stringify(before.authors) !== JSON.stringify(after.authors)) {
    changes.push(`Authors changed (${before.authors.length} → ${after.authors.length})`);
  }
  return changes;
}
