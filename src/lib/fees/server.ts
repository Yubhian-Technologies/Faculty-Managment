import type { Firestore, Transaction } from "firebase-admin/firestore";
import type { Course, StudentRecord } from "@/types";
import type { FeeBankAccount, FeeCategory, FeeConcession, FeeFunding, FeeHead, FeePaymentMode, FeeReceipt, FeeSettings, FeeStructure, StudentFeeAccount } from "@/types/fees";
import { PaymentError } from "@/lib/payments/server";
import { receiptNumber } from "@/lib/payments/settle";
import { loadCollegeSettings } from "@/lib/firestore/collegeSettings";
import { currentAcademicStartYear, resolveAcademicYearStart } from "@/lib/college/academicSession";
import { allocationOf, canBeFr, categoryOfType, CATEGORY_LABEL, DATE_RE, fundingError, inFeeBatch, normType, paymentError, recompute, structureCategory, studentFeeBatch, yearOfBatch } from "./rules";

// Server side of student fees (types/fees.ts): where things live, raising a class's fees from its structures (by
// fee category), and the money steps - counter payment, cancel, FR / NFR change, concession from an approved
// request - each one transaction on the student's account.

type Db = Firestore;
export const feeRefs = (db: Db, c: string) => {
  const college = db.collection("colleges").doc(c);
  return {
    college,
    bankAccounts: college.collection("feeBankAccounts"),
    heads: college.collection("feeHeads"),
    settings: college.collection("feeSettings").doc("config"),
    structures: college.collection("feeStructures"),
    accounts: college.collection("studentFees"),
    receipts: college.collection("feeReceipts"),
    concessionRequests: college.collection("feeConcessionRequests"),
    govtCredits: college.collection("feeGovtCredits"),
  };
};
export const accountId = (academicYear: string, studentId: string) => `${academicYear}__${studentId}`;
export const FeeError = PaymentError;
export const todayIst = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());

export const step = (a: Pick<StudentFeeAccount, "history"> | null, at: string, byName: string, action: string, detail?: string) =>
  [...(a?.history ?? []), { at, byName, action, ...(detail ? { detail } : {}) }].slice(-50);

/** The course key of each course doc (catalog id, else "name:<lower name>") - as the course groups use. */
export async function courseKeys(db: Db, c: string): Promise<Map<string, { key: string; name: string; durationYears?: number }>> {
  const snap = await feeRefs(db, c).college.collection("courses").get();
  return new Map(snap.docs.map((d) => {
    const v = d.data() as Course;
    return [d.id, { key: v.catalogId || `name:${String(v.name ?? "").trim().toLowerCase()}`, name: v.name ?? "", durationYears: Number(v.durationYears) || undefined }];
  }));
}

export async function loadHeads(db: Db, c: string): Promise<FeeHead[]> {
  return (await feeRefs(db, c).heads.get()).docs.map((d) => ({ ...(d.data() as FeeHead), id: d.id })).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}
export async function loadBankAccounts(db: Db, c: string): Promise<FeeBankAccount[]> {
  return (await feeRefs(db, c).bankAccounts.get()).docs.map((d) => ({ ...(d.data() as FeeBankAccount), id: d.id })).sort((a, b) => a.name.localeCompare(b.name));
}
export async function loadSettings(db: Db, c: string): Promise<FeeSettings> {
  const d = (await feeRefs(db, c).settings.get()).data() as FeeSettings | undefined;
  return { categoryOf: d?.categoryOf ?? {}, ...(d?.updatedAt ? { updatedAt: d.updatedAt, updatedByName: d.updatedByName } : {}) };
}
export const maskAccountNo = (n: string) => (n.length > 4 ? `XXXX${n.slice(-4)}` : n);

/** The next fee receipt number - the same running series as online payments (paymentSettings/receiptCounter). Reads
 *  inside the transaction; call `commit` after every other read. */
export async function reserveReceiptNo(tx: Transaction, db: Db, c: string) {
  const counterRef = feeRefs(db, c).college.collection("paymentSettings").doc("receiptCounter");
  const [counterSnap, collegeSnap] = await Promise.all([tx.get(counterRef), tx.get(feeRefs(db, c).college)]);
  const seq = Number((counterSnap.data() as { next?: number } | undefined)?.next ?? 1);
  const code = String((collegeSnap.data() as { code?: string } | undefined)?.code ?? "").trim().toUpperCase().replace(/[^A-Z0-9]+/g, "") || "FMS";
  return { receiptNo: receiptNumber(code, new Date(), seq), commit: () => tx.set(counterRef, { next: seq + 1, updatedAt: new Date().toISOString() }, { merge: true }) };
}

export interface RaiseRow {
  studentId: string; rollNumber: string; name: string; section: string; admissionType: string; category: FeeCategory | null; funding?: FeeFunding;
  outcome: "NEW" | "UPDATED" | "KEPT" | "NO_STRUCTURE" | "NO_CATEGORY"; structureId?: string; total?: number; studentShare?: number; note?: string;
}

/**
 * Raises (or re-raises) the academic year's fee for every current student of a course + batch from the published
 * structure of their category (SPOT takes Category A's). Category A accounts keep their FR / NFR (new ones start
 * NFR until the Scholarship Cell marks FR); SPOT and B are always NFR. An account with payments is never changed
 * (KEPT); one without takes the structure's current fee, keeping its concessions. apply false = preview only.
 */
export async function raiseFees(db: Db, c: string, q: { academicYear: string; courseKey: string; batch: string; apply: boolean; byName: string; rollNumber?: string }): Promise<RaiseRow[]> {
  const refs = feeRefs(db, c);
  // Students are found by the batch stored on them AND by the year of study that batch is in now - most records
  // (VIT) carry no batch, only `year`; studentFeeBatch decides which batch each one is really in.
  const currentStart = currentAcademicStartYear(new Date(), resolveAcademicYearStart(await loadCollegeSettings(db, c)));
  const year = yearOfBatch(q.batch, currentStart);
  const studentsCol = refs.college.collection("students");
  const [structSnap, keys, byBatch, byYear, settings, heads, banks] = await Promise.all([
    refs.structures.where("academicYear", "==", q.academicYear).where("courseKey", "==", q.courseKey).where("batch", "==", q.batch).get(),
    courseKeys(db, c),
    studentsCol.where("batch", "==", q.batch).get(),
    year != null && year >= 1 && year <= 10 ? studentsCol.where("year", "==", year).get().then((s) => s.docs) : Promise.resolve([]),
    loadSettings(db, c), loadHeads(db, c), loadBankAccounts(db, c),
  ]);
  const structures = structSnap.docs.map((d) => ({ ...(d.data() as FeeStructure), id: d.id })).filter((s) => s.status === "PUBLISHED");
  const headOf = new Map(heads.map((h) => [h.id, h]));
  const bankOf = new Map(banks.map((b) => [b.id, b]));
  const found = new Map([...byBatch.docs, ...byYear].map((d) => [d.id, { ...(d.data() as StudentRecord), id: d.id }]));
  const students = [...found.values()]
    .filter((s) => {
      const course = keys.get(s.courseId ?? "");
      return course?.key === q.courseKey && inFeeBatch(studentFeeBatch(s, currentStart, course.durationYears), q.batch);
    })
    .filter((s) => s.status === "REGULAR" || s.status === "DETAINED" || !s.status)
    // One student only (a late admission, or a test): their Regd. No, still inside the course + batch picked.
    .filter((s) => !q.rollNumber || String(s.rollNumber ?? "").trim().toUpperCase() === q.rollNumber)
    .sort((a, b) => (a.rollNumber ?? "").localeCompare(b.rollNumber ?? ""));
  const existing = new Map<string, StudentFeeAccount>();
  for (let i = 0; i < students.length; i += 300) {
    const snaps = await db.getAll(...students.slice(i, i + 300).map((s) => refs.accounts.doc(accountId(q.academicYear, s.id))));
    for (const s of snaps) if (s.exists) existing.set(s.id, s.data() as StudentFeeAccount);
  }
  const at = new Date().toISOString();
  const rows: RaiseRow[] = [];
  const writes: StudentFeeAccount[] = [];
  for (const s of students) {
    const type = normType(s.admissionType);
    const category = categoryOfType(type, settings.categoryOf);
    const base = { studentId: s.id, rollNumber: s.rollNumber ?? "", name: s.name ?? "", section: s.section ?? "", admissionType: type, category };
    if (!category) { rows.push({ ...base, outcome: "NO_CATEGORY", note: type ? `"${type}" is not mapped to a category (Setup)` : "No admission type on record" }); continue; }
    const st = structures.find((x) => x.category === structureCategory(category));
    if (!st) { rows.push({ ...base, outcome: "NO_STRUCTURE", note: `No published ${CATEGORY_LABEL[structureCategory(category)]} fee for this batch` }); continue; }
    const id = accountId(q.academicYear, s.id);
    const cur = existing.get(id);
    if (cur?.source === "IMPORT") { rows.push({ ...base, outcome: "KEPT", funding: cur.funding, structureId: cur.structureId, total: cur.gross, studentShare: cur.studentShare, note: "Imported from the previous system - fee left as it is" }); continue; }
    if (cur && cur.paid > 0) { rows.push({ ...base, outcome: "KEPT", funding: cur.funding, structureId: cur.structureId, total: cur.gross, studentShare: cur.studentShare, note: "Has payments - fee left as it is" }); continue; }
    const funding: FeeFunding = canBeFr(category) && cur?.funding === "FR" ? "FR" : "NFR";
    const accHeads = st.heads.map((h) => {
      const bankId = headOf.get(h.headId)?.bankAccountId ?? null;
      const bank = bankId ? bankOf.get(bankId) : undefined;
      return { headId: h.headId, name: h.name, amount: h.amount, frCovered: h.frCovered, bankAccountId: bank ? bank.id : null, bankAccountName: bank?.name ?? "" };
    });
    const concessions = cur?.concessions ?? [];
    const totals = recompute({ heads: accHeads.map((h) => ({ ...h, govt: 0, concession: 0, student: h.amount })), funding, concessions, paid: 0, plan: st.instalments });
    const data: StudentFeeAccount = {
      id, academicYear: q.academicYear, studentId: s.id, studentUid: s.uid ?? null, rollNumber: s.rollNumber ?? "", name: s.name ?? "",
      department: s.department ?? "", section: s.section ?? "", year: s.year ?? null, courseId: s.courseId ?? "", courseKey: q.courseKey,
      courseName: keys.get(s.courseId ?? "")?.name ?? st.courseName, batch: q.batch, admissionType: type, category, funding,
      ...(cur?.fundingNote ? { fundingNote: cur.fundingNote } : {}), structureId: st.id, plan: st.instalments,
      ...totals, concessions, govtReceived: cur?.govtReceived ?? 0, paid: 0,
      rev: (cur?.rev ?? 0) + 1, createdAt: cur?.createdAt ?? at, updatedAt: at, updatedByName: q.byName,
      history: step(cur ?? null, at, q.byName, cur ? "FEE_UPDATED" : "FEE_RAISED", `${CATEGORY_LABEL[category]} ${funding}: Rs. ${totals.gross}`),
    };
    rows.push({ ...base, outcome: cur ? "UPDATED" : "NEW", funding, structureId: st.id, total: data.gross, studentShare: data.studentShare });
    writes.push(data);
  }
  if (q.apply) {
    for (let i = 0; i < writes.length; i += 400) {
      const batch = db.batch();
      for (const w of writes.slice(i, i + 400)) batch.set(refs.accounts.doc(w.id), w);
      await batch.commit();
    }
  }
  return rows;
}

const MODES: FeePaymentMode[] = ["CASH", "DD", "UPI", "BANK", "CHEQUE"];

/** A payment taken at the counter: checked against the balance, allocated oldest first by head, receipt numbered. */
export async function recordCounterPayment(db: Db, c: string, input: { accountId: string; rev: unknown; amount: unknown; mode: unknown; reference: unknown; bank?: unknown; paidOn: unknown; remarks?: unknown; byName: string }) {
  const refs = feeRefs(db, c);
  const amount = Number(input.amount);
  const mode = input.mode as FeePaymentMode;
  const reference = String(input.reference ?? "").trim().slice(0, 80);
  const bank = String(input.bank ?? "").trim().slice(0, 80);
  const paidOn = String(input.paidOn ?? "");
  if (!MODES.includes(mode)) throw new FeeError("Choose how it was paid.");
  if (mode !== "CASH" && !reference) throw new FeeError("Enter the reference (UTR, DD or cheque number).");
  if (!DATE_RE.test(paidOn)) throw new FeeError("Enter the date it was paid.");
  if (paidOn > todayIst()) throw new FeeError("The date paid can't be in the future.");
  return db.runTransaction(async (tx) => {
    const ref = refs.accounts.doc(input.accountId);
    const snap = await tx.get(ref);
    if (!snap.exists) throw new FeeError("Fee account not found. It may have been deleted.", 404);
    const a = snap.data() as StudentFeeAccount;
    if (Number(input.rev) !== a.rev) throw new FeeError("This account changed since you opened it. Reload and try again.", 409);
    const bad = paymentError(amount, a.balance);
    if (bad) throw new FeeError(bad);
    const no = await reserveReceiptNo(tx, db, c);
    const at = new Date().toISOString();
    const rRef = refs.receipts.doc();
    const receipt: FeeReceipt = {
      id: rRef.id, receiptNo: no.receiptNo, academicYear: a.academicYear, accountId: a.id, studentId: a.studentId, rollNumber: a.rollNumber, name: a.name,
      department: a.department, section: a.section, courseName: a.courseName, amount, source: "COUNTER", mode, reference, ...(bank ? { bank } : {}), paidOn,
      allocation: allocationOf(a, amount), ...(input.remarks ? { remarks: String(input.remarks).trim().slice(0, 200) } : {}),
      cancelled: null, createdAt: at, byName: input.byName,
    };
    const paid = a.paid + amount;
    const next: StudentFeeAccount = { ...a, ...recompute({ ...a, paid }), paid, rev: a.rev + 1, updatedAt: at, updatedByName: input.byName, history: step(a, at, input.byName, "PAID", `${receipt.receiptNo} Rs. ${amount} ${mode}`) };
    no.commit();
    tx.set(rRef, receipt);
    tx.set(ref, next);
    return { receipt, account: next };
  });
}

/** Cancels a receipt (wrong entry, bounced cheque ...): the amount comes off what was paid. Never deleted. */
export async function cancelReceipt(db: Db, c: string, receiptId: string, reasonRaw: unknown, byName: string) {
  const refs = feeRefs(db, c);
  const reason = String(reasonRaw ?? "").trim().slice(0, 300);
  if (!reason) throw new FeeError("Enter the reason for cancelling.");
  return db.runTransaction(async (tx) => {
    const rRef = refs.receipts.doc(receiptId);
    const rSnap = await tx.get(rRef);
    if (!rSnap.exists) throw new FeeError("Receipt not found. It may have been deleted.", 404);
    const r = rSnap.data() as FeeReceipt;
    if (r.cancelled) throw new FeeError("This receipt is already cancelled.", 409);
    if (r.source === "ONLINE") throw new FeeError("An online payment is cancelled by refunding it on Payments.", 409);
    const ref = refs.accounts.doc(r.accountId);
    const a = (await tx.get(ref)).data() as StudentFeeAccount;
    const at = new Date().toISOString();
    const paid = Math.max(0, a.paid - r.amount);
    tx.update(rRef, { cancelled: { at, byName, reason } });
    const next: StudentFeeAccount = { ...a, ...recompute({ ...a, paid }), paid, rev: a.rev + 1, updatedAt: at, updatedByName: byName, history: step(a, at, byName, "RECEIPT_CANCELLED", `${r.receiptNo}: ${reason}`) };
    tx.set(ref, next);
    return { receipt: { ...r, cancelled: { at, byName, reason } }, account: next };
  });
}

/** FR / NFR for a student (Scholarship Cell). Category A only; recomputes the shares - paid more than the new share
 *  shows as a negative balance (to refund / carry forward), never absorbed. */
export async function setFunding(db: Db, c: string, input: { accountId: string; funding: FeeFunding; note?: string; byName: string }) {
  const ref = feeRefs(db, c).accounts.doc(input.accountId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new FeeError("Fee account not found. It may have been deleted.", 404);
    const a = snap.data() as StudentFeeAccount;
    const bad = fundingError(a.category, input.funding);
    if (bad) throw new FeeError(bad);
    if (a.funding === input.funding) return { account: a, changed: false };
    const at = new Date().toISOString();
    const next: StudentFeeAccount = {
      ...a, funding: input.funding, ...recompute({ ...a, funding: input.funding }), ...(input.note ? { fundingNote: input.note.slice(0, 200) } : {}),
      rev: a.rev + 1, updatedAt: at, updatedByName: input.byName, history: step(a, at, input.byName, "FUNDING", `${a.funding} -> ${input.funding}`),
    };
    tx.set(ref, next);
    return { account: next, changed: true };
  });
}

/** Adds an approved concession to the account inside the caller's transaction (concession request approval). */
export function withConcession(a: StudentFeeAccount, con: FeeConcession, at: string, byName: string): StudentFeeAccount {
  const concessions = [...a.concessions, con];
  return { ...a, concessions, ...recompute({ ...a, concessions }), rev: a.rev + 1, updatedAt: at, updatedByName: byName, history: step(a, at, byName, "CONCESSION", `Rs. ${con.amount}: ${con.reason}${con.referralName ? ` (ref. ${con.referralName})` : ""}`) };
}

/** Government (FR) money received for students, recorded by the Scholarship Cell: adds to each account's
 *  govtReceived in its own transaction (FR accounts only). Returns what was applied. */
export async function addGovtReceived(db: Db, c: string, rows: { accountId: string; amount: number }[], creditId: string, byName: string) {
  const refs = feeRefs(db, c);
  const done: { accountId: string; amount: number; govtShare: number; govtReceived: number }[] = [];
  for (const r of rows) {
    const ref = refs.accounts.doc(r.accountId);
    const out = await db.runTransaction(async (tx) => {
      const a = (await tx.get(ref)).data() as StudentFeeAccount | undefined;
      if (!a) throw new FeeError("Fee account not found. It may have been deleted.", 404);
      const at = new Date().toISOString();
      const govtReceived = (a.govtReceived ?? 0) + r.amount;
      tx.set(ref, { ...a, govtReceived, rev: a.rev + 1, updatedAt: at, updatedByName: byName, history: step(a, at, byName, "GOVT_RECEIVED", `Rs. ${r.amount} (${creditId})`) });
      return { accountId: a.id, amount: r.amount, govtShare: a.govtShare, govtReceived };
    });
    done.push(out);
  }
  return done;
}
