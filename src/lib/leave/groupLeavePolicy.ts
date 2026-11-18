import type { Firestore } from "firebase-admin/firestore";
import type { GroupLeavePolicy, LeaveRuleField, LeaveTypeCode } from "@/types/leave";
import { LEAVE_RULE_FIELDS } from "@/types/leave";

// The Super Admin's leave rules for every college (systemSettings/leavePolicy) - read by every leave rule lookup
// (resolveLeaveTypes.ts), kept 60 s per server instance so a change reaches every college within a minute.

const TTL_MS = 60_000;
let cached: { at: number; value: Promise<GroupLeavePolicy | null> } | null = null;

export const groupLeavePolicyRef = (db: Firestore) => db.collection("systemSettings").doc("leavePolicy");

export function invalidateGroupLeavePolicy(): void { cached = null; }

export function loadGroupLeavePolicy(db: Firestore, opts: { fresh?: boolean } = {}): Promise<GroupLeavePolicy | null> {
  // The Firestore emulator (tests) is never cached - each test brings its own data.
  const useCache = !opts.fresh && !process.env.FIRESTORE_EMULATOR_HOST;
  if (useCache && cached && Date.now() - cached.at < TTL_MS) return cached.value;
  const value = groupLeavePolicyRef(db).get()
    .then((s) => {
      const d = s.data() as Partial<GroupLeavePolicy> | undefined;
      return d ? { rules: d.rules ?? {}, locked: d.locked ?? {}, updatedAt: d.updatedAt, updatedByName: d.updatedByName } : null;
    })
    .catch((err) => { console.error("[groupLeavePolicy] load failed", err); return null; });
  if (useCache) cached = { at: Date.now(), value };
  return value;
}

/** Lock lists cleaned: only known leave types and fields, no repeats. */
export function sanitizeLocks(input: unknown, validCodes: Set<string>): { ok: true; locked: GroupLeavePolicy["locked"] } | { ok: false; error: string } {
  if (input === undefined || input === null) return { ok: true, locked: {} };
  if (typeof input !== "object") return { ok: false, error: "locked must be an object" };
  const locked: GroupLeavePolicy["locked"] = {};
  for (const [code, fields] of Object.entries(input as Record<string, unknown>)) {
    if (!validCodes.has(code)) return { ok: false, error: `Unknown leave type ${code}` };
    if (!Array.isArray(fields)) return { ok: false, error: `${code}: locked fields must be a list` };
    const clean = [...new Set(fields)].filter((f): f is LeaveRuleField => LEAVE_RULE_FIELDS.includes(f as LeaveRuleField));
    if (clean.length !== new Set(fields).size) return { ok: false, error: `${code}: unknown rule in the locked list` };
    if (clean.length) locked[code as LeaveTypeCode] = clean;
  }
  return { ok: true, locked };
}
