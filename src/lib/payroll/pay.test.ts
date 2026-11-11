import { describe, expect, it } from "vitest";
import { cleanRevision, importColumns, planPayImport, withRevision } from "./pay";
import { PayrollRuleError, defaultPayrollSettings } from "./rules";

const settings = defaultPayrollSettings();
const rev = (effectiveFrom: string, eb = 1000) => ({ effectiveFrom, amounts: { EB: eb }, exempt: [], byName: "a", byUid: "u", at: "t" });

describe("pay revisions", () => {
  it("cleans a revision: whole rupees, known parts, only switchable deductions", () => {
    expect(cleanRevision({ effectiveFrom: "2026-11", amounts: { EB: 16550, AGP: 6000, DA: "", HRA: 0 }, exempt: ["PF"] }, settings))
      .toEqual({ effectiveFrom: "2026-11", amounts: { EB: 16550, AGP: 6000 }, exempt: ["PF"] });
    expect(() => cleanRevision({ effectiveFrom: "2026-13", amounts: { EB: 1 } }, settings)).toThrow(PayrollRuleError);
    expect(() => cleanRevision({ effectiveFrom: "2026-11", amounts: { XYZ: 1 } }, settings)).toThrow(/Unknown/);
    expect(() => cleanRevision({ effectiveFrom: "2026-11", amounts: { EB: 10.5 } }, settings)).toThrow(/whole/);
    expect(() => cleanRevision({ effectiveFrom: "2026-11", amounts: {} }, settings)).toThrow(/at least one/);
    expect(() => cleanRevision({ effectiveFrom: "2026-11", amounts: { EB: 1 }, exempt: ["IT"] }, settings)).toThrow(/switched off/);
  });

  it("a revision for the same month replaces the earlier one; kept oldest first", () => {
    const list = withRevision([rev("2026-11"), rev("2026-04")].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom)), rev("2026-11", 2000));
    expect(list.map((r) => [r.effectiveFrom, r.amounts.EB])).toEqual([["2026-04", 1000], ["2026-11", 2000]]);
  });
});

describe("salary sheet import", () => {
  const employees = [
    { employeeKey: "FACULTY_a", employeeCode: "SVECW0679", name: "A" },
    { employeeKey: "STAFF_b", employeeCode: "svecw0601", name: "B" },
    { employeeKey: "FACULTY_c", employeeCode: "X1", name: "C" },
    { employeeKey: "FACULTY_d", employeeCode: "X1", name: "D" },
  ];
  const headers = ["Emp Code", "Name", "E.B", "AGP", "DA", "HRA", "OA", "SA", "PF", "ESI"];
  const row = (n: number, code: string, v: Partial<Record<string, string>>) => ({ row: n, code, values: { "Emp Code": code, ...v } as Record<string, string> });

  it("maps headers by label or code and refuses unknown ones", () => {
    const c = importColumns([...headers, "Bonus"], settings);
    expect([...c.earnings.values()]).toEqual(["EB", "AGP", "DA", "HRA", "OA", "SA"]);
    expect([...c.deductions.values()]).toEqual(["PF", "ESI"]);
    expect(c.unknown).toEqual(["Bonus"]);
  });

  it("matches by Emp Code (any case), reads Y/N, reports new / changed / same and every problem", () => {
    const current = new Map<string, { amounts: Record<string, number>; exempt: string[] } | null>([
      ["FACULTY_a", { amounts: { EB: 16550, AGP: 6000, DA: 2255, HRA: 2255, OA: 540 }, exempt: [] }],
      ["STAFF_b", null],
    ]);
    const plan = planPayImport(headers, [
      row(2, "svecw0679", { "E.B": "16,550", AGP: "6000", DA: "2255", HRA: "2255", OA: "540", PF: "Y" }),
      row(3, "SVECW0601", { "E.B": "7720", DA: "5551", HRA: "965", OA: "12014", PF: "n" }),
      row(4, "SVECW0679", { "E.B": "1" }),
      row(5, "NOPE", { "E.B": "1" }),
      row(6, "X1", { "E.B": "1" }),
      row(7, "", { "E.B": "1" }),
      row(8, "SVECW0601x", {}),
    ], employees, settings, current);
    expect(plan.rows.map((r) => r.status)).toEqual(["SAME", "NEW", "ERROR", "ERROR", "ERROR", "ERROR", "ERROR"]);
    expect(plan.rows[1]).toMatchObject({ employeeKey: "STAFF_b", exempt: ["PF"], grossActual: 26250 });
    expect(plan.rows.slice(2).map((r) => r.error)).toEqual([
      "Emp Code repeated (row 2)", "No faculty or staff member has this Emp Code", "Two people share this Emp Code - fix their records first", "Emp Code is blank",
      "No faculty or staff member has this Emp Code",
    ]);
    expect(plan.errors).toBe(5);
    const changed = planPayImport(headers, [row(2, "SVECW0679", { "E.B": "17000", AGP: "6000" })], employees, settings, current);
    expect(changed.rows[0].status).toBe("CHANGED");
    expect(planPayImport(headers, [row(2, "SVECW0679", { "E.B": "1.5" })], employees, settings, current).rows[0].error).toMatch(/whole rupee/);
    expect(planPayImport(headers, [row(2, "SVECW0679", { "E.B": "1", PF: "maybe" })], employees, settings, current).rows[0].error).toMatch(/Y or N/);
  });
});
