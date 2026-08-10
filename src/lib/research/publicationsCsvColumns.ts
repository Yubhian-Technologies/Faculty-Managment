// CSV column definitions for R&D's bulk Research Publications import - shaped
// to match the Scopus-style export report R&D already maintains (author
// list, DOI/Scopus links, indexing, etc.), not just the minimal Add
// Publication form fields, so that report can be uploaded close to as-is.
//
// Only the columns below are recognized and stored. A real Scopus export
// carries several more bibliometric columns (Volume, Issue, Article No.,
// Page range, Cited By, Impact Factor, SJR, Quartile, Author Position,
// Dept., Faculty/Student, ISBN/ISSN, Author(s) ID, Publication Stage, Open
// Access, EID, Document Type) that the Research Publications module doesn't
// track today - unlike the Faculty importer, this one does NOT reject a file
// for having extra unrecognized columns, since that's the normal shape of
// this kind of export; they're simply ignored.

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
  { key: "authorFullNames", label: "Author Full Names", required: false, sample: "Kumar, A. Ravi (57209245818); Rao, B. Suresh (60741378100)", aliases: ["Author Names"] },
  { key: "authors", label: "Authors", required: false, sample: "Kumar A.R., Rao B.S.", aliases: ["Co-Authors", "Co-Author"] },
  { key: "sourceTitle", label: "Source Title", required: false, sample: "Scientific Reports", aliases: ["Name of the Journal / Conference", "Journal / Conference", "Journal/Conference", "Journal Name"] },
  { key: "year", label: "Year", required: true, sample: "2026", aliases: ["Month & Year", "Publication Year"] },
  { key: "indexed", label: "Indexed (Scopus/WoS)", required: false, sample: "Scopus", aliases: ["Indexing", "Source"] },
  { key: "doi", label: "DOI", required: false, sample: "10.1038/s41598-026-52615-3", aliases: ["DOI Number"] },
  { key: "paperLink", label: "Paper Link", required: false, sample: "", aliases: ["DOI Link"] },
  { key: "scopusLink", label: "Scopus Link", required: false, sample: "" },
];

export const IMPORT_HINTS = [
  "SVECW-First Author must match an existing staff login account's name in this college (case/punctuation-insensitive) - the publication is attributed to that person. Rows for people without a login yet are skipped; set up their login first, then re-import that row.",
  "Author Full Names is preferred over Authors for the Co-Authors field when both are present.",
  "Source Title is preferred over an alternately-labeled \"Name of the Journal / Conference\" column when both are present.",
  "DOI is preferred over Paper Link, which is preferred over Scopus Link, for the Publication Link field. A bare DOI (e.g. 10.1038/...) is turned into a full https://doi.org/... link automatically.",
  "Year accepts a plain 4-digit year, or a \"Month & Year\" style column - only the year is kept.",
  "Extra columns from a Scopus export (Volume, Issue, Page range, Cited By, Impact Factor, SJR, Quartile, Author Position, Dept., Faculty/Student, ISBN/ISSN, Author(s) ID, Publication Stage, Open Access, EID, Document Type) are ignored - this module doesn't track them yet.",
];
