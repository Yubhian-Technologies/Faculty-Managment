/**
 * READ-ONLY REPORT. Lists every qualification entry whose stored year equals a given year (default: the current year, 2026),
 * so the HOD / College Office can look at them and confirm each one with the faculty member.
 *
 * Why it exists: the qualification forms used to pre-fill the current year in the Year of Passing / Year of Award boxes, and
 * it was saved with the entry. A stored 2026 may be genuine or may be that old pre-fill - the data cannot say which, so this
 * script does NOT judge, change or delete anything. It only lists, with a few neutral facts to help the review.
 *
 * It never writes to Firestore. It writes one CSV per college into the repo-root backups/ folder (git-ignored: it holds
 * names) and prints a summary.
 *
 * Usage:
 *   node scripts/report-year-values-for-review.mjs                      -> every college, year = current year
 *   node scripts/report-year-values-for-review.mjs --year=2026
 *   node scripts/report-year-values-for-review.mjs --college=<collegeId>
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { init, parseArgs } from "./lib/scriptKit.mjs";

const { opt } = parseArgs();
const year = Number(opt("year") ?? new Date().getFullYear());
const onlyCollege = opt("college");
const { db } = init();
console.log(`READ-ONLY report of stored year values equal to ${year} (nothing is written to the database)\n`);

// slot key -> [section label, which stored key holds the year]
const SLOTS = [
  ["secondaryEducation", "Secondary Education", "yearOfPassing"],
  ["intermediateDiplomaIti", "Intermediate / Diploma / ITI", "yearOfPassing"],
  ["ugDetails", "UG Details", "yearOfPassing"],
  ["additionalUgDetails", "UG Details (additional)", "yearOfPassing"],
  ["pgDetails", "PG Details", "yearOfPassing"],
  ["additionalPgDetails", "PG Details (additional)", "yearOfPassing"],
  ["phdDetails", "Ph.D. Details", "yearOfAward"],
  ["additionalPhdDetails", "Ph.D. Details (additional)", "yearOfAward"],
  ["postdoctoralFellowshipDetails", "Postdoctoral Fellowship Details", "yearOfAward"],
];
const YEAR_LABEL = { yearOfPassing: "Year of Passing", yearOfAward: "Year of Award", yearOfRegistration: "Year of Registration" };
const DETAIL_KEYS = ["course", "branch", "specialization", "institutionName", "place", "percentageCgpa", "hallTicketNumber", "certificateUrl", "board", "status", "mode", "departmentName", "thesisTitle", "nameOfTheGuideSupervisor", "subject", "trade"];
const has = (v) => (typeof v === "string" ? v.trim() !== "" : v != null && !(typeof v === "number" && v === 0));
const csv = (cells) => cells.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",");

const HEADER = ["College", "Where it is stored", "Employee ID", "Name", "Department", "Section", "Year field", "Stored year", "Status", "Degree / Course", "Institution",
  "Only the year is filled in", "Neutral note (not a verdict)"];
const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "backups");
mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");

const colleges = onlyCollege ? [db.collection("colleges").doc(onlyCollege)] : (await db.collection("colleges").get()).docs.map((d) => d.ref);
let grand = 0;
const summary = [];
for (const college of colleges) {
  const collegeName = (await college.get()).data()?.name ?? college.id;
  const rows = [];
  for (const [coll, label] of [["facultyMembers", "Faculty record"], ["users", "Login (HOD / Principal / Vice Principal)"]]) {
    const snap = await college.collection(coll).select("academicProfile", "employeeId", "legalName", "name", "department").get();
    for (const doc of snap.docs) {
      const data = doc.data();
      const ap = data.academicProfile ?? {};
      for (const [slot, sectionLabel, yearKey] of SLOTS) {
        for (const e of [].concat(ap[slot] ?? [])) {
          if (!e || typeof e !== "object" || Number(e[yearKey]) !== year) continue;
          const others = DETAIL_KEYS.filter((k) => has(e[k]));
          const doctoral = yearKey === "yearOfAward";
          const hidden = doctoral && e.status !== "AWARDED";
          const note = hidden
            ? (e.status ? `Status is ${e.status === "PURSUING" ? "Pursuing" : e.status}, so this Year of Award is not shown on the profile` : "No status chosen, so this Year of Award is not shown on the profile")
            : "";
          rows.push([collegeName, label, data.employeeId ?? "", data.legalName ?? data.name ?? "", data.department ?? "", sectionLabel, YEAR_LABEL[yearKey], e[yearKey],
            e.status ?? "", e.course ?? "", e.institutionName ?? "", others.length === 0 ? "Yes" : "No", note]);
        }
      }
    }
  }
  if (!rows.length) continue;
  rows.sort((a, b) => String(a[4]).localeCompare(String(b[4])) || String(a[3]).localeCompare(String(b[3])));
  const file = join(outDir, `year-${year}-review-${collegeName.replace(/[^A-Za-z0-9]+/g, "_")}-${stamp}.csv`);
  writeFileSync(file, "﻿" + [csv(HEADER), ...rows.map(csv)].join("\r\n"));
  grand += rows.length;
  const people = new Set(rows.map((r) => `${r[1]}|${r[2]}|${r[3]}`)).size;
  summary.push({ college: collegeName, entries: rows.length, people, onlyYear: rows.filter((r) => r[11] === "Yes").length, hidden: rows.filter((r) => r[12]).length, file });
}
for (const s of summary) {
  console.log(`${s.college}: ${s.entries} entries across ${s.people} people (${s.onlyYear} have only the year filled in; ${s.hidden} are a Year of Award hidden because the status is not Awarded)\n   ${s.file}`);
}
console.log(`\nTotal: ${grand} stored ${year} year values listed. Nothing was changed.`);
