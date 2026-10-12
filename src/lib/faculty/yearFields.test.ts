import { describe, expect, it, vi } from "vitest";
import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Year boxes (Year of Passing / Year of Award / Year of Registration) never pre-fill the current year, a cleared box removes the
// year (it is never saved as 0), and an "Awarded" entry with no Year of Award shows a reminder without blocking anything.
// Years already stored (including 2026) are untouched.

vi.mock("@/components/shared/CertificateUploadField", () => ({ CertificateUploadField: () => null }));

import { academicProfileFirestoreUpdates, diffAcademicProfile } from "@/lib/faculty/academicProfileChanges";
import { DegreeFields, DegreeFieldsList, EMPTY_DEGREE, QualificationsFields, type DegreeLevel } from "@/components/shared/ProfileFieldPrimitives";
import type { DegreeDetail, StaffQualification } from "@/types";

const d = (v: Record<string, unknown>) => v as unknown as DegreeDetail;
const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);
const form = (level: DegreeLevel, value: DegreeDetail | undefined) => html(createElement(DegreeFields, { label: "x", level, value, onChange: () => {} }));
/** The value attribute of the number box that follows the given label ("" when empty). */
const boxValue = (markup: string, label: string): string | null => {
  const m = markup.match(new RegExp(`${label.replace(/[/()]/g, "\\$&")}</label><input[^>]*?value="([^"]*)"`));
  return m ? m[1] : null;
};

type El = ReactElement<{ children?: ReactNode; label?: string; onChange?: (v: never) => void; onClick?: () => void; renderRow?: (item: unknown, update: (p: unknown) => void) => ReactNode }>;
function find(node: ReactNode, test: (el: El) => boolean): El | null {
  if (Array.isArray(node)) { for (const n of node) { const r = find(n, test); if (r) return r; } return null; }
  if (!isValidElement(node)) return null;
  const el = node as El;
  if (test(el)) return el;
  return find(el.props.children, test);
}
const tree = (level: DegreeLevel, value: DegreeDetail, onChange: (v: DegreeDetail) => void) =>
  (DegreeFields as unknown as (p: unknown) => ReactNode)({ label: "x", level, value, onChange });
const byLabel = (node: ReactNode, label: string) => find(node, (e) => e.props.label === label && typeof e.props.onChange === "function")!;
const text = (n: ReactNode): string => (Array.isArray(n) ? n.map(text).join("") : typeof n === "string" ? n : isValidElement(n) ? text((n as El).props.children) : "");

const base = { institutionName: "Sri Chundi Ranganayakulu Engineering College", place: "Chilakaluripet", percentageCgpa: "68.2", hallTicketNumber: "09901A0307" };

describe("new forms start with empty year boxes", () => {
  it("the blank template has no year at all", () => {
    expect("yearOfPassing" in EMPTY_DEGREE).toBe(false);
    expect("yearOfAward" in EMPTY_DEGREE).toBe(false);
    expect("yearOfRegistration" in EMPTY_DEGREE).toBe(false);
  });
  it.each([["HIGH_SCHOOL", "Year of Passing"], ["INTERMEDIATE", "Year of Passing"], ["UG", "Year of Passing"], ["PG", "Year of Passing"]] as const)(
    "%s: a never-filled entry shows an empty %s box", (level, label) => {
      expect(boxValue(form(level, undefined), label)).toBe("");
      expect(boxValue(form(level, d({ ...base, course: "x" })), label)).toBe("");
    });
  it.each(["DOCTORAL", "POST_DOCTORAL"] as const)("%s: Awarded with no year shows an empty Year of Award box", (level) => {
    expect(boxValue(form(level, d({ ...base, status: "AWARDED" })), "Year of Award")).toBe("");
    expect(boxValue(form(level, undefined), "Year of Registration")).toBe("");
  });
  it('"Add another ..." appends an entry with no year', () => {
    let got: DegreeDetail[] | undefined;
    const list = (DegreeFieldsList as unknown as (p: unknown) => ReactNode)({ label: "UG Details", level: "UG", items: [d({ ...base, yearOfPassing: 2013 })], onChange: (v: DegreeDetail[]) => { got = v; } });
    const add = find(list, (e) => typeof e.props.onClick === "function" && text(e.props.children).startsWith("Add another"))!;
    add.props.onClick!();
    expect(got).toHaveLength(2);
    expect(got![0]).toMatchObject({ yearOfPassing: 2013 }); // the existing entry is kept as it was
    expect("yearOfPassing" in got![1]).toBe(false);
  });
});

describe("a cleared year is removed, never saved as 0", () => {
  it.each([
    ["UG", "Year of Passing", "yearOfPassing", { ...base, course: "BBA", yearOfPassing: 2013 }],
    ["INTERMEDIATE", "Year of Passing", "yearOfPassing", { ...base, course: "Intermediate", yearOfPassing: 2004 }],
    ["DOCTORAL", "Year of Award", "yearOfAward", { ...base, status: "AWARDED", yearOfAward: 2018, yearOfRegistration: 2012 }],
    ["POST_DOCTORAL", "Year of Registration", "yearOfRegistration", { ...base, status: "PURSUING", yearOfRegistration: 2025 }],
  ] as const)("%s: clearing %s removes %s and keeps everything else", (level, label, key, entry) => {
    let got: DegreeDetail | undefined;
    byLabel(tree(level, d(entry), (v) => { got = v; }), label).props.onChange!(0 as never);
    expect(got).toBeTruthy();
    expect(key in got!).toBe(false);
    expect(got).toMatchObject({ institutionName: base.institutionName, place: base.place, hallTicketNumber: base.hallTicketNumber });
  });
  it("typing a year stores it as typed", () => {
    let got: DegreeDetail | undefined;
    byLabel(tree("UG", d({ ...base, course: "BBA" }), (v) => { got = v; }), "Year of Passing").props.onChange!(2014 as never);
    expect(got).toMatchObject({ yearOfPassing: 2014 });
  });
  it("the staff-qualifications list (School colleges) clears the same way", () => {
    let got: unknown;
    const item = { level: "UG", course: "B.Ed", institutionName: "X", yearOfPassing: 2010 } as unknown as StaffQualification;
    const el = (QualificationsFields as unknown as (p: unknown) => ReactNode)({ items: [item], levelOptions: ["UG"], onChange: () => {} });
    const group = find(el, (e) => typeof e.props.renderRow === "function")!;
    const row = group.props.renderRow!(item, (patch) => { got = patch; });
    byLabel(row, "Year of Passing").props.onChange!(0 as never);
    expect(got).toEqual({ yearOfPassing: undefined });
    expect(JSON.stringify({ ...item, ...(got as object) })).not.toContain("yearOfPassing"); // never sent as 0
  });
  it("saving a cleared year stores the entry without it and touches nothing else", () => {
    const before = { ugDetails: d({ ...base, course: "BBA", yearOfPassing: 2013 }), pgDetails: d({ ...base, course: "MBA", yearOfPassing: 2015 }) };
    const { yearOfPassing: _drop, ...cleared } = before.ugDetails as unknown as Record<string, unknown>;
    void _drop;
    const after = { ...before, ugDetails: cleared as unknown as DegreeDetail };
    const changes = diffAcademicProfile(before, after);
    expect(Object.keys(changes.set)).toEqual(["ugDetails"]);
    const upd = academicProfileFirestoreUpdates(before, changes, "DELETE");
    expect("yearOfPassing" in (upd["academicProfile.ugDetails"] as object)).toBe(false);
    expect(upd["academicProfile.ugDetails"]).toMatchObject({ course: "BBA", institutionName: base.institutionName });
    expect(Object.keys(upd)).not.toContain("academicProfile.pgDetails");
  });
});

describe("years already stored are kept - a stored 2026 is never treated as wrong", () => {
  it("shows a stored year and keeps it when another field is edited", () => {
    const entry = d({ ...base, course: "BBA", yearOfPassing: 2026 });
    expect(boxValue(form("UG", entry), "Year of Passing")).toBe("2026");
    let got: DegreeDetail | undefined;
    byLabel(tree("UG", entry, (v) => { got = v; }), "Place").props.onChange!("Guntur" as never);
    expect(got).toMatchObject({ place: "Guntur", yearOfPassing: 2026 });
  });
  it("a stored Ph.D. year of award (2026) is shown and kept", () => {
    const entry = d({ ...base, status: "AWARDED", yearOfAward: 2026 });
    expect(boxValue(form("DOCTORAL", entry), "Year of Award")).toBe("2026");
  });
});

describe("Awarded with no Year of Award: a reminder, never a block", () => {
  const WARN = "Status is Awarded, but the Year of Award is empty";
  it.each(["DOCTORAL", "POST_DOCTORAL"] as const)("%s: shown when Awarded and the year is empty", (level) => {
    const m = form(level, d({ ...base, status: "AWARDED" }));
    expect(m).toContain(WARN);
    expect(m).toContain('role="status"');
  });
  it.each(["DOCTORAL", "POST_DOCTORAL"] as const)("%s: not shown once a year is entered, when Pursuing, or when no status is chosen", (level) => {
    expect(form(level, d({ ...base, status: "AWARDED", yearOfAward: 2018 }))).not.toContain(WARN);
    expect(form(level, d({ ...base, status: "PURSUING" }))).not.toContain(WARN);
    expect(form(level, d({ ...base }))).not.toContain(WARN);
  });
  it("a stored 0 counts as empty (and is not shown in the box)", () => {
    const m = form("DOCTORAL", d({ ...base, status: "AWARDED", yearOfAward: 0 }));
    expect(m).toContain(WARN);
  });
  it("nothing is disabled or required because of it - the form still saves", () => {
    const m = form("DOCTORAL", d({ ...base, status: "AWARDED" }));
    expect(m).not.toMatch(/aria-invalid|required/);
  });
});
