import { describe, expect, it } from "vitest";
import {
  academicYearOf, allocationOf, byBankAccount, categoryOfType, cleanStructure, defaultCategory, fundingError, headShares, instalmentStates, lateFineFor,
  inFeeBatch, paymentError, recompute, splitInstalments, spread, structureCategory, studentFeeBatch, yearOfBatch,
} from "./rules";
import type { FeeStructureInstalment, StudentFeeAccount } from "@/types/fees";

const headNames = new Map([["t", "Tuition"], ["s", "Special Fee"], ["b", "Bus Fee"]]);
const plan: FeeStructureInstalment[] = [
  { no: 1, label: "First", dueDate: "2026-08-01", percent: 50 },
  { no: 2, label: "Second", dueDate: "2026-12-01", percent: 30 },
  { no: 3, label: "Third", dueDate: "2027-03-01", percent: 20 },
];
// Category A: Tuition 70,000 (FR covered) -> College A/c; Special 5,000 -> College A/c; Bus 20,000 -> Transport A/c.
const heads = [
  { headId: "t", name: "Tuition", amount: 70000, frCovered: true, bankAccountId: "col", bankAccountName: "College A/c" },
  { headId: "s", name: "Special Fee", amount: 5000, frCovered: false, bankAccountId: "col", bankAccountName: "College A/c" },
  { headId: "b", name: "Bus Fee", amount: 20000, frCovered: false, bankAccountId: "tr", bankAccountName: "Transport A/c" },
];
const acct = (over: Partial<StudentFeeAccount> = {}) => {
  const base = { heads: heads.map((h) => ({ ...h, govt: 0, concession: 0, student: h.amount })), funding: "NFR" as const, concessions: [], paid: 0, plan, lateFine: null, ...over };
  return { ...base, ...recompute(base) };
};

describe("categories", () => {
  it("maps admission types, Spot to the Category A fee, never FR", () => {
    expect(["Convenor", "CONVENER", "Management", "Spot Admission", "spot", "Category-B", "Direct", ""].map((t) => defaultCategory(t))).toEqual(["A", "A", "B", "SPOT", "SPOT", "B", null, null]);
    expect(categoryOfType("Direct", { DIRECT: "B" })).toBe("B");
    expect(structureCategory("SPOT")).toBe("A");
    expect(fundingError("SPOT", "FR")).toMatch(/can't be FR/);
    expect(fundingError("B", "FR")).toMatch(/can't be FR/);
    expect(fundingError("A", "FR")).toBeNull();
  });
});

describe("fee structure", () => {
  const base = { academicYear: "2026-27", courseKey: "k", courseName: "B.Tech", batch: "2026-2030", category: "A", heads: [{ headId: "t", amount: 70000, frCovered: true }, { headId: "s", amount: 5000 }, { headId: "b", amount: 0 }], instalments: plan };
  it("cleans a good structure; FR only on Category A", () => {
    const r = cleanStructure(base, headNames);
    if ("error" in r) throw new Error(r.error);
    expect(r.value).toMatchObject({ category: "A", total: 75000, heads: [{ name: "Tuition", frCovered: true }, { name: "Special Fee", frCovered: false }], lateFine: null });
    const b = cleanStructure({ ...base, category: "B" }, headNames);
    if ("error" in b) throw new Error(b.error);
    expect(b.value.heads.every((h) => !h.frCovered)).toBe(true);
  });
  it("refuses bad ones", () => {
    expect(cleanStructure({ ...base, category: "SPOT" }, headNames)).toEqual({ error: expect.stringContaining("category") });
    expect(cleanStructure({ ...base, batch: "2026" }, headNames)).toEqual({ error: expect.stringContaining("batch") });
    expect(cleanStructure({ ...base, heads: [{ headId: "t", amount: 10.5 }] }, headNames)).toEqual({ error: expect.stringContaining("whole rupees") });
    expect(cleanStructure({ ...base, instalments: [{ ...plan[0], percent: 60 }, plan[1]] }, headNames)).toEqual({ error: expect.stringContaining("90%") });
    expect(cleanStructure({ ...base, instalments: [plan[1], plan[0]] }, headNames)).toEqual({ error: expect.stringContaining("due after") });
  });
  it("works out the academic year", () => {
    expect(academicYearOf("2026-11-25")).toBe("2026-27");
    expect(academicYearOf("2027-06-01")).toBe("2027-28");
  });
});

describe("shares", () => {
  it("spreads exactly", () => {
    expect(spread(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(spread(0, [1, 2])).toEqual([0, 0]);
    expect(spread(10, [0, 5])).toEqual([0, 10]);
  });

  it("FR: the government pays the covered heads, the student the rest", () => {
    const fr = acct({ funding: "FR" });
    expect(fr).toMatchObject({ gross: 95000, govtShare: 70000, studentShare: 25000, balance: 25000 });
    expect(acct()).toMatchObject({ govtShare: 0, studentShare: 95000 });
  });

  it("applies a head concession on its head, a whole-fee one over what the student pays", () => {
    const { heads: h, unused } = headShares(heads, "FR", [{ amount: 1000, headId: "s" }, { amount: 2500, headId: null }]);
    // Head concession 1,000 on Special (5,000 -> 4,000); the whole-fee 2,500 spread over 4,000 + 20,000 -> 417 + 2,083.
    expect(h.map((x) => [x.govt, x.concession, x.student])).toEqual([[70000, 0, 0], [0, 1417, 3583], [0, 2083, 17917]]);
    expect(unused).toBe(0);
    // More than the student pays: the rest is reported unused, never taken off the government's part.
    expect(headShares(heads, "FR", [{ amount: 30000, headId: null }]).unused).toBe(5000);
  });

  it("splits every head over the instalments and adds up exactly", () => {
    const inst = splitInstalments([{ headId: "t", student: 70001 }, { headId: "b", student: 20000 }], plan);
    expect(inst.map((x) => x.byHead)).toEqual([{ t: 35000, b: 10000 }, { t: 21000, b: 6000 }, { t: 14001, b: 4000 }]);
    expect(inst.reduce((n, x) => n + x.amount, 0)).toBe(90001);
  });

  it("FR -> NFR puts the government part back on the student; NFR -> FR after paying shows the excess", () => {
    const paidNfr = acct({ paid: 47500 });
    const toFr = { ...paidNfr, ...recompute({ ...paidNfr, funding: "FR" }) };
    expect(toFr).toMatchObject({ studentShare: 25000, balance: -22500, status: "CLEARED" });
    const back = { ...toFr, ...recompute({ ...toFr, funding: "NFR" }) };
    expect(back).toMatchObject({ studentShare: 95000, balance: 47500, status: "OPEN" });
  });
});

describe("paying", () => {
  it("fills instalments oldest first, head by head, and says which bank account each rupee went to", () => {
    const a = acct({ funding: "FR", paid: 10000, lateFine: { kind: "PER_DAY", amount: 50, graceDays: 10, cap: 1000 } });
    // FR student pays Special 5,000 + Bus 20,000: instalment 1 = 2,500 + 10,000.
    const st = instalmentStates(a, "2026-12-20");
    expect(st.map((x) => [x.amount, x.paid, x.due, x.overdue, x.fine])).toEqual([[12500, 10000, 2500, true, 1000], [7500, 0, 7500, true, 450], [5000, 0, 5000, false, 0]]);
    const alloc = allocationOf(a, 4000);
    expect(alloc.map((x) => [x.no, x.headName, x.bankAccountName, x.amount])).toEqual([[1, "Bus Fee", "Transport A/c", 2500], [2, "Special Fee", "College A/c", 1500]]);
    expect(byBankAccount(alloc)).toEqual([{ account: "Transport A/c", amount: 2500 }, { account: "College A/c", amount: 1500 }]);
  });

  it("charges late fines and checks counter payments", () => {
    expect(lateFineFor({ kind: "FLAT", amount: 500, graceDays: 0 }, "2026-08-01", "2026-08-02")).toBe(500);
    expect(lateFineFor({ kind: "PER_DAY", amount: 20, graceDays: 5, cap: 300 }, "2026-08-01", "2026-09-30")).toBe(300);
    expect(lateFineFor(null, "2026-08-01", "2027-01-01")).toBe(0);
    expect(paymentError(100.5, 1000)).toMatch(/whole/);
    expect(paymentError(1001, 1000)).toMatch(/more than the balance/);
    expect(paymentError(100, 0)).toMatch(/Nothing is due/);
    expect(paymentError(1000, 1000)).toBeNull();
  });
});

describe("fee batch of a student", () => {
  it("uses the stored batch, else works it out from the year of study", () => {
    expect(studentFeeBatch({ batch: "2025-2029", year: 3 }, 2026, 4)).toBe("2025-2029");
    expect(studentFeeBatch({ year: 3 }, 2026, 4)).toBe("2024-2028");
    expect(studentFeeBatch({ year: 1 }, 2026, 2)).toBe("2026-2028");
    expect(studentFeeBatch({}, 2026, 4)).toBe("");
    expect(studentFeeBatch({ year: 3 }, 2026, undefined)).toBe("");
  });
  it("matches the same batch or a lateral entrant's, never another", () => {
    expect(inFeeBatch("2024-2028", "2024-2028")).toBe(true);
    expect(inFeeBatch("2025-2028", "2024-2028")).toBe(true);
    expect(inFeeBatch("2023-2027", "2024-2028")).toBe(false);
    expect(inFeeBatch("2025-2029", "2024-2028")).toBe(false);
    expect(inFeeBatch("", "2024-2028")).toBe(false);
  });
  it("gives the year of study a batch is in", () => {
    expect(yearOfBatch("2024-2028", 2026)).toBe(3);
    expect(yearOfBatch("2024-28", 2026)).toBeNull();
  });
});
