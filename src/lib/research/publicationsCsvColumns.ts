// CSV column definitions for R&D's bulk Research Publications import - shaped
// to match the Scopus-style export report R&D already maintains (author
// list, DOI/Scopus links, indexing, bibliometrics, etc.), not just the
// minimal Add Publication form fields, so that report can be uploaded close
// to as-is.
//
// Every column a real Scopus export report carries (Volume, Issue, Article
// No., Page range, Cited By, Impact Factor, SJR, Quartile, Author Position,
// Dept., Faculty/Student, ISBN/ISSN, Author(s) ID, Publication Stage, Open
// Access, EID, Document Type, Journal/Conference/Book Chapter) is recognized
// and stored - see the matching optional fields on ResearchPublication
// (src/types/core.ts). Unlike the Faculty importer, this one does NOT reject
// a file for having extra unrecognized columns, since export reports evolve;
// truly unrecognized ones are simply ignored.

export interface PublicationCsvColumn {
  key: string;
  label: string;
  required: boolean;
  sample: string;
  aliases?: string[];
}

export const IMPORT_COLUMNS: PublicationCsvColumn[] = [
  { key: "ownerName", label: "SVECW-First Author", required: true, sample: "Dr. A. Ravi Kumar", aliases: ["First Author", "Faculty Name", "Author Name", "Owner", "Staff Name"] },
  { key: "title", label: "Title", required: true, sample: "A Deep Feature Fusion Framework for Pneumonia Detection Using Chest X-Ray Images", aliases: ["Publication Title", "Paper Title"] },
  { key: "department", label: "Dept.", required: false, sample: "CSE", aliases: ["Department"] },
  { key: "authorPosition", label: "Author Position", required: false, sample: "First Author", aliases: ["Author Position (First Author / Co-Author / Corresponding Author)", "Position"] },
  { key: "authorFullNames", label: "Author Full Names", required: false, sample: "Kumar, A. Ravi (57209245818); Rao, B. Suresh (60741378100)", aliases: ["Author Names"] },
  { key: "authors", label: "Authors", required: false, sample: "Kumar A.R., Rao B.S.", aliases: ["Co-Authors", "Co-Author"] },
  { key: "authorsId", label: "Author(s) ID", required: false, sample: "57209245818; 60741378100" },
  { key: "sourceTitle", label: "Source Title", required: false, sample: "Scientific Reports", aliases: ["Name of the Journal / Conference", "Journal / Conference", "Journal/Conference", "Journal Name"] },
  { key: "venueType", label: "Journal / Conference / Book Chapter", required: false, sample: "Journal", aliases: ["Publication Type"] },
  { key: "documentType", label: "Document Type", required: false, sample: "Article" },
  { key: "facultyOrStudent", label: "Faculty / Student", required: false, sample: "Faculty" },
  { key: "year", label: "Year", required: true, sample: "2026", aliases: ["Month & Year", "Publication Year"] },
  { key: "indexed", label: "Indexed (Scopus/WoS)", required: false, sample: "Scopus", aliases: ["Indexing", "Source"] },
  { key: "impactFactor", label: "Impact Factor", required: false, sample: "NA" },
  { key: "sjr", label: "SJR", required: false, sample: "" },
  { key: "quartile", label: "Quartile", required: false, sample: "Q1" },
  { key: "isbnIssn", label: "ISBN / ISSN", required: false, sample: "" },
  { key: "volume", label: "Volume", required: false, sample: "21" },
  { key: "issue", label: "Issue", required: false, sample: "7" },
  { key: "articleNo", label: "Art. No.", required: false, sample: "" },
  { key: "pageStart", label: "Page Start", required: false, sample: "245" },
  { key: "pageEnd", label: "Page End", required: false, sample: "255" },
  { key: "citedBy", label: "Cited By", required: false, sample: "0" },
  { key: "publicationStage", label: "Publication Stage", required: false, sample: "Final" },
  { key: "openAccess", label: "Open Access", required: false, sample: "" },
  { key: "eid", label: "EID", required: false, sample: "2-s2.0-105045675949" },
  { key: "doi", label: "DOI", required: false, sample: "10.1038/s41598-026-52615-3", aliases: ["DOI Number"] },
  { key: "paperLink", label: "Paper Link", required: false, sample: "", aliases: ["DOI Link"] },
  { key: "scopusLink", label: "Scopus Link", required: false, sample: "", aliases: ["Link"] },
];

export const IMPORT_HINTS = [
  "SVECW-First Author must match an existing staff login account's name in this college (case/punctuation-insensitive) - the publication is attributed to that person. Rows for people without a login yet are skipped; set up their login first, then re-import that row.",
  "Author Full Names is preferred over Authors for the Co-Authors field when both are present.",
  "Source Title is preferred over an alternately-labeled \"Name of the Journal / Conference\" column when both are present.",
  "DOI is preferred over Paper Link, which is preferred over Scopus Link/Link, for the Publication Link field. A bare DOI (e.g. 10.1038/...) is turned into a full https://doi.org/... link automatically.",
  "Year accepts a plain 4-digit year, or a \"Month & Year\" style column - only the year is kept.",
  "Volume, Issue, Art. No., Page Start/End, Cited By, Impact Factor, SJR, Quartile, Author Position, Dept., Faculty/Student, ISBN/ISSN, Author(s) ID, Publication Stage, Open Access, EID and Document Type are all recognized and stored alongside the core fields - leave any of them blank if your export doesn't have that column.",
];
