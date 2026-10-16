import { describe, expect, it } from "vitest";
import { normalizeSignatureGroups, parseDesignations, readSignatureGroups, resolveSignatureRows, selectedSignatureRows } from "./signatureAuthority";

describe("signature authority", () => {
  it("splits designations on +", () => {
    expect(parseDesignations(" Timetable In-Charge+ HOD  + Principal ++")).toEqual(["Timetable In-Charge", "HOD", "Principal"]);
  });

  it("normalizes groups and rejects empty groups and repeated designations", () => {
    const ok = normalizeSignatureGroups([{ id: "a", designations: [{ label: "A", selected: true }, { label: " B ", selected: false }] }]);
    expect("groups" in ok && ok.groups[0]).toEqual({
      id: "a",
      name: "Group 1",
      designations: [{ label: "A", selected: true }, { label: "B", selected: false }],
    });
    expect(normalizeSignatureGroups([{ designations: [{ label: " " }] }])).toHaveProperty("error");
    expect(normalizeSignatureGroups([{ designations: [{ label: "A" }, { label: "a" }] }])).toHaveProperty("error");
  });

  it("prints only ticked designations, all in one row, else the default row", () => {
    const rows = selectedSignatureRows([
      { id: "1", name: "G1", designations: [{ label: "A", selected: true }, { label: "HOD", selected: true }, { label: "Z", selected: false }] },
      { id: "2", name: "G2", designations: [{ label: "X", selected: false }, { label: "Y", selected: true }] },
    ]);
    expect(rows).toEqual([["A", "HOD", "Y"]]);
    expect(resolveSignatureRows(rows, "CSE")[0][1]).toMatch(/^HOD-/);
    expect(resolveSignatureRows([], "CSE")[0]).toHaveLength(3);
  });

  it("reads groups saved by the first version", () => {
    const [g] = readSignatureGroups([{ id: "x", text: "A + B", selected: true }]);
    expect(g.designations).toEqual([{ label: "A", selected: true }, { label: "B", selected: true }]);
  });
});

import { buildSectionTimetablePdfHtml } from "./sectionTimetablePdf";

describe("timetable PDF signature row", () => {
  const base = { days: ["MONDAY" as const], periods: [1], periodTimings: [], slots: [], departmentName: "Computer Science" };
  it("prints the chosen rows", () => {
    const html = buildSectionTimetablePdfHtml({ ...base, signatureRows: [["Dean", "HOD", "Director"]] } as never);
    expect(html).toContain("Dean");
    expect(html).toContain("Director");
    expect(html).not.toContain("PRINCIPAL");
  });
  it("falls back to the default row", () => {
    expect(buildSectionTimetablePdfHtml(base as never)).toContain("PRINCIPAL");
  });
});
