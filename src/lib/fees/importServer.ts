import type { Firestore } from "firebase-admin/firestore";
import type { StudentRecord } from "@/types";
import type { FeeCategory, FeeFunding, FeeReceipt, StudentFeeAccount } from "@/types/fees";
import { loadCollegeSettings } from "@/lib/firestore/collegeSettings";
import { currentAcademicStartYear, resolveAcademicYearStart } from "@/lib/college/academicSession";
import { allocationOf, CATEGORY_LABEL, recompute, studentFeeBatch } from "./rules";
import { accountId, courseKeys, FeeError, feeRefs, loadBankAccounts, loadHeads, step, todayIst } from "./server";
import { checkDebitNote, checkReceipt, importedReceiptId, IMPORTED_PLAN, isoDate, normRoll, type DebitNoteRow, type ReceiptRow } from "./importPrevious";

// Server side of Accounts > Fees > Import Previous Fees (rules: lib/fees/importPrevious.ts). Both imports check the
// whole file first (apply false = nothing written) and save only when no row has a problem.

type Db = Firestore;
export const MAX_IMPORT_ROWS = 5000;

async function studentsByRoll(db: Db, c: string) {
  const snap = await feeRefs(db, c).college.collection("students").get();
  const map = new Map<string, (StudentRecord & { id: string })[]>();
  for (const d of snap.docs) {
    const s = { ...(d.data() as StudentRecord), id: d.id };
    const k = normRoll(s.rollNumber ?? "");
    if (!k) continue;
    map.set(k, [...(map.get(k) ?? []), s]);
  }
  return map;
}

export interface DebitNoteResult {
  row: number; roll: string; name: string; outcome: "NEW" | "UPDATED" | "KEPT" | "ERROR"; note?: string;
  category?: FeeCategory; funding?: FeeFunding; total?: number; studentShare?: number; department?: string;
}

/** Each student's fee for the year from the debit notes (one per student). */
export async function importDebitNotes(db: Db, c: string, q: { academicYear: string; rows: DebitNoteRow[]; apply: boolean; byName: string }) {
  const refs = feeRefs(db, c);
  const [students, heads, banks, keys, settings] = await Promise.all([
    studentsByRoll(db, c), loadHeads(db, c), loadBankAccounts(db, c), courseKeys(db, c), loadCollegeSettings(db, c),
  ]);
  const currentStart = currentAcademicStartYear(new Date(), resolveAcademicYearStart(settings));
  const headByName = new Map(heads.filter((h) => h.active).map((h) => [h.name.trim().toLowerCase(), h]));
  const bankOf = new Map(banks.map((b) => [b.id, b]));
  const seen = new Map<string, number>();
  const ids = new Map<number, string>();
  for (const r of q.rows) {
    const list = students.get(normRoll(r.roll));
    if (list?.length === 1) ids.set(r.row, accountId(q.academicYear, list[0].id));
  }
  const existing = new Map<string, StudentFeeAccount>();
  const all = [...new Set(ids.values())];
  for (let i = 0; i < all.length; i += 300) {
    for (const s of await db.getAll(...all.slice(i, i + 300).map((id) => refs.accounts.doc(id)))) if (s.exists) existing.set(s.id, s.data() as StudentFeeAccount);
  }

  const at = new Date().toISOString();
  const results: DebitNoteResult[] = [];
  const writes: StudentFeeAccount[] = [];
  for (const r of q.rows) {
    const roll = normRoll(r.roll);
    const fail = (note: string, name = "") => results.push({ row: r.row, roll, name, outcome: "ERROR", note });
    if (!roll) { fail("Regd. No is blank."); continue; }
    const list = students.get(roll) ?? [];
    if (list.length === 0) { fail("No student with this Regd. No in this college."); continue; }
    if (list.length > 1) { fail("Two students have this Regd. No - fix the student records first."); continue; }
    const s = list[0];
    if (seen.has(roll)) { fail(`Repeated - this student is also on row ${seen.get(roll)}.`, s.name); continue; }
    seen.set(roll, r.row);
    const chk = checkDebitNote(r);
    if (!chk.ok) { fail(chk.error, s.name); continue; }
    // The Fee Type names the fee head; a file without one goes to the college's only active head.
    const head = r.feeType ? headByName.get(r.feeType.trim().toLowerCase()) : headByName.size === 1 ? [...headByName.values()][0] : undefined;
    if (!head) { fail(r.feeType ? `Fee type "${r.feeType}" is not a fee head - add it in Setup > Fee Heads with that name.` : "Fee type is blank - name the fee head in a Fee Type column.", s.name); continue; }
    const course = keys.get(s.courseId ?? "");
    if (!course) { fail("The student has no course on record.", s.name); continue; }
    const id = accountId(q.academicYear, s.id);
    const cur = existing.get(id);
    const base = { row: r.row, roll, name: s.name ?? "", category: chk.category, funding: chk.funding, total: chk.total, studentShare: chk.student, department: s.department ?? "" };
    if (cur && cur.paid > 0) {
      results.push({ ...base, outcome: "KEPT", note: `Already has a fee with Rs. ${cur.paid} paid - left as it is (refund / cancel those first to replace it).` });
      continue;
    }
    const bank = head.bankAccountId ? bankOf.get(head.bankAccountId) : undefined;
    const accHead = { headId: head.id, name: head.name, amount: chk.total, frCovered: chk.funding === "FR", bankAccountId: bank?.id ?? null, bankAccountName: bank?.name ?? "" };
    const totals = recompute({ heads: [{ ...accHead, govt: 0, concession: 0, student: chk.total }], funding: chk.funding, concessions: [], paid: 0, plan: IMPORTED_PLAN });
    const voucherDate = isoDate(r.voucherDate) ?? "";
    writes.push({
      id, academicYear: q.academicYear, studentId: s.id, studentUid: s.uid ?? null, rollNumber: s.rollNumber ?? roll, name: s.name ?? "",
      department: s.department ?? "", section: s.section ?? "", year: s.year ?? null, courseId: s.courseId ?? "", courseKey: course.key, courseName: course.name,
      batch: studentFeeBatch(s, currentStart, course.durationYears), admissionType: String(r.admissionType || s.admissionType || "").trim().toUpperCase(),
      category: chk.category, funding: chk.funding, structureId: "IMPORT", source: "IMPORT",
      importRef: { voucherNo: String(r.voucherNo ?? "").trim().slice(0, 60), voucherDate },
      plan: IMPORTED_PLAN, ...totals, concessions: [], govtReceived: cur?.govtReceived ?? 0, paid: 0,
      rev: (cur?.rev ?? 0) + 1, createdAt: cur?.createdAt ?? at, updatedAt: at, updatedByName: q.byName,
      history: step(cur ?? null, at, q.byName, "FEE_IMPORTED", `${CATEGORY_LABEL[chk.category]} ${chk.funding}: Rs. ${chk.total}${r.voucherNo ? ` (${String(r.voucherNo).trim()})` : ""}`),
    });
    results.push({ ...base, outcome: cur ? "UPDATED" : "NEW" });
  }
  const errors = results.filter((x) => x.outcome === "ERROR").length;
  if (q.apply) {
    if (errors) throw new FeeError(`${errors} rows have a problem - fix them and check again. Nothing was saved.`);
    for (let i = 0; i < writes.length; i += 400) {
      const batch = db.batch();
      for (const w of writes.slice(i, i + 400)) batch.set(refs.accounts.doc(w.id), w);
      await batch.commit();
    }
  }
  return { rows: results, saved: q.apply ? writes.length : 0 };
}

export interface ReceiptResult {
  row: number; roll: string; name: string; receiptNo: string; amount?: number; paidOn?: string;
  outcome: "NEW" | "ALREADY" | "ERROR"; note?: string;
}

/** Payments already made, recorded against the year's fees with their own voucher numbers. */
export async function importReceipts(db: Db, c: string, q: { academicYear: string; rows: ReceiptRow[]; apply: boolean; byName: string }) {
  const refs = feeRefs(db, c);
  const students = await studentsByRoll(db, c);
  const today = todayIst();
  const results: ReceiptResult[] = [];
  const good: { r: ReceiptRow; accId: string; rid: string; amount: number; paidOn: string; mode: FeeReceipt["mode"]; voucherNo: string; res: ReceiptResult }[] = [];
  const seenVoucher = new Map<string, number>();
  for (const r of q.rows) {
    const roll = normRoll(r.roll);
    const res: ReceiptResult = { row: r.row, roll, name: "", receiptNo: String(r.voucherNo ?? "").trim(), outcome: "ERROR" };
    results.push(res);
    const list = students.get(roll) ?? [];
    if (!roll) { res.note = "Regd. No is blank."; continue; }
    if (list.length !== 1) { res.note = list.length ? "Two students have this Regd. No." : "No student with this Regd. No in this college."; continue; }
    res.name = list[0].name ?? "";
    const chk = checkReceipt(r, today);
    if (!chk.ok) { res.note = chk.error; continue; }
    const vk = chk.voucherNo.toUpperCase();
    if (seenVoucher.has(vk)) { res.note = `Receipt number repeated (also on row ${seenVoucher.get(vk)}).`; continue; }
    seenVoucher.set(vk, r.row);
    Object.assign(res, { amount: chk.amount, paidOn: chk.paidOn });
    good.push({ r, accId: accountId(q.academicYear, list[0].id), rid: importedReceiptId(chk.voucherNo), ...chk, res });
  }
  // The fee each receipt goes to, and receipts already imported.
  const accIds = [...new Set(good.map((g) => g.accId))];
  const accounts = new Map<string, StudentFeeAccount>();
  const have = new Set<string>();
  for (let i = 0; i < accIds.length; i += 300) for (const s of await db.getAll(...accIds.slice(i, i + 300).map((id) => refs.accounts.doc(id)))) if (s.exists) accounts.set(s.id, s.data() as StudentFeeAccount);
  for (let i = 0; i < good.length; i += 300) for (const s of await db.getAll(...good.slice(i, i + 300).map((g) => refs.receipts.doc(g.rid)))) if (s.exists) have.add(s.id);
  const paidSoFar = new Map<string, number>();
  for (const g of good) {
    const a = accounts.get(g.accId);
    if (!a) { g.res.note = `No ${q.academicYear} fee for this student yet - import the debit notes first.`; continue; }
    if (have.has(g.rid)) { g.res.outcome = "ALREADY"; g.res.note = "Already imported - skipped."; continue; }
    g.res.outcome = "NEW";
    const p = (paidSoFar.get(g.accId) ?? a.paid) + g.amount;
    paidSoFar.set(g.accId, p);
    if (p > a.studentShare) g.res.note = a.studentShare === 0 ? `${a.funding === "FR" ? "FR student - " : ""}owes nothing; shown as paid extra (to refund or adjust).` : `Paid Rs. ${p - a.studentShare} more than the fee; shown as paid extra.`;
  }
  const errors = results.filter((x) => x.outcome === "ERROR").length;
  let saved = 0;
  if (q.apply) {
    if (errors) throw new FeeError(`${errors} rows have a problem - fix them and check again. Nothing was saved.`);
    // One transaction per student: their receipts in date order, each allocated oldest instalment first.
    const byAcc = new Map<string, typeof good>();
    for (const g of good.filter((x) => x.res.outcome === "NEW")) byAcc.set(g.accId, [...(byAcc.get(g.accId) ?? []), g]);
    for (const [accId, list] of byAcc) {
      list.sort((x, y) => x.paidOn.localeCompare(y.paidOn) || x.voucherNo.localeCompare(y.voucherNo));
      saved += await db.runTransaction(async (tx) => {
        const ref = refs.accounts.doc(accId);
        const snap = await tx.get(ref);
        const rSnaps = await Promise.all(list.map((g) => tx.get(refs.receipts.doc(g.rid))));
        if (!snap.exists) return 0;
        let a = snap.data() as StudentFeeAccount;
        const at = new Date().toISOString();
        let n = 0;
        list.forEach((g, i) => {
          if (rSnaps[i].exists) return;
          const receipt: FeeReceipt = {
            id: g.rid, receiptNo: g.voucherNo, academicYear: a.academicYear, accountId: a.id, studentId: a.studentId, rollNumber: a.rollNumber, name: a.name,
            department: a.department, section: a.section, courseName: a.courseName, amount: g.amount, source: "COUNTER", mode: g.mode,
            reference: String(g.r.reference ?? "").trim().slice(0, 80), ...(g.r.bank ? { bank: String(g.r.bank).trim().slice(0, 80) } : {}),
            paidOn: g.paidOn, allocation: allocationOf(a, g.amount), imported: true, remarks: "Imported from the previous system",
            cancelled: null, createdAt: at, byName: q.byName,
          };
          const paid = a.paid + g.amount;
          a = { ...a, ...recompute({ ...a, paid }), paid, rev: a.rev + 1, updatedAt: at, updatedByName: q.byName, history: step(a, at, q.byName, "PAID", `${g.voucherNo} Rs. ${g.amount} ${g.mode} (imported)`) };
          tx.set(refs.receipts.doc(g.rid), receipt);
          n++;
        });
        if (n) tx.set(ref, a);
        return n;
      });
    }
  }
  return { rows: results, saved };
}
