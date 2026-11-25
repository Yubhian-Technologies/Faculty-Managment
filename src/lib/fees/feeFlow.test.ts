import { describe, expect, it } from "vitest";
import { asFirestore, FakeFirestore } from "@/test-support/fakeFirestore";
import { cancelReceipt, raiseFees, recordCounterPayment, setFunding, withConcession } from "./server";
import type { FeeReceipt, FeeStructure, StudentFeeAccount } from "@/types/fees";

// The fee flow on an in-memory Firestore with real transaction semantics: raise a batch's fees by category (A, Spot
// on the A fee, B), FR / NFR, counter payments (shared receipt series, split by head and bank account, stale or
// excess refused), cancel, a concession, re-raise.

const C = "c1";
const P = (p: string) => `colleges/${C}/${p}`;
const plan = [{ no: 1, label: "First", dueDate: "2026-08-01", percent: 60 }, { no: 2, label: "Second", dueDate: "2026-12-01", percent: 40 }];
const structure = (id: string, category: "A" | "B", tuition: number): FeeStructure => ({
  id, academicYear: "2026-27", courseKey: "cat-btech", courseName: "B.Tech", batch: "2026-2030", category,
  heads: [{ headId: "t", name: "Tuition", amount: tuition, frCovered: category === "A" }, { headId: "s", name: "Special Fee", amount: 5000, frCovered: false }], total: tuition + 5000,
  instalments: plan, lateFine: null, status: "PUBLISHED", rev: 1, createdAt: "", updatedAt: "", updatedByName: "A",
});

function setup() {
  const fake = new FakeFirestore({ latencyMs: 2, seed: 7 });
  fake.seed(`colleges/${C}`, { name: "Test College", code: "TC" });
  fake.seed(P("courses/co1"), { name: "B.Tech", catalogId: "cat-btech" });
  fake.seed(P("courses/co2"), { name: "MBA", catalogId: "cat-mba" });
  fake.seed(P("feeBankAccounts/col"), { name: "College A/c", bank: "SBI", accountNo: "123456789", ifsc: "SBIN0001234", active: true });
  fake.seed(P("feeBankAccounts/spl"), { name: "Special A/c", bank: "SBI", accountNo: "987654321", ifsc: "SBIN0001234", active: true });
  fake.seed(P("feeHeads/t"), { name: "Tuition", code: "TUI", order: 1, active: true, bankAccountId: "col" });
  fake.seed(P("feeHeads/s"), { name: "Special Fee", code: "SPL", order: 2, active: true, bankAccountId: "spl" });
  fake.seed(P("feeSettings/config"), { categoryOf: { DIRECT: "B" } });
  fake.seed(P("feeStructures/sa"), structure("sa", "A", 45000) as unknown as Record<string, unknown>);
  fake.seed(P("feeStructures/sb"), structure("sb", "B", 145000) as unknown as Record<string, unknown>);
  const st = (id: string, roll: string, admissionType: string | undefined, extra: Record<string, unknown> = {}) =>
    fake.seed(P(`students/${id}`), { rollNumber: roll, name: `Student ${roll}`, courseId: "co1", batch: "2026-2030", department: "CSE", section: "A", year: 1, status: "REGULAR", ...(admissionType ? { admissionType } : {}), ...extra });
  st("st1", "26A001", "Convenor", { uid: "u1" });
  st("st2", "26A002", "Management");
  st("st3", "26A003", "Spot Admission");
  st("st4", "26A004", "Direct");
  st("st5", "26A005", undefined);
  st("st6", "26A006", "Convenor", { status: "DISCONTINUED" });
  st("st7", "26A007", "Convenor", { courseId: "co2" });
  return { fake, db: asFirestore(fake) };
}
const account = async (db: FirebaseFirestore.Firestore, id: string) => (await db.doc(P(`studentFees/${id}`)).get()).data() as StudentFeeAccount;
const raise = (db: FirebaseFirestore.Firestore, apply = true) => raiseFees(db, C, { academicYear: "2026-27", courseKey: "cat-btech", batch: "2026-2030", apply, byName: "Acc" });

describe("raising fees", () => {
  it("raises by category: A and Spot on the A fee (NFR), B on the B fee; lists students without a category", async () => {
    const { db } = setup();
    const preview = await raise(db, false);
    expect(preview.map((r) => [r.rollNumber, r.category, r.outcome, r.structureId ?? null, r.studentShare ?? null])).toEqual([
      ["26A001", "A", "NEW", "sa", 50000], ["26A002", "B", "NEW", "sb", 150000], ["26A003", "SPOT", "NEW", "sa", 50000],
      ["26A004", "B", "NEW", "sb", 150000], ["26A005", null, "NO_CATEGORY", null, null],
    ]);
    expect(await account(db, "2026-27__st1")).toBeUndefined();
    await raise(db);
    const a = await account(db, "2026-27__st1");
    expect(a).toMatchObject({ category: "A", funding: "NFR", gross: 50000, govtShare: 0, studentShare: 50000, studentUid: "u1" });
    expect(a.heads.map((h) => [h.name, h.bankAccountName, h.frCovered])).toEqual([["Tuition", "College A/c", true], ["Special Fee", "Special A/c", false]]);
  });
});

describe("FR / NFR and paying", () => {
  async function raised() { const s = setup(); await raise(s.db); return s; }

  it("FR only for Category A; FR cuts the student's share to the uncovered heads; kept when fees are raised again", async () => {
    const { db } = await raised();
    await expect(setFunding(db, C, { accountId: "2026-27__st3", funding: "FR", byName: "SC" })).rejects.toThrow(/can't be FR/);
    await expect(setFunding(db, C, { accountId: "2026-27__st2", funding: "FR", byName: "SC" })).rejects.toThrow(/can't be FR/);
    const { account: fr } = await setFunding(db, C, { accountId: "2026-27__st1", funding: "FR", byName: "SC" });
    expect(fr).toMatchObject({ funding: "FR", govtShare: 45000, studentShare: 5000, balance: 5000 });
    await raise(db);
    expect((await account(db, "2026-27__st1")).funding).toBe("FR");
  });

  it("numbers receipts from the shared series, splits them by bank account, refuses stale / excess payments", async () => {
    const { db } = await raised();
    const pay = (rev: number, amount: number, mode = "CASH", reference = "") => recordCounterPayment(db, C, { accountId: "2026-27__st1", rev, amount, mode, reference, paidOn: "2026-07-20", byName: "Acc" });
    const first = await pay(1, 30000);
    // Instalment 1 = 60%: Tuition 27,000 (College A/c) + Special 3,000 (Special A/c).
    expect(first.receipt.receiptNo).toMatch(/^FR-TC\/\d{2}\/\d{1,2}\/1$/);
    expect(first.receipt.allocation.map((x) => [x.no, x.headName, x.bankAccountName, x.amount])).toEqual([[1, "Tuition", "College A/c", 27000], [1, "Special Fee", "Special A/c", 3000]]);
    await expect(pay(1, 1000)).rejects.toThrow(/changed since you opened it/);
    await expect(pay(2, 20001)).rejects.toThrow(/more than the balance/);
    await expect(pay(2, 100, "UPI")).rejects.toThrow(/reference/);
    const second = await pay(2, 20000, "UPI", "UTR123");
    expect(second.receipt.receiptNo).toMatch(/\/2$/);
    expect(second.account).toMatchObject({ balance: 0, status: "CLEARED" });
  });

  it("an NFR student who already paid becomes FR: the excess shows, never absorbed", async () => {
    const { db } = await raised();
    await recordCounterPayment(db, C, { accountId: "2026-27__st1", rev: 1, amount: 30000, mode: "CASH", reference: "", paidOn: "2026-07-20", byName: "Acc" });
    const { account: fr } = await setFunding(db, C, { accountId: "2026-27__st1", funding: "FR", byName: "SC" });
    expect(fr).toMatchObject({ studentShare: 5000, paid: 30000, balance: -25000, status: "CLEARED" });
  });

  it("takes two payments at once on different students without losing a receipt number", async () => {
    const { db } = await raised();
    const [a, b] = await Promise.all(["st2", "st3"].map((s) => recordCounterPayment(db, C, { accountId: `2026-27__${s}`, rev: 1, amount: 1000, mode: "CASH", reference: "", paidOn: "2026-07-20", byName: "Acc" })));
    expect(new Set([a.receipt.receiptNo, b.receipt.receiptNo]).size).toBe(2);
  });

  it("cancels a receipt; a concession re-splits the dues; a paid account is kept on re-raise", async () => {
    const { db } = await raised();
    const { receipt } = await recordCounterPayment(db, C, { accountId: "2026-27__st2", rev: 1, amount: 10000, mode: "CASH", reference: "", paidOn: "2026-07-20", byName: "Acc" });
    const after = await cancelReceipt(db, C, receipt.id, "Cheque bounced", "Acc");
    expect(after.account).toMatchObject({ paid: 0, balance: 150000 });
    await expect(cancelReceipt(db, C, receipt.id, "again", "Acc")).rejects.toThrow(/already cancelled/);
    expect(((await db.doc(P(`feeReceipts/${receipt.id}`)).get()).data() as FeeReceipt).cancelled?.reason).toBe("Cheque bounced");

    const con = withConcession(after.account, { id: "c1", amount: 10000, headId: "t", headName: "Tuition", reason: "Merit", referralName: "Chairman", requestId: "r1", at: "", byName: "Mgmt" }, "", "Mgmt");
    expect(con).toMatchObject({ concessionTotal: 10000, studentShare: 140000 });
    expect(con.instalments.map((x) => x.amount)).toEqual([84000, 56000]);

    await recordCounterPayment(db, C, { accountId: "2026-27__st1", rev: 1, amount: 1000, mode: "CASH", reference: "", paidOn: "2026-07-20", byName: "Acc" });
    const re = await raise(db);
    expect(re.find((r) => r.rollNumber === "26A001")?.outcome).toBe("KEPT");
    expect(re.find((r) => r.rollNumber === "26A002")?.outcome).toBe("UPDATED");
  });
});

describe("concession requests", () => {
  it("Management approves a lower amount once - applied to the account; reject needs remarks", async () => {
    const { checkNewRequest, decideRequest } = await import("./concessions");
    const { db } = setup();
    await raise(db);
    const checked = await checkNewRequest(db, C, { accountId: "2026-27__st2", amount: 20000, headId: "t", reason: "Sports quota", referralName: "Chairman" });
    expect(checked).toMatchObject({ amount: 20000, head: { name: "Tuition" } });
    await expect(checkNewRequest(db, C, { accountId: "2026-27__st2", amount: 200000, reason: "x", referralName: "y" })).rejects.toThrow(/at most/);
    await expect(checkNewRequest(db, C, { accountId: "2026-27__st2", amount: 100, reason: "x", referralName: "" })).rejects.toThrow(/referral/);
    await db.doc(P("feeConcessionRequests/r1")).set({ id: "r1", collegeId: C, accountId: "2026-27__st2", academicYear: "2026-27", rollNumber: "26A002", name: "S", amount: 20000, headId: "t", headName: "Tuition", reason: "Sports quota", referralName: "Chairman", status: "PENDING", requestedAt: "", requestedByUid: "o1", requestedByName: "Office" });
    await expect(decideRequest(db, C, { requestId: "r1", action: "REJECT", byName: "M" })).rejects.toThrow(/reason for rejecting/);
    await expect(decideRequest(db, C, { requestId: "r1", action: "APPROVE", amount: 25000, byName: "M" })).rejects.toThrow(/at most the Rs. 20000/);
    const { request, account: acc } = await decideRequest(db, C, { requestId: "r1", action: "APPROVE", amount: 15000, byName: "M" });
    expect(request).toMatchObject({ status: "APPROVED", approvedAmount: 15000 });
    expect(acc).toMatchObject({ concessionTotal: 15000, studentShare: 135000 });
    expect(acc?.concessions[0]).toMatchObject({ requestId: "r1", referralName: "Chairman", byName: "M" });
    await expect(decideRequest(db, C, { requestId: "r1", action: "APPROVE", byName: "M" })).rejects.toThrow(/already approved/);
    expect((await account(db, "2026-27__st2")).concessions).toHaveLength(1);
  });
});
