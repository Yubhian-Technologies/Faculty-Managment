import { z } from "zod";
import { istDateFromParts } from "@/lib/attendance/istTime";
import type { StageId } from "@/lib/approvals";
import { findCategory } from "./categories";
import type { PermissionLimits, PermissionStage } from "./types";

// Pure rules for a permission request: input shape, limits, notice, the
// approval chain, and which days it covers. No I/O - the service feeds these
// with data it loaded, so every rule is unit-tested in isolation.

const isRealDate = (s: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
};
const dateKey = z.string().refine(isRealDate, "Use a valid date (YYYY-MM-DD)");
const short = (max: number) => z.string().trim().min(1).max(max);
const httpsUrl = z.string().trim().max(2000).refine((u) => { try { return new URL(u).protocol === "https:"; } catch { return false; } }, "Proof must be an https link");

export const permissionInputSchema = z.object({
  categoryId: short(80),
  title: short(120),
  description: short(2000),
  venue: z.string().trim().max(200).optional().transform((v) => v || undefined),
  fromDate: dateKey,
  toDate: dateKey,
  periods: z.union([z.literal("ALL"), z.array(z.number().int().min(1).max(12)).min(1).max(12)])
    .transform((p) => (p === "ALL" ? p : Array.from(new Set(p)).sort((a, b) => a - b))),
  proof: z.array(z.object({ url: httpsUrl, name: short(200) })).max(5).default([]),
}).refine((v) => v.toDate >= v.fromDate, { message: "The end date can't be before the start date", path: ["toDate"] });

export const facultyPermissionInputSchema = z.object({ studentIds: z.array(short(80)).min(1).max(500) }).and(permissionInputSchema);

export type PermissionInput = z.infer<typeof permissionInputSchema>;

const utcMs = (key: string) => {
  const [y, m, d] = key.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};

/** Every calendar date from `from` to `to`, inclusive (both YYYY-MM-DD). Capped so a bad range can't run away. */
export function enumerateDates(from: string, to: string): string[] {
  const out: string[] = [];
  for (let t = utcMs(from); t <= utcMs(to) && out.length < 400; t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

export const spanDays = (from: string, to: string) => enumerateDates(from, to).length;

/** Problems with a request against the effective limits and category switches - empty means acceptable. */
export function checkLimits(
  input: Pick<PermissionInput, "categoryId" | "fromDate" | "toDate" | "proof">,
  limits: PermissionLimits,
  opts: { studentCount: number; typeDisabled: boolean }
): string[] {
  const errors: string[] = [];
  if (!findCategory(input.categoryId)) errors.push("Choose a valid permission type");
  else if (opts.typeDisabled) errors.push("This type of permission isn't enabled for this department");
  const days = spanDays(input.fromDate, input.toDate);
  if (days > limits.maxDays) errors.push(`A request can cover at most ${limits.maxDays} day${limits.maxDays === 1 ? "" : "s"}`);
  if (limits.proofRequired && input.proof.length === 0) errors.push("Attach proof (an invitation, registration or letter)");
  if (opts.studentCount > limits.maxStudentsPerRequest) errors.push(`A request can include at most ${limits.maxStudentsPerRequest} students`);
  if (opts.studentCount < 1) errors.push("Select at least one student");
  return errors;
}

/**
 * Hours between `now` and the start (IST midnight) of the first day. Negative
 * for a request about a day already under way or past - allowed, but "late".
 */
export function noticeHours(now: Date, fromDate: string): number {
  const [y, m, d] = fromDate.split("-").map(Number);
  return Math.round(((istDateFromParts(y, m, d).getTime() - now.getTime()) / 3_600_000) * 10) / 10;
}

export const isLate = (hours: number, preferred: number) => hours < preferred;

export interface RequesterHolds {
  /** Heads the department the students belong to. */
  isHodOfDepartment: boolean;
  isVicePrincipal: boolean;
  isPrincipal: boolean;
}

/**
 * The configured route minus any stage the requester themselves occupies - a
 * faculty member who is the HOD of the student's department must not approve
 * their own request. If nothing is left, it goes to the Principal; a Principal
 * (nobody above them in the college) has no one to route to.
 */
export function buildChain(route: readonly StageId[], holds: RequesterHolds): StageId[] {
  const own = new Set<PermissionStage>([
    ...(holds.isHodOfDepartment ? (["HOD"] as const) : []),
    ...(holds.isVicePrincipal ? (["VICE_PRINCIPAL"] as const) : []),
    ...(holds.isPrincipal ? (["PRINCIPAL"] as const) : []),
  ]);
  const chain = route.filter((s) => !own.has(s as PermissionStage));
  if (chain.length > 0) return chain;
  if (holds.isPrincipal) throw new Error("A Principal can't raise a permission request: nobody above would approve it");
  return ["PRINCIPAL"];
}

const clamp = (n: unknown, lo: number, hi: number, fallback: number) => {
  const v = typeof n === "number" && Number.isFinite(n) ? Math.round(n) : fallback;
  return Math.min(hi, Math.max(lo, v));
};

/**
 * Keeps configured limits inside sane bounds. maxDays is capped at 60 because the
 * approval writes one coverage document per class day inside a single transaction.
 */
export function clampLimits(l: Partial<PermissionLimits> | undefined): Partial<PermissionLimits> | undefined {
  if (!l) return undefined;
  const out: Partial<PermissionLimits> = {};
  if (l.maxDays !== undefined) out.maxDays = clamp(l.maxDays, 1, 60, 15);
  if (l.advanceNoticeHours !== undefined) out.advanceNoticeHours = clamp(l.advanceNoticeHours, 0, 720, 24);
  if (l.maxStudentsPerRequest !== undefined) out.maxStudentsPerRequest = clamp(l.maxStudentsPerRequest, 1, 500, 100);
  if (l.proofRequired !== undefined) out.proofRequired = !!l.proofRequired;
  return out;
}
