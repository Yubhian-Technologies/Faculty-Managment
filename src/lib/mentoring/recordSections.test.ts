import { describe, expect, it } from "vitest";
import { cleanEntryValues, ENTRY_SECTIONS, entrySection, formatEntryDate, formatEntryMonth } from "./recordSections";

const section = (key: string) => entrySection(key)!;

describe("entry sections", () => {
  it("have unique keys and unique column keys", () => {
    expect(new Set(ENTRY_SECTIONS.map((s) => s.key)).size).toBe(ENTRY_SECTIONS.length);
    for (const s of ENTRY_SECTIONS) expect(new Set(s.columns.map((c) => c.key)).size).toBe(s.columns.length);
  });
  it("only meetings belong to a semester", () => {
    expect(ENTRY_SECTIONS.filter((s) => s.perSemester).map((s) => s.key)).toEqual(["meetings"]);
  });
});

describe("cleanEntryValues", () => {
  it("trims, drops blank cells and keeps checkboxes as booleans", () => {
    const r = cleanEntryValues(section("previousAwards"), { text: "  State merit scholarship ", date: "", docReceived: true });
    expect(r).toEqual({ ok: true, values: { text: "State merit scholarship", docReceived: true } });
  });
  it("requires the required columns", () => {
    expect(cleanEntryValues(section("scholarships"), { name: " ", grant: "10000" })).toEqual({ ok: false, error: "Name of the scholarship is required" });
  });
  it("refuses a field the section does not have", () => {
    const r = cleanEntryValues(section("placements"), { organization: "TCS", salary: "9" });
    expect(r.ok).toBe(false);
  });
  it("checks dates, months and choices", () => {
    expect(cleanEntryValues(section("meetings"), { date: "2025-02-30", categories: ["ACADEMIC"], purpose: "x" }).ok).toBe(false);
    expect(cleanEntryValues(section("meetings"), { date: "2025-02-27", categories: ["ACADEMIC"], purpose: "Attendance shortage" }).ok).toBe(true);
    expect(cleanEntryValues(section("scholarships"), { name: "NSP", monthYear: "2025-13" }).ok).toBe(false);
    expect(cleanEntryValues(section("achievements"), { category: "Sports", responsibility: "x" }).ok).toBe(false);
    expect(cleanEntryValues(section("achievements"), { category: "Extra-curricular", responsibility: "NSS volunteer" }).ok).toBe(true);
  });
  it("takes the meeting's discussion categories as a list of known choices", () => {
    const m = section("meetings");
    const base = { date: "2025-02-27", purpose: "Check-in" };
    expect(cleanEntryValues(m, base)).toEqual({ ok: false, error: "Discussion categories is required" });
    expect(cleanEntryValues(m, { ...base, categories: [] }).ok).toBe(false);
    expect(cleanEntryValues(m, { ...base, categories: ["NOPE"] }).ok).toBe(false);
    const r = cleanEntryValues(m, { ...base, categories: ["GOALS", "ACADEMIC", "GOALS"] });
    expect(r).toEqual({ ok: true, values: { ...base, categories: ["ACADEMIC", "GOALS"] } });
  });
  it("refuses a row with nothing written", () => {
    expect(cleanEntryValues(section("meetings"), { studentSigned: true }).ok).toBe(false);
    expect(cleanEntryValues(section("healthRecord"), null).ok).toBe(false);
  });
  it("caps text length", () => {
    expect(cleanEntryValues(section("placements"), { organization: "x".repeat(201) }).ok).toBe(false);
    expect(cleanEntryValues(section("healthRecord"), { text: "x".repeat(1001) }).ok).toBe(false);
  });
});

describe("formatting", () => {
  it("prints dates and months the way the rest of the app does", () => {
    expect(formatEntryDate("2025-03-07")).toBe("07-03-2025");
    expect(formatEntryMonth("2025-03")).toBe("Mar 2025");
    expect(formatEntryMonth("March")).toBe("March");
  });
});

describe("what a student may add to their own record", () => {
  it("their achievements - never meetings, discipline, follow-ups or referrals", async () => {
    const { STUDENT_ENTRY_SECTIONS } = await import("./recordSections");
    expect([...STUDENT_ENTRY_SECTIONS].sort()).toEqual(["achievements", "competitiveExams", "higherStudies", "internships", "placements", "scholarships"]);
    for (const k of ["meetings", "disciplinary", "followUps", "referrals"]) expect(STUDENT_ENTRY_SECTIONS.has(k)).toBe(false);
  });
  it("a student's form never carries the mentor's 'document received' tick", async () => {
    const { entrySection, studentSectionView } = await import("./recordSections");
    const s = entrySection("previousAwards")!;
    expect(s.columns.some((c) => c.key === "docReceived")).toBe(true);
    expect(studentSectionView(s).columns.some((c) => c.key === "docReceived")).toBe(false);
  });
});

describe("supporting document on a row", () => {
  it("is optional, and only a file uploaded through the app is accepted", async () => {
    const { cleanEntryValues, entrySection } = await import("./recordSections");
    const s = entrySection("scholarships")!;
    expect(cleanEntryValues(s, { name: "Merit" })).toMatchObject({ ok: true });
    const url = `https://firebasestorage.googleapis.com/v0/b/x.appspot.com/o/${encodeURIComponent("mentoring-docs/c1/u1/a.pdf")}?alt=media&token=5f1e2d3c-1111-2222-3333-444455556666`;
    expect(cleanEntryValues(s, { name: "Merit", document: url })).toMatchObject({ ok: true, values: { document: url } });
    expect(cleanEntryValues(s, { name: "Merit", document: "https://evil.example/x.pdf" })).toMatchObject({ ok: false });
  });
});
