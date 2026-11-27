import { describe, expect, it } from "vitest";
import { recompute } from "./rules";
import { buildFeeDashboard } from "./dashboard";
import type { FeeReceipt, StudentFeeAccount } from "@/types/fees";

// Tuition 70,000 (FR) + Special 5,000 -> College A/c; Bus 20,000 -> Transport A/c. Instalments 50 / 30 / 20 %.
const plan = [
  { no: 1, label: "First", dueDate: "2026-08-01", percent: 50 },
  { no: 2, label: "Second", dueDate: "2026-12-01", percent: 30 },
  { no: 3, label: "Third", dueDate: "2027-03-01", percent: 20 },
];
const heads = [
  { headId: "t", name: "Tuition", amount: 70000, frCovered: true, bankAccountId: "col", bankAccountName: "College A/c" },
  { headId: "s", name: "Special Fee", amount: 5000, frCovered: false, bankAccountId: "col", bankAccountName: "College A/c" },
  { headId: "b", name: "Bus Fee", amount: 20000, frCovered: false, bankAccountId: "tr", bankAccountName: "Transport A/c" },
];
let n = 0;
const acct = (over: Partial<StudentFeeAccount>): StudentFeeAccount => {
  n++;
  const base = { heads: heads.map((h) => ({ ...h, govt: 0, concession: 0, student: h.amount })), funding: "NFR" as const, concessions: [], paid: 0, plan, ...over };
  return {
    id: `a${n}`, academicYear: "2026-27", studentId: `s${n}`, rollNumber: `R${n}`, name: `Student ${n}`, department: "CSE", section: "A",
    courseId: "c", courseKey: "k", courseName: "B.Tech", batch: "2026-2030", admissionType: "CONVENOR", category: "A", structureId: "x",
    govtReceived: 0, rev: 1, createdAt: "", updatedAt: "", updatedByName: "", ...base, ...recompute(base),
  } as StudentFeeAccount;
};
const receipt = (amount: number, paidOn: string, over: Partial<FeeReceipt> = {}): FeeReceipt =>
  ({ id: `r${paidOn}${amount}`, receiptNo: "FR-1", academicYear: "2026-27", accountId: "a1", studentId: "s1", rollNumber: "R1", name: "", department: "", section: "", courseName: "", amount, source: "COUNTER", mode: "CASH", reference: "", paidOn, allocation: [], createdAt: "", byName: "", ...over }) as FeeReceipt;

describe("fee dashboard", () => {
  const nfrPaidFirst = acct({ paid: 47500 });                       // pays instalment 1 exactly
  const nfrNothing = acct({ paid: 0, department: "ECE" });          // owes instalment 1 since 01/08
  const fr = acct({ funding: "FR", paid: 0, govtReceived: 30000 }); // pays only Special + Bus (25,000)
  const spot = acct({ category: "SPOT", paid: 95000 });             // cleared
  const d = buildFeeDashboard({
    accounts: [nfrPaidFirst, nfrNothing, fr, spot],
    receipts: [receipt(47500, "2026-11-27"), receipt(95000, "2026-11-10", { source: "ONLINE", mode: "ONLINE" }), receipt(500, "2026-11-27", { cancelled: { at: "", byName: "", reason: "x" } })],
    payments: [{ status: "SUCCESS", amount: 95000, createdAt: "" }, { status: "FAILED", amount: 10, createdAt: "" }, { status: "SUCCESS", amount: 5, needsRefund: true, createdAt: "" }],
    pendingConcessions: 2, today: "2026-11-27",
  });

  it("adds up raised, payable, collected and balance", () => {
    expect(d.totals.students).toBe(4);
    expect(d.totals.raised).toBe(4 * 95000);
    expect(d.totals.payable).toBe(95000 * 3 + 25000);
    expect(d.totals.collected).toBe(47500 + 95000);
    expect(d.totals.balance).toBe(47500 + 95000 + 25000);
    expect(d.totals.govtShare).toBe(70000);
    expect(d.totals.govtReceived).toBe(30000);
    expect(d.totals.cleared).toBe(1);
    expect(d.totals.notStarted).toBe(2);
  });

  it("finds what is overdue and how old it is", () => {
    expect(d.totals.overdueStudents).toBe(2);
    expect(d.totals.overdue).toBe(47500 + 12500);
    expect(d.ageing.find((a) => a.key === "90+")).toMatchObject({ students: 2, amount: 60000 });
    expect(d.defaulters.map((x) => x.rollNumber)).toEqual([nfrNothing.rollNumber, fr.rollNumber]);
    expect(d.defaulters[0].days).toBe(118);
  });

  it("splits by bank account and head from what was paid against each head", () => {
    const col = d.byBank.find((b) => b.key === "col")!, tr = d.byBank.find((b) => b.key === "tr")!;
    expect(col.payable + tr.payable).toBe(d.totals.payable);
    expect(col.collected + tr.collected).toBe(d.totals.collected);
    expect(d.byHead.find((h) => h.key === "t")!.payable).toBe(70000 * 3);
  });

  it("groups by category, class, department and instalment", () => {
    expect(d.byCategory.map((c) => [c.key, c.students])).toEqual([["A-FR", 1], ["A-NFR", 2], ["SPOT", 1]]);
    expect(d.byCategory[0]).toMatchObject({ govtShare: 70000, govtReceived: 30000, payable: 25000 });
    expect(d.byClass).toHaveLength(1);
    expect(d.byDepartment.map((x) => x.key).sort()).toEqual(["CSE", "ECE"]);
    expect(d.instalments[0]).toMatchObject({ no: 1, dueDate: "2026-08-01", overdueStudents: 2 });
    expect(d.instalments.reduce((s, i) => s + i.payable, 0)).toBe(d.totals.payable);
  });

  it("counts money in by date, source and mode, leaving out cancelled receipts", () => {
    expect(d.collections.today).toEqual({ amount: 47500, count: 1 });
    expect(d.collections.month.amount).toBe(142500);
    expect(d.collections.bySource).toEqual({ COUNTER: 47500, ONLINE: 95000 });
    expect(d.collections.cancelled).toEqual({ amount: 500, count: 1 });
    expect(d.collections.daily).toHaveLength(30);
    expect(d.collections.daily.at(-1)).toEqual({ date: "2026-11-27", amount: 47500, count: 1 });
  });

  it("summarises online payments", () => {
    expect(d.online).toMatchObject({ success: 2, failed: 1, needsRefund: 1 });
    expect(d.pendingConcessions).toBe(2);
  });
  it("counts only students who still owe as yet to clear, and splits each category by who has paid", () => {
    expect(d.totals.yetToClear).toBe(3);                     // NFR part-paid, NFR nothing, FR (owes Special + Bus); Spot cleared
    const nfr = d.byCategory.find((c) => c.key === "A-NFR")!;
    expect(nfr).toMatchObject({ label: "CAT-A (NFR)", full: 0, part: 1, none: 1 });
    expect(d.byCategory.find((c) => c.key === "SPOT")).toMatchObject({ label: "CAT-A (SPOT)", full: 1 });
    expect(nfr.ageing.find((a) => a.key === "90+")).toMatchObject({ students: 1, amount: 47500 });
  });

  it("builds branch x category cells and the balance list", () => {
    const cse = d.byBranch.find((b) => b.key === "CSE")!, ece = d.byBranch.find((b) => b.key === "ECE")!;
    expect(cse.cats["A-FR"]).toMatchObject({ students: 1, govt: 70000 });
    expect(ece.cats["A-NFR"]).toMatchObject({ students: 1, collected: 0, balance: 95000 });
    expect(cse.total.collected + ece.total.collected).toBe(d.totals.collected);
    expect(d.balances.map((b) => [b.rollNumber, b.balance])).toEqual([[nfrNothing.rollNumber, 95000], [fr.rollNumber, 25000], [nfrPaidFirst.rollNumber, 47500]].sort((a, b) => (b[1] as number) - (a[1] as number)));
    expect(d.balances.find((b) => b.rollNumber === nfrPaidFirst.rollNumber)?.lastPaid).toBe("2026-11-27");
  });
});
