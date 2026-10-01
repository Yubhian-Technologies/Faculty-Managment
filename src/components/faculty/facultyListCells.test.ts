import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
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
    for (const s of ["ACTIVE", "ON_LEAVE", "RESIGNED", "RETIRED", "RETAINERSHIP", undefined]) expect(joiningLabel(s)).toBe("Joined");
  });
});

describe("JoiningLine", () => {
  it("shows 'Joined' for a joined faculty and 'Expected to join' for Interview Done", () => {
    expect(html(createElement(JoiningLine, { row: row() }))).toContain("Joined: 02 Apr 2026");
    expect(html(createElement(JoiningLine, { row: row({ status: "INTERVIEW_DONE" }) }))).toContain("Expected to join: 02 Apr 2026");
  });
  it("shows a dash rather than 'Invalid Date' when there is no joining date", () => {
    const out = html(createElement(JoiningLine, { row: row({ joiningDate: undefined }) }));
    expect(out).toContain("Joined: -");
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
  it("shows total, internal and external years computed live", () => {
    const joined = new Date(); joined.setFullYear(joined.getFullYear() - 5);
    const out = html(createElement(FacultyExperienceCell, { row: row({ joiningDate: ts(joined.toISOString()) }) }));
    expect(out).toMatch(/\d+ yrs/);
    expect(out).toContain("Int:");
    expect(out).toContain("Ext:");
  });
  it("works for a record with no academicProfile at all (353 of 398 live records)", () => {
    const out = html(createElement(FacultyExperienceCell, { row: row({ academicProfile: undefined }) }));
    expect(out).not.toMatch(/NaN|undefined/);
    expect(out).toContain("yrs");
  });
  it("hides Int/Ext when there is no joining date", () => {
    const out = html(createElement(FacultyExperienceCell, { row: row({ joiningDate: undefined }) }));
    expect(out).not.toContain("Int:");
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
