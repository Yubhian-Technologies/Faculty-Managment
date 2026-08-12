// CSV column definitions for R&D's bulk Research Publications import - shaped
// to match the exact report layout R&D already maintains and shares (Sl.
// No / Publication Details / Month & Year / SVECW-First Author / Dept. /
// Author Position / Indexed / Journal-Conference-Book Chapter / Faculty-
// Student / Impact Factor / SJR / Quartile / Name of the Journal or
// Conference / ISBN-ISSN / Scopus Link / Paper Link), so that report can be
// uploaded close to as-is instead of being retyped into a different shape.
//
// "Publication Details" is the one free-text column that carries the full
// citation - authors, "Title", journal, volume/issue/pages, year, doi - all
// in one block, exactly as it's typically copied from Scopus/Google
// Scholar. The importer pulls the Title (the quoted portion) and the
// author list (everything before it) out of that text automatically - see
// buildCitationParts in api/college/publications/import/route.ts - rather
// than asking for them as separate columns.
//
// Unlike the Faculty importer, this one does NOT reject a file for having
// extra unrecognized columns, since export reports evolve; unrecognized
// ones are simply ignored.

export interface PublicationCsvColumn {
  key: string;
  label: string;
  required: boolean;
  sample: string;
  aliases?: string[];
}

export const IMPORT_COLUMNS: PublicationCsvColumn[] = [
  { key: "sno", label: "Sl. No", required: false, sample: "1" },
  {
    key: "citation",
    label: "Publication Details",
    required: true,
    sample: 'Bharathi D.V.N., Kandula B.S., Manikanta G., Babu J., Tata S., et al., "DESIGN AND EVALUATION OF AN ITERATIVE APPROXIMATE FLOATING-POINT MULTIPLIER FOR IMAGE PROCESSING", Journal of Mechanics of Continua and Mathematical Sciences, vol. 21, no. 7, pp. 245-255, 2026, doi: https://doi.org/10.26782/jmcms.2026.07.00015.',
    aliases: ["Publication Details", "Citation"],
  },
  { key: "year", label: "Month & Year", required: true, sample: "2026", aliases: ["Year", "Publication Year"] },
  { key: "ownerName", label: "SVECW-First Author", required: true, sample: "Dr. A. Ravi Kumar", aliases: ["First Author", "Faculty Name", "Author Name", "Owner", "Staff Name"] },
  { key: "department", label: "Dept.", required: false, sample: "CSE", aliases: ["Department"] },
  { key: "authorPosition", label: "Author Position (First Author / Co-Author / Corresponding Author)", required: false, sample: "First Author", aliases: ["Author Position", "Position"] },
  { key: "indexed", label: "Indexed (Scopus/WoS)", required: false, sample: "Scopus", aliases: ["Indexing", "Source", "Indexed"] },
  { key: "venueType", label: "Journal / Conference / Book Chapter", required: false, sample: "Journal", aliases: ["Publication Type"] },
  { key: "facultyOrStudent", label: "Faculty / Student", required: false, sample: "Faculty" },
  { key: "impactFactor", label: "Impact Factor", required: false, sample: "NA" },
  { key: "sjr", label: "SJR", required: false, sample: "" },
  { key: "quartile", label: "Quartile", required: false, sample: "" },
  { key: "sourceTitle", label: "Name of the Journal / Conference", required: true, sample: "Journal of Mechanics of Continua and Mathematical Sciences", aliases: ["Journal / Conference", "Journal/Conference", "Journal Name", "Source Title"] },
  { key: "isbnIssn", label: "ISBN / ISSN", required: false, sample: "" },
  { key: "scopusLink", label: "Scopus Link", required: false, sample: "https://www.scopus.com/pages/publications/105045675949?origin=resultslist", aliases: ["Link"] },
  { key: "paperLink", label: "Paper Link", required: false, sample: "https://doi.org/10.26782/jmcms.2026.07.00015", aliases: ["DOI Link", "DOI"] },
];

export const IMPORT_HINTS = [
  "Publication Details is the full citation, typed or pasted as one block - Authors, \"Title\" in quotes, Journal, volume/issue/pages, year, doi. The Title (whatever is inside the quotes) and the author list (everything before it) are pulled out of this automatically.",
  "SVECW-First Author must match an existing staff login account's name in this college (case/punctuation-insensitive) - the publication is attributed to that person. Rows for people without a login yet are skipped; set up their login first, then re-import that row.",
  "Month & Year accepts a plain 4-digit year, or a full \"Month & Year\" style value - only the year is kept.",
  "Scopus Link and Paper Link are both optional and independent - Paper Link is preferred as the record's main link when both are present. A bare DOI (e.g. 10.1038/...) in Paper Link is turned into a full https://doi.org/... link automatically.",
  "Dept., Author Position, Indexed, Journal / Conference / Book Chapter, Faculty / Student, Impact Factor, SJR, Quartile and ISBN / ISSN are all optional - leave any of them blank if you don't have that detail yet.",
];
