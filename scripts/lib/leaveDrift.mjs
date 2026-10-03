// Pure core of scripts/leave-balance-drift-report.mjs - kept free of any
// Firebase import so it can be unit-tested (src/lib/leave/leaveDrift.test.ts).
//
// Question it answers: for each employee / leave type / year, does the stored
// leaveBalances `used` equal what the APPROVED leave requests say was used?
//
// What counts as "used" mirrors lib/leave/balanceEngine.ts exactly:
//   - approval commits `totalDays - lopDays` (the excess beyond balance is Loss
//     of Pay and was never charged), so that is what an approved request adds;
//   - cancelling an approved request gives those days back, and the request is
//     no longer APPROVED, so it drops out here too;
//   - the year is the one the request STARTS in, via the server-local
//     getFullYear() the engine uses (L5, the IST-boundary question, is
//     deliberately not touched - this report must agree with the engine, not
//     with what the engine should one day do);
//   - types with no tracked balance (On Duty, Summer Holidays) never have one.
//
// Read-only by construction: it computes and returns rows, nothing here writes.

export const DEFAULT_UNTRACKED_CODES = ["OD", "SH"];
const EPSILON = 1e-9;

/** @param {unknown} v */
function toDate(v) {
  if (v == null) return null;
  if (v instanceof Date) return v;
  if (typeof v === "number") return new Date(v);
  if (typeof v.toDate === "function") return v.toDate();
  if (typeof v._seconds === "number") return new Date(v._seconds * 1000);
  if (typeof v.seconds === "number") return new Date(v.seconds * 1000);
  return null;
}

const keyOf = (uid, code, year) => `${uid}|${code}|${year}`;
const round2 = (n) => Math.round(n * 100) / 100;

/**
 * @param {{
 *   balances: { id: string; uid: string; leaveTypeCode: string; year: number; used?: number; entitled?: number }[];
 *   requests: { id: string; uid: string; leaveTypeCode?: string; status: string; fromDate: unknown; totalDays?: number; lopDays?: number; isLateAttendancePenalty?: boolean }[];
 *   untrackedCodes?: string[];
 * }} input
 */
export function computeLeaveBalanceDrift({ balances, requests, untrackedCodes = DEFAULT_UNTRACKED_CODES }) {
  const untracked = new Set(untrackedCodes);
  /** @type {Map<string, { uid: string; code: string; year: number; expected: number; requestIds: string[] }>} */
  const expected = new Map();
  let skippedNoDate = 0;

  for (const r of requests) {
    if (r.status !== "APPROVED" || !r.leaveTypeCode || untracked.has(r.leaveTypeCode)) continue;
    const from = toDate(r.fromDate);
    if (!from) { skippedNoDate++; continue; }
    const year = from.getFullYear();
    const committed = Math.max(0, (r.totalDays ?? 0) - (r.lopDays ?? 0));
    const k = keyOf(r.uid, r.leaveTypeCode, year);
    const cur = expected.get(k) ?? { uid: r.uid, code: r.leaveTypeCode, year, expected: 0, requestIds: [] };
    cur.expected += committed;
    cur.requestIds.push(r.id);
    expected.set(k, cur);
  }

  /** @type {Map<string, (typeof balances)[number]>} */
  const stored = new Map();
  for (const b of balances) stored.set(keyOf(b.uid, b.leaveTypeCode, b.year), b);

  const rows = [];
  for (const k of new Set([...expected.keys(), ...stored.keys()])) {
    const e = expected.get(k);
    const b = stored.get(k);
    const storedUsed = round2(b?.used ?? 0);
    const expectedUsed = round2(e?.expected ?? 0);
    const delta = round2(storedUsed - expectedUsed);
    if (Math.abs(delta) < EPSILON) continue;
    const ref = b ?? e;
    let kind;
    if (!b) kind = "NO_BALANCE_DOC";
    else if (expectedUsed === 0) kind = "USED_WITHOUT_APPROVED_REQUESTS";
    else kind = delta > 0 ? "OVER_DEDUCTED" : "UNDER_DEDUCTED";
    rows.push({
      kind,
      balanceId: b?.id ?? null,
      uid: ref.uid,
      leaveTypeCode: b?.leaveTypeCode ?? e.code,
      year: b?.year ?? e.year,
      storedUsed,
      expectedUsed,
      delta,
      entitled: b?.entitled ?? null,
      approvedRequestIds: e?.requestIds ?? [],
    });
  }
  rows.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || a.uid.localeCompare(b.uid));

  const byKind = {};
  for (const r of rows) byKind[r.kind] = (byKind[r.kind] ?? 0) + 1;
  return {
    checkedBalances: balances.length,
    approvedRequestsCounted: [...expected.values()].reduce((n, v) => n + v.requestIds.length, 0),
    skippedRequestsWithoutDate: skippedNoDate,
    driftRows: rows.length,
    byKind,
    rows,
  };
}
