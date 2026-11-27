import { describe, expect, it } from "vitest";
import { checkDebitNote, checkReceipt, importedReceiptId, isoDate, type DebitNoteRow, type ReceiptRow } from "./importPrevious";
import { instalmentStates, recompute } from "./rules";
import { IMPORTED_PLAN } from "./importPrevious";

const dn = (o: Partial<DebitNoteRow>): DebitNoteRow => ({ row: 3, roll: "26BV1A01001", admissionType: "Con", category: "A", payment: "FR", total: "105000", tuition: "0", scholarship: "105000", feeType: "Tuition Fee", voucherNo: "DBJ-VWU/26/8/1", voucherDate: "2026-08-28", ...o });
const rc = (o: Partial<ReceiptRow>): ReceiptRow => ({ row: 3, roll: "26BV1A07105", amount: "5000", paidOn: "14/10/2026", voucherNo: "TFR-VWU/26/10/9", mode: "Online Transfer", bank: "INDIAN BANK-8383896782", reference: "TFSVECW-26/1680", feeType: "Tuition Fee", ...o });

describe("debit notes (VWU's own sheet)", () => {
  it("reads category, FR / NFR and the government's part", () => {
    expect(checkDebitNote(dn({}))).toMatchObject({ ok: true, category: "A", funding: "FR", total: 105000, govt: 105000, student: 0 });
    expect(checkDebitNote(dn({ payment: "NFR", tuition: "105000", scholarship: "0" }))).toMatchObject({ ok: true, funding: "NFR", student: 105000, govt: 0 });
    expect(checkDebitNote(dn({ admissionType: "Spot", payment: "NFR", tuition: "105000", scholarship: "0" }))).toMatchObject({ ok: true, category: "SPOT" });
    expect(checkDebitNote(dn({ admissionType: "Mgt", category: "B", payment: "NFR", total: "210000", tuition: "210000", scholarship: "0" }))).toMatchObject({ ok: true, category: "B", student: 210000 });
  });
  it("refuses what doesn't hold together", () => {
    expect(checkDebitNote(dn({ category: "C" }))).toMatchObject({ ok: false });
    expect(checkDebitNote(dn({ category: "B" }))).toMatchObject({ ok: false, error: expect.stringMatching(/Only a Category A/) });
    expect(checkDebitNote(dn({ tuition: "5000" }))).toMatchObject({ ok: false, error: expect.stringMatching(/add up/) });
    expect(checkDebitNote(dn({ payment: "NFR" }))).toMatchObject({ ok: false });
    expect(checkDebitNote(dn({ total: "0" }))).toMatchObject({ ok: false });
    expect(checkDebitNote(dn({ total: "1050.5" }))).toMatchObject({ ok: false });
  });
  it("an imported fee has no due date, so it is never overdue", () => {
    const heads = [{ headId: "t", name: "Tuition Fee", amount: 105000, frCovered: false, bankAccountId: "b", bankAccountName: "Indian Bank", govt: 0, concession: 0, student: 105000 }];
    const a = { heads, funding: "NFR" as const, concessions: [], paid: 50000, plan: IMPORTED_PLAN };
    const st = instalmentStates({ ...a, ...recompute(a) }, "2027-03-31");
    expect(st).toHaveLength(1);
    expect(st[0]).toMatchObject({ amount: 105000, paid: 50000, due: 55000, overdue: false, dueDate: "" });
  });
});

describe("receipts (VWU's own sheet)", () => {
  it("reads amount, DD/MM/YYYY date and mode", () => {
    expect(checkReceipt(rc({}), "2026-11-27")).toMatchObject({ ok: true, amount: 5000, paidOn: "2026-10-14", mode: "BANK", voucherNo: "TFR-VWU/26/10/9" });
    expect(checkReceipt(rc({ mode: "UPI" }), "2026-11-27")).toMatchObject({ ok: true, mode: "UPI" });
    expect(checkReceipt(rc({ mode: "Cash" }), "2026-11-27")).toMatchObject({ ok: true, mode: "CASH" });
  });
  it("refuses a bad date, a future date, no number or an unknown mode", () => {
    expect(checkReceipt(rc({ paidOn: "31/02/2026" }), "2026-11-27")).toMatchObject({ ok: false });
    expect(checkReceipt(rc({ paidOn: "28/11/2026" }), "2026-11-27")).toMatchObject({ ok: false, error: expect.stringMatching(/future/) });
    expect(checkReceipt(rc({ voucherNo: "" }), "2026-11-27")).toMatchObject({ ok: false });
    expect(checkReceipt(rc({ mode: "Barter" }), "2026-11-27")).toMatchObject({ ok: false });
  });
  it("gives the same id to the same voucher number, so a re-upload skips it", () => {
    expect(importedReceiptId("TFR-VWU/26/10/9")).toBe(importedReceiptId(" tfr-vwu/26/10/9 "));
    expect(importedReceiptId("TFR-VWU/26/10/9")).not.toBe(importedReceiptId("TFR-VWU/26/10/1"));
    expect(isoDate("2026-08-28")).toBe("2026-08-28");
    expect(isoDate("28-08-2026")).toBe("2026-08-28");
  });
});
