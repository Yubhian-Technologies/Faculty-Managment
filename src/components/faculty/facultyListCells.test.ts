import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatDurationList, totalYearsOfExperience } from "@/lib/faculty/experienceCalc";
import {
  FacultyDesignationCell,
  FacultyExperienceCell,
  FacultyStatusCell,
  JoiningLine,
  fmtDate,
  joiningLabel,
  type FacultyListRow,
} from "./facultyListCells";

const html = (el: ReactElement) => renderToStaticMarkup(el);
// joiningDate reaches the browser as {_seconds,_nanoseconds} (Admin SDK JSON) - the real shape.
const ts = (iso: string) => ({ _seconds: Math.floor(new Date(iso).getTime() / 1000), _nanoseconds: 0 });
const row = (over: Record<string, unknown> = {}) =>
  ({ id: "f1", employeeId: "VIT0661", legalName: "ADADA TANUJA", designation: "ASSISTANT_PROFESSOR", highestQualification: "M.Tech", status: "ACTIVE", joiningDate: ts("2026-04-02T06:00:00Z"), ...over }) as unknown as FacultyListRow;

describe("fmtDate / joiningLabel", () => {
  it("formats every timestamp shape the app sees, and '-' for nothing", () => {
    expect(fmtDate(ts("2026-04-02T06:00:00Z"))).toBe("02 Apr 2026");
    expect(fmtDate({ seconds: Math.floor(new Date("2025-03-21T06:00:00Z").getTime() / 1000) })).toBe("21 Mar 2025");
    expect(fmtDate({ toDate: () => new Date("2026-07-01T06:00:00Z") })).toBe("01 Jul 2026");
    expect(fmtDate(undefined)).toBe("-");
    expect(fmtDate(null)).toBe("-");
    expect(fmtDate("garbage")).toBe("-");
    expect(fmtDate({ _seconds: NaN })).toBe("-");
  });

  it("an Interview Done faculty has only an expected joining date", () => {
    expect(joiningLabel("INTERVIEW_DONE")).toBe("Expected to join");
    for (const s of ["ACTIVE", "ON_LEAVE", "RESIGNED", "RETIRED", "RETAINERSHIP", undefined]) expect(joiningLabel(s)).toBe("DOJ");
  });
});

describe("JoiningLine", () => {
  it("shows 'DOJ' for a joined faculty and 'Expected to join' for Interview Done", () => {
    expect(html(createElement(JoiningLine, { row: row() }))).toContain("DOJ: 02 Apr 2026");
    expect(html(createElement(JoiningLine, { row: row({ status: "INTERVIEW_DONE" }) }))).toContain("Expected to join: 02 Apr 2026");
  });
  it("shows a dash rather than 'Invalid Date' when there is no joining date", () => {
    const out = html(createElement(JoiningLine, { row: row({ joiningDate: undefined }) }));
    expect(out).toContain("DOJ: -");
    expect(out).not.toMatch(/Invalid|NaN|undefined/);
  });
});

describe("FacultyDesignationCell", () => {
  it("shows designation label, qualification and specialization", () => {
    const out = html(createElement(FacultyDesignationCell, { row: row({ specialization: "VLSI Design" }) }));
    expect(out).toContain("Assistant Professor");
    expect(out).toContain("M.Tech");
    expect(out).toContain("VLSI Design");
  });
  it("shows the Ph.D badge only when the Ph.D is AWARDED (not pursuing, not absent)", () => {
    const withPhd = (status?: string) => html(createElement(FacultyDesignationCell, { row: row({ academicProfile: status ? { phdDetails: { status } } : undefined }) }));
    expect(withPhd("AWARDED")).toContain("Ph.D");
    expect(withPhd("PURSUING")).not.toContain("Ph.D");
    expect(withPhd(undefined)).not.toContain("Ph.D");
  });
  it("omits specialization when empty (394 of 398 live records have none)", () => {
    const out = html(createElement(FacultyDesignationCell, { row: row({ specialization: "" }) }));
    expect(out).not.toContain("italic");
  });
});

describe("FacultyExperienceCell", () => {
  // "today" is fixed so every number below is exact
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-18T06:00:00Z")); });
  afterEach(() => { vi.useRealTimers(); });
  const text = (el: ReactElement) => html(el).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

  it("shows Total, Internal and External, each as years, months and days", () => {
    const out = text(createElement(FacultyExperienceCell, {
      row: row({ joiningDate: ts("2008-08-01T06:00:00Z"), academicProfile: { academicExperience: [{ institutionName: "ABC", fromDate: "2005-08-01", toDate: "2007-08-01" }] } }),
    }));
    // Total is whatever the shared calculation says (it is the profile page's number too); Internal and External are exact here
    const entries = [{ fromDate: "2005-08-01", toDate: "2007-08-01" }];
    expect(out).toContain(`Total: ${formatDurationList(totalYearsOfExperience(entries, new Date("2008-08-01T06:00:00Z")))}`);
    expect(out).toContain("Internal: 18 yrs, 2 mos, 17 days");
    expect(out).toContain("External: 2 yrs");
    expect(out).not.toContain("0 mos");
  });

  it("matches the Experience facts on the faculty profile page (18 yrs 2 mos 17 days for a 1 Aug 2008 joining)", () => {
    expect(text(createElement(FacultyExperienceCell, { row: row({ joiningDate: ts("2008-08-01T06:00:00Z") }) }))).toContain("Internal: 18 yrs, 2 mos, 17 days");
  });

  it("leaves out zero units, uses the singular for 1, and shows 0 where there is nothing", () => {
    expect(text(createElement(FacultyExperienceCell, { row: row({ joiningDate: ts("2025-09-17T06:00:00Z") }) }))).toContain("Internal: 1 yr, 1 mo, 1 day");
    const none = text(createElement(FacultyExperienceCell, { row: row({ joiningDate: ts("2026-10-18T06:00:00Z"), academicProfile: undefined }) }));
    expect(none).toContain("Internal: 0");
    expect(none).toContain("External: 0");
    expect(text(createElement(FacultyExperienceCell, { row: row({ joiningDate: ts("2024-04-18T06:00:00Z") }) }))).toContain("Internal: 2 yrs, 6 mos");
  });

  it("works for a record with no academicProfile at all (353 of 398 live records)", () => {
    const out = text(createElement(FacultyExperienceCell, { row: row({ academicProfile: undefined }) }));
    expect(out).not.toMatch(/NaN|undefined/);
    expect(out).toContain("External: 0");
  });

  it("with no joining date, Internal is 0 and the rest is still shown", () => {
    const out = text(createElement(FacultyExperienceCell, {
      row: row({ joiningDate: undefined, academicProfile: { academicExperience: [{ institutionName: "ABC", fromDate: "2021-01-01", toDate: "2023-01-01" }] } }),
    }));
    expect(out).toContain("Internal: 0");
    expect(out).toContain("External: 2 yrs");
    expect(out).toContain("Total: 2 yrs");
  });

  it("previous experience that overlaps service here is counted once in the total", () => {
    const out = text(createElement(FacultyExperienceCell, {
      row: row({ joiningDate: ts("2020-10-18T06:00:00Z"), academicProfile: { industryExperience: [{ institutionName: "X", fromDate: "2019-10-18", toDate: "2021-10-18" }] } }),
    }));
    expect(out).toContain("Internal: 6 yrs");
    expect(out).toContain("Total: 7 yrs"); // 2019-10-18 .. today, not 6 + 2
  });

  it("is laid out as three labelled lines", () => {
    const out = html(createElement(FacultyExperienceCell, { row: row({ joiningDate: ts("2008-08-01T06:00:00Z") }) }));
    expect(out).toContain('data-testid="experience-cell"');
    expect((out.match(/<dt/g) ?? []).length).toBe(3);
    expect((out.match(/<dd/g) ?? []).length).toBe(3);
  });
});

describe("FacultyStatusCell", () => {
  it("shows the status badge with Ratified (green) under it", () => {
    const out = html(createElement(FacultyStatusCell, { row: row({ ratificationStatus: "Ratified" }) }));
    expect(out).toContain("Active");
    expect(out).toContain("Ratified");
    expect(out).toContain("text-green-600");
  });
  it("shows Not Ratified in amber", () => {
    const out = html(createElement(FacultyStatusCell, { row: row({ ratificationStatus: "Not Ratified" }) }));
    expect(out).toContain("Not Ratified");
    expect(out).toContain("text-amber-600");
  });
  it.each(["Attended", "Not Yet Attended"])("shows %s in amber", (status) => {
    const out = html(createElement(FacultyStatusCell, { row: row({ ratificationStatus: status }) }));
    expect(out).toContain(status);
    expect(out).toContain("text-amber-600");
  });
  it("shows a stray stored value ('Not Applicable' exists on one live record) neutrally, not as pending", () => {
    const out = html(createElement(FacultyStatusCell, { row: row({ ratificationStatus: "Not Applicable" }) }));
    expect(out).toContain("Not Applicable");
    expect(out).toContain("text-muted-foreground");
    expect(out).not.toContain("text-amber-600");
  });
  it("shows nothing under the badge when there is no ratification status", () => {
    const out = html(createElement(FacultyStatusCell, { row: row({ ratificationStatus: undefined }) }));
    expect(out).not.toContain("text-green-600");
    expect(out).not.toContain("text-amber-600");
  });
  it("labels every faculty status", () => {
    for (const [s, label] of [["INTERVIEW_DONE", "Interview Done"], ["ON_LEAVE", "On Leave"], ["RESIGNED", "Resigned"], ["RETIRED", "Retired"], ["RETAINERSHIP", "Retainership"]]) {
      expect(html(createElement(FacultyStatusCell, { row: row({ status: s }) }))).toContain(label);
    }
  });
});
