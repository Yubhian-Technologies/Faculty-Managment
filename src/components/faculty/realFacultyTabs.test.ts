import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { FacultyProfileModuleContent } from "./FacultyProfileModuleContent";
import { PROFILE_MODULES, type ProfileModuleKey } from "@/lib/faculty/profileModules";
import { migrateFacultyDoc } from "@/lib/faculty/fieldRenames";
import { isModuleEmpty } from "@/lib/faculty/moduleEmpty";
import { FacultyExperienceCell } from "./facultyListCells";

// OFFLINE, READ-ONLY. Renders every tab of every real faculty record in a snapshot taken by
// scripts/backup-faculty-records.mjs (VIT + VWU) with the new tab names, and checks that nothing broke and that the
// stored values still show. It never connects to Firestore. Skipped unless a snapshot is named:
//
//   FACULTY_BACKUP_FILE=backups/<snapshot>.json npx vitest run src/components/faculty/realFacultyTabs.test.ts

const FILE = process.env.FACULTY_BACKUP_FILE;
type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

// The snapshot writes Firestore Timestamps as {"$date": ISO}; the screens receive Timestamps.
const revive = (v: unknown): unknown => {
  if (Array.isArray(v)) return v.map(revive);
  if (isObj(v)) {
    if (typeof v.$date === "string") { const d = new Date(v.$date); return { toDate: () => d, seconds: Math.floor(d.getTime() / 1000), nanoseconds: 0 }; }
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, revive(x)]));
  }
  return v;
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
const TABS = Object.keys(PROFILE_MODULES) as ProfileModuleKey[];

describe.skipIf(!FILE)("every tab of every real VIT + VWU faculty record, with the new tab names", () => {
  const load = () => {
    const backup = JSON.parse(readFileSync(FILE as string, "utf8")) as { docs: Record<string, Obj> };
    return Object.entries(backup.docs)
      .filter(([path]) => path.includes("/facultyMembers/"))
      .map(([path, doc]) => ({ path, doc: migrateFacultyDoc(revive(doc) as Obj) }));
  };
  const client = new QueryClient();
  const render = (tab: ProfileModuleKey, doc: Obj) =>
    renderToStaticMarkup(createElement(QueryClientProvider, { client },
      createElement(FacultyProfileModuleContent, {
        moduleKey: tab, faculty: doc as never, teachingAssignments: [], collegeType: "ENGINEERING", hideLegalName: true, showNameAsPerPan: true, ratificationHistory: true,
      })));

  it("has records to render", () => { expect(load().length).toBeGreaterThan(400); });

  it("renders all 8 tabs of every record without an error", () => {
    const failures: string[] = [];
    for (const { path, doc } of load()) {
      for (const tab of TABS) {
        try {
          render(tab, doc);
        } catch (err) {
          failures.push(`${path} ${tab}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }
    expect(failures.slice(0, 10)).toEqual([]);
  }, 300_000);

  it("shows the empty-state message only for a tab that really holds nothing, never over stored data", () => {
    const counts: Record<string, number> = {};
    const wrong: string[] = [];
    // "holds something": any non-blank value, looking inside rows (a row of empty strings is nothing)
    const has = (v: unknown): boolean => {
      if (v === undefined || v === null) return false;
      if (typeof v === "string") return v.trim() !== "";
      if (Array.isArray(v)) return v.some(has);
      if (isObj(v)) return Object.values(v).some(has);
      return true;
    };
    for (const { path, doc } of load()) {
      const ap = isObj(doc.academicProfile) ? doc.academicProfile : {};
      for (const tab of TABS) {
        const html = render(tab, doc);
        const shown = html.includes('data-testid="empty-module-state"');
        if (shown !== isModuleEmpty(tab, doc, { teachingEmpty: tab === "teaching-load" ? html.includes("No teaching load data yet") || shown : false })) {
          if (tab !== "teaching-load") wrong.push(`${path} ${tab}: page and rule disagree`);
        }
        if (shown) counts[tab] = (counts[tab] ?? 0) + 1;
        // a tab shown as empty must not hold any of its stored values
        if (shown && tab === "others" && has(ap.otherInformation)) wrong.push(`${path} others: empty over data`);
        if (shown && tab === "financial" && ["monthlySalary", "grossAnnualCTC", "incrementsAwarded", "fundingConsultancyRevenueGeneration"].some((k) => has(ap[k]))) wrong.push(`${path} financial: empty over data`);
        if (shown && tab === "qualification" && ["ugDetails", "pgDetails", "phdDetails", "secondaryEducation", "intermediateDiplomaIti", "postdoctoralFellowshipDetails", "educationalQualifications", "additionalUgDetails", "additionalPgDetails"].some((k) => has(ap[k]))) wrong.push(`${path} qualification: empty over data`);
        if (shown && tab === "experience" && ["academicExperience", "industryExperience", "researchExperience", "promotionHistory"].some((k) => has(ap[k]))) wrong.push(`${path} experience: empty over data`);
        if (shown && tab === "mentorship" && ["newLabsEstablished", "academicResponsibilities", "fdpsWorkshopsMoocsCertifications", "professionalMemberships", "awardsRecognition"].some((k) => has(ap[k]))) wrong.push(`${path} mentorship: empty over data`);
        if (shown && tab === "personal" && ["fatherName", "motherName", "aadharNo", "panNo", "dateOfBirth", "gender", "bankAccountNumber", "temporaryAddress"].some((k) => has(doc[k]))) wrong.push(`${path} personal: empty over data`);
      }
    }
    console.log("[tabs showing the empty state across the real records]", JSON.stringify(counts));
    expect(wrong.slice(0, 10)).toEqual([]);
  }, 300_000);

  it("the list's Experience cell renders Total / Internal / External for every record, never a broken value or a zero unit", () => {
    const bad: string[] = [];
    let withPrevious = 0;
    for (const { path, doc } of load()) {
      const out = renderToStaticMarkup(createElement(FacultyExperienceCell, { row: doc as never }));
      const text = out.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      const unit = String.raw`\d+ (?:yrs?|mos?|days?)(?:, \d+ (?:yrs?|mos?|days?))*`;
      const m = new RegExp(`^Total: (${unit}) Internal: (-|${unit}) External: (-|${unit})$`).exec(text);
      if (!m) bad.push(`${path}: ${text}`);
      else if (m[3] !== "-") withPrevious++;
      if (/NaN|undefined|Invalid/.test(text)) bad.push(`${path}: bad value -> ${text}`);
      if (/(?<!\d)0 (?:yrs?|mos?)/.test(text)) bad.push(`${path}: a zero unit is shown -> ${text}`);
    }
    console.log("[records with previous (external) experience]", withPrevious);
    expect(bad.slice(0, 10)).toEqual([]);
  }, 300_000);

  it("still shows the stored personal, experience, qualification and other values", () => {
    const missing: string[] = [];
    let checked = 0;
    const needs = (path: string, tab: string, html: string, value: unknown, what: string) => {
      if (typeof value !== "string" || !value.trim()) return;
      checked++;
      if (!html.includes(esc(value.trim()))) missing.push(`${path} ${tab} ${what}`);
    };
    for (const { path, doc } of load()) {
      const personal = render("personal", doc);
      for (const k of ["panNo", "fatherName", "motherName", "bankAccountNumber", "ifscCode", "emergencyContactName", "temporaryAddress"]) needs(path, "personal", personal, doc[k], k);
      const ap = isObj(doc.academicProfile) ? doc.academicProfile : {};
      const experience = render("experience", doc);
      for (const e of Array.isArray(ap.academicExperience) ? ap.academicExperience : []) if (isObj(e)) needs(path, "experience", experience, e.institutionName, "academicExperience.institutionName");
      const qualification = render("qualification", doc);
      for (const k of ["ugDetails", "pgDetails"]) if (isObj(ap[k])) needs(path, "qualification", qualification, (ap[k] as Obj).institutionName, `${k}.institutionName`);
      needs(path, "others", render("others", doc), ap.otherInformation, "otherInformation");
    }
    expect(checked).toBeGreaterThan(500); // the check really looked at real data
    expect(missing.slice(0, 10)).toEqual([]);
  }, 300_000);
});
