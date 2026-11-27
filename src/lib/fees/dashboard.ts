// Accounts > Fees > Dashboard: one academic year's fee position for a college, worked out from the fee accounts
// (studentFees - authoritative for raised / paid / balance, split by head and bank account through instalmentStates),
// the receipts (when money came in, counter vs online, mode) and the online payments (CCAvenue outcomes). Pure - the
// route (api/college/fees/dashboard) loads and passes the rows.

import type { FeeCategory, FeeFunding, FeePaymentMode, FeeReceipt, StudentFeeAccount } from "@/types/fees";
import type { PaymentStatus } from "@/types/payments";
import { instalmentStates } from "./rules";

export interface DashPayment { status: PaymentStatus; amount: number; needsRefund?: boolean; createdAt: string }

export interface FeeMoney { students: number; raised: number; payable: number; collected: number; balance: number }
export interface FeeGroupRow extends FeeMoney { key: string; label: string; overdue: number; overdueStudents: number }

export interface FeeDashboard {
  today: string;
  totals: FeeMoney & {
    concession: number; govtShare: number; govtReceived: number; overdue: number; overdueStudents: number;
    cleared: number; paidExtra: number; paidExtraStudents: number; notStarted: number;
  };
  collections: {
    today: { amount: number; count: number }; month: { amount: number; count: number }; year: { amount: number; count: number };
    bySource: { COUNTER: number; ONLINE: number }; byMode: { mode: FeePaymentMode; amount: number; count: number }[];
    daily: { date: string; amount: number; count: number }[]; cancelled: { amount: number; count: number };
  };
  byBank: { key: string; label: string; payable: number; collected: number; balance: number }[];
  byHead: { key: string; label: string; payable: number; collected: number; balance: number }[];
  byCategory: (FeeGroupRow & { govtShare: number; govtReceived: number })[];
  byClass: FeeGroupRow[];
  byDepartment: FeeGroupRow[];
  instalments: { no: number; label: string; dueDate: string; payable: number; collected: number; balance: number; overdue: number; overdueStudents: number }[];
  ageing: { key: string; label: string; amount: number; students: number }[];
  defaulters: { accountId: string; rollNumber: string; name: string; department: string; section: string; courseName: string; batch: string; category: FeeCategory; funding: FeeFunding; overdue: number; balance: number; oldestDue: string; days: number }[];
  online: { success: number; successAmount: number; failed: number; pending: number; refunded: number; needsRefund: number };
  pendingConcessions: number;
}

export const CATEGORY_GROUP: Record<string, string> = { "A-FR": "Category A - FR", "A-NFR": "Category A - NFR", SPOT: "Spot", B: "Category B" };
const groupOfAccount = (a: Pick<StudentFeeAccount, "category" | "funding">) => (a.category === "A" ? `A-${a.funding === "FR" ? "FR" : "NFR"}` : a.category);

const AGEING = [
  { key: "0-30", label: "Up to 30 days", max: 30 },
  { key: "31-60", label: "31 to 60 days", max: 60 },
  { key: "61-90", label: "61 to 90 days", max: 90 },
  { key: "90+", label: "Over 90 days", max: Infinity },
];

const dayNo = (iso: string) => Math.round(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86_400_000);
const isoOf = (n: number) => new Date(n * 86_400_000).toISOString().slice(0, 10);

function emptyGroup(key: string, label: string): FeeGroupRow {
  return { key, label, students: 0, raised: 0, payable: 0, collected: 0, balance: 0, overdue: 0, overdueStudents: 0 };
}

export function buildFeeDashboard(input: {
  accounts: StudentFeeAccount[]; receipts: FeeReceipt[]; payments: DashPayment[]; pendingConcessions: number; today: string; days?: number;
}): FeeDashboard {
  const { accounts, receipts, payments, today } = input;
  const days = input.days ?? 30;
  const t = { students: 0, raised: 0, payable: 0, collected: 0, balance: 0, concession: 0, govtShare: 0, govtReceived: 0, overdue: 0, overdueStudents: 0, cleared: 0, paidExtra: 0, paidExtraStudents: 0, notStarted: 0 };
  const bank = new Map<string, { key: string; label: string; payable: number; collected: number }>();
  const head = new Map<string, { key: string; label: string; payable: number; collected: number }>();
  const cats = new Map<string, FeeGroupRow & { govtShare: number; govtReceived: number }>();
  const classes = new Map<string, FeeGroupRow>();
  const depts = new Map<string, FeeGroupRow>();
  const inst = new Map<number, { no: number; label: string; dates: Map<string, number>; payable: number; collected: number; overdue: number; overdueStudents: number }>();
  const ageing = AGEING.map((g) => ({ key: g.key, label: g.label, amount: 0, students: 0 }));
  const defaulters: FeeDashboard["defaulters"] = [];

  for (const a of accounts) {
    const st = instalmentStates(a, today);
    const overdueRows = st.filter((x) => x.overdue);
    const overdue = overdueRows.reduce((n, x) => n + x.due, 0);
    const balance = Math.max(0, a.balance);
    t.students++; t.raised += a.gross; t.payable += a.studentShare; t.collected += a.paid; t.balance += balance;
    t.concession += a.concessionTotal;
    if (a.funding === "FR" && a.category === "A") { t.govtShare += a.govtShare; t.govtReceived += a.govtReceived; }
    t.overdue += overdue;
    if (overdue > 0) t.overdueStudents++;
    if (a.balance <= 0 && a.studentShare > 0) t.cleared++;
    if (a.balance < 0) { t.paidExtra += -a.balance; t.paidExtraStudents++; }
    if (a.paid <= 0 && a.studentShare > 0) t.notStarted++;

    // Heads and bank accounts: the student's share of each head, and what has been paid against it.
    const paidByHead: Record<string, number> = {};
    for (const x of st) for (const [h, v] of Object.entries(x.paidByHead)) paidByHead[h] = (paidByHead[h] ?? 0) + v;
    for (const h of a.heads) {
      const hk = h.headId;
      const hr = head.get(hk) ?? { key: hk, label: h.name, payable: 0, collected: 0 };
      hr.payable += h.student; hr.collected += paidByHead[hk] ?? 0; head.set(hk, hr);
      const bk = h.bankAccountId ?? "";
      const br = bank.get(bk) ?? { key: bk, label: h.bankAccountName || "No bank account set", payable: 0, collected: 0 };
      br.payable += h.student; br.collected += paidByHead[hk] ?? 0; bank.set(bk, br);
    }

    const add = (m: Map<string, FeeGroupRow>, key: string, label: string) => {
      const g = m.get(key) ?? emptyGroup(key, label);
      g.students++; g.raised += a.gross; g.payable += a.studentShare; g.collected += a.paid; g.balance += balance; g.overdue += overdue;
      if (overdue > 0) g.overdueStudents++;
      m.set(key, g);
      return g;
    };
    const ck = groupOfAccount(a);
    const cg = (cats.get(ck) ?? { ...emptyGroup(ck, CATEGORY_GROUP[ck] ?? ck), govtShare: 0, govtReceived: 0 });
    cats.set(ck, cg);
    add(cats as Map<string, FeeGroupRow>, ck, CATEGORY_GROUP[ck] ?? ck);
    if (ck === "A-FR") { cg.govtShare += a.govtShare; cg.govtReceived += a.govtReceived; }
    add(classes, `${a.courseKey}__${a.batch}`, `${a.courseName} ${a.batch}`);
    add(depts, a.department || "-", a.department || "Not on record");

    for (const x of st) {
      const r = inst.get(x.no) ?? { no: x.no, label: x.label, dates: new Map<string, number>(), payable: 0, collected: 0, overdue: 0, overdueStudents: 0 };
      r.dates.set(x.dueDate, (r.dates.get(x.dueDate) ?? 0) + 1);
      r.payable += x.amount; r.collected += x.paid;
      if (x.overdue) { r.overdue += x.due; r.overdueStudents++; }
      inst.set(x.no, r);
    }

    if (overdue > 0) {
      const oldest = overdueRows[0].dueDate;
      const late = dayNo(today) - dayNo(oldest);
      const g = AGEING.findIndex((x) => late <= x.max);
      ageing[g].amount += overdue; ageing[g].students++;
      defaulters.push({ accountId: a.id, rollNumber: a.rollNumber, name: a.name, department: a.department, section: a.section, courseName: a.courseName, batch: a.batch, category: a.category, funding: a.funding, overdue, balance, oldestDue: oldest, days: late });
    }
  }

  // Money in, by date (receipts not cancelled).
  const month = today.slice(0, 7);
  const first = dayNo(today) - (days - 1);
  const daily = new Map<string, { amount: number; count: number }>();
  for (let n = first; n <= dayNo(today); n++) daily.set(isoOf(n), { amount: 0, count: 0 });
  const c = { today: { amount: 0, count: 0 }, month: { amount: 0, count: 0 }, year: { amount: 0, count: 0 }, bySource: { COUNTER: 0, ONLINE: 0 }, cancelled: { amount: 0, count: 0 } };
  const modes = new Map<FeePaymentMode, { amount: number; count: number }>();
  for (const r of receipts) {
    if (r.cancelled) { c.cancelled.amount += r.amount; c.cancelled.count++; continue; }
    c.year.amount += r.amount; c.year.count++;
    if (r.paidOn === today) { c.today.amount += r.amount; c.today.count++; }
    if (r.paidOn.startsWith(month)) { c.month.amount += r.amount; c.month.count++; }
    c.bySource[r.source === "ONLINE" ? "ONLINE" : "COUNTER"] += r.amount;
    const m = modes.get(r.mode) ?? { amount: 0, count: 0 };
    m.amount += r.amount; m.count++; modes.set(r.mode, m);
    const d = daily.get(r.paidOn);
    if (d) { d.amount += r.amount; d.count++; }
  }

  const online = { success: 0, successAmount: 0, failed: 0, pending: 0, refunded: 0, needsRefund: 0 };
  for (const p of payments) {
    if (p.status === "SUCCESS" || p.status === "PARTIALLY_REFUNDED") { online.success++; online.successAmount += p.amount; }
    else if (p.status === "FAILED" || p.status === "ABORTED") online.failed++;
    else if (p.status === "INITIATED") online.pending++;
    else if (p.status === "REFUNDED") online.refunded++;
    if (p.needsRefund && p.status !== "REFUNDED") online.needsRefund++;
  }

  const money = <T extends { payable: number; collected: number }>(r: T) => ({ ...r, balance: Math.max(0, r.payable - r.collected) });
  const byBalance = <T extends { balance: number; label: string }>(a: T, b: T) => b.balance - a.balance || a.label.localeCompare(b.label);
  return {
    today,
    totals: t,
    collections: {
      ...c,
      byMode: [...modes.entries()].map(([mode, v]) => ({ mode, ...v })).sort((a, b) => b.amount - a.amount),
      daily: [...daily.entries()].map(([date, v]) => ({ date, ...v })),
    },
    byBank: [...bank.values()].map(money).sort(byBalance),
    byHead: [...head.values()].map(money).sort(byBalance),
    byCategory: ["A-FR", "A-NFR", "SPOT", "B"].map((k) => cats.get(k)).filter((x): x is NonNullable<typeof x> => !!x),
    byClass: [...classes.values()].sort((a, b) => a.label.localeCompare(b.label)),
    byDepartment: [...depts.values()].sort(byBalance),
    instalments: [...inst.values()].sort((a, b) => a.no - b.no).map((r) => ({
      no: r.no, label: r.label, dueDate: [...r.dates.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "",
      payable: r.payable, collected: r.collected, balance: Math.max(0, r.payable - r.collected), overdue: r.overdue, overdueStudents: r.overdueStudents,
    })),
    ageing,
    defaulters: defaulters.sort((a, b) => b.overdue - a.overdue || b.days - a.days),
    online,
    pendingConcessions: input.pendingConcessions,
  };
}
