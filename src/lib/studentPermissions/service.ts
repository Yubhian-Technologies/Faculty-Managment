import type { Firestore } from "firebase-admin/firestore";
import { ZodError } from "zod";
import {
  ApprovalError, applyConfigEdit, createApprovalEngine, createFirestoreStore, isTypeDisabled, resolveLimits, resolveRoute,
} from "@/lib/approvals";
import type { ApprovalRequest, ConfigEditor, ListOptions } from "@/lib/approvals";
import { canHodEditDepartment, editableDepartmentNames, getHodDepartmentScope } from "@/lib/departments/scope";
import { getFacultyIdCandidates } from "@/lib/faculty/resolveFacultyMemberId";
import { findCurrentSectionDoc } from "@/lib/students/findCurrentSectionDoc";
import { getClassDays } from "@/lib/studentAttendance/classDay";
import { onDutyDayRef } from "@/lib/studentAttendance/onDuty";
import { categoryTypeKeys, findCategory } from "./categories";
import { loadPermissionConfig, savePermissionConfig } from "./configStore";
import { studentPermissionKind } from "./kind";
import { createPermissionEventSink } from "./notifications";
import {
  buildChain, checkLimits, clampLimits, facultyPermissionInputSchema, isLate, noticeHours,
  permissionInputSchema, type PermissionInput,
} from "./rules";
import {
  allowedStages, defaultRoute, DEFAULT_LIMITS, PERMISSION_KIND,
  type PermissionConfig, type PermissionContext, type PermissionPayload, type PermissionRequesterType, type PermissionStudentRef,
} from "./types";
import type { StudentRecord } from "@/types";

// Application service for student permissions: the use-cases the API routes call.
// Routes stay thin (authenticate, parse, call one of these, shape the response);
// every rule lives here or in the pure modules next to it.

export interface ActingUser { uid: string; name: string; collegeId: string; roles: readonly string[] }
export type PermissionRequest = ApprovalRequest<PermissionPayload>;

/** Who may raise a request on students' behalf: any teaching login. */
export const FACULTY_RAISER_ROLES = ["PANEL_MEMBER", "HOD", "VICE_PRINCIPAL"] as const;

const ctxOf = (db: Firestore, user: ActingUser): PermissionContext => ({ db, collegeId: user.collegeId, actorRoles: user.roles });
const store = (db: Firestore) => createFirestoreStore(db);
const engine = (db: Firestore) => createApprovalEngine({ kind: studentPermissionKind, store: store(db), onEvent: createPermissionEventSink(db) });
const invalid = (message: string) => new ApprovalError("INVALID", message, 400);

function parse<T>(run: () => T): T {
  try { return run(); } catch (err) {
    if (err instanceof ZodError) throw invalid(err.issues[0]?.message ?? "Invalid request");
    throw err;
  }
}

const refOf = (id: string, s: StudentRecord): PermissionStudentRef => ({
  id, ...(s.uid ? { uid: s.uid } : {}), rollNumber: s.rollNumber, name: s.name, department: s.department, year: s.year, section: s.section,
});

// ── student lookup / ownership ───────────────────────────────────────────────

export async function loadStudentByUid(db: Firestore, collegeId: string, uid: string) {
  const snap = await db.collection("colleges").doc(collegeId).collection("students").where("uid", "==", uid).limit(1).get();
  return snap.empty ? null : { ...(snap.docs[0].data() as StudentRecord), id: snap.docs[0].id };
}

/** The department that actually owns the student's section (the approver's department), and its class incharge. */
async function ownershipOf(db: Firestore, collegeId: string, s: StudentRecord, cache: Map<string, { department: string; inchargeUid?: string }>) {
  const key = `${s.department}|${s.secondaryDepartment ?? ""}|${s.section}|${s.year}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const sec = await findCurrentSectionDoc(db, collegeId, s);
  const data = sec?.data() as { department?: string; facultyInchargeUid?: string } | undefined;
  const out = { department: data?.department || s.department, inchargeUid: data?.facultyInchargeUid || undefined };
  cache.set(key, out);
  return out;
}

async function headsDepartment(db: Firestore, user: ActingUser, department: string): Promise<boolean> {
  if (!user.roles.includes("HOD")) return false;
  return canHodEditDepartment(await getHodDepartmentScope(db, user.collegeId, user.uid, { activeOnly: false }), department);
}

// ── creating requests ────────────────────────────────────────────────────────

/** A student raises a request for themselves. */
export async function createStudentRequest(db: Firestore, user: ActingUser, raw: unknown): Promise<PermissionRequest> {
  const input = parse(() => permissionInputSchema.parse(raw));
  const student = await loadStudentByUid(db, user.collegeId, user.uid);
  if (!student) throw invalid("Your login isn't linked to a student record yet. Please contact your College Office.");
  const [req] = await createRequests(db, user, "STUDENT", input, [student]);
  return req;
}

/** A faculty member raises one request for a group of students (one per department the group spans). */
export async function createFacultyRequests(db: Firestore, user: ActingUser, raw: unknown): Promise<PermissionRequest[]> {
  const parsed = parse(() => facultyPermissionInputSchema.parse(raw));
  const ids = Array.from(new Set(parsed.studentIds));
  const col = db.collection("colleges").doc(user.collegeId).collection("students");
  const snaps = await db.getAll(...ids.map((id) => col.doc(id)));
  const students = snaps.filter((s) => s.exists).map((s) => ({ ...(s.data() as StudentRecord), id: s.id }));
  if (students.length !== ids.length) throw invalid("One or more selected students weren't found");
  return createRequests(db, user, "FACULTY", parsed, students);
}

async function createRequests(
  db: Firestore, user: ActingUser, type: PermissionRequesterType, input: PermissionInput,
  students: (StudentRecord & { id: string })[]
): Promise<PermissionRequest[]> {
  const notRegular = students.find((s) => s.status !== "REGULAR");
  if (notRegular) throw invalid(`${notRegular.name} isn't an active (regular) student`);

  const config = await loadPermissionConfig(db, user.collegeId);
  if (!config.enabled) throw invalid("Student permissions aren't switched on for this college");
  const category = findCategory(input.categoryId);
  if (!category) throw invalid("Choose a valid permission type");
  const typeKeys = categoryTypeKeys(category);

  // Group by the department that owns each student's section: that is who approves.
  const cache = new Map<string, { department: string; inchargeUid?: string }>();
  const groups = new Map<string, { students: PermissionStudentRef[]; inchargeUid?: string }>();
  for (const s of students) {
    const own = await ownershipOf(db, user.collegeId, s, cache);
    const g = groups.get(own.department) ?? { students: [], inchargeUid: own.inchargeUid };
    g.students.push(refOf(s.id, s));
    groups.set(own.department, g);
  }

  const calendarDays = await getClassDays(db, user.collegeId, input.fromDate, input.toDate);
  if (calendarDays.length === 0) throw invalid("There are no class days between those dates");
  const hours = noticeHours(new Date(), input.fromDate);
  const eng = engine(db);

  // Validate every group BEFORE submitting any, so a request that spans departments
  // is accepted or refused as a whole rather than half-created.
  const prepared = [];
  for (const [department, g] of groups) {
    const limits = resolveLimits(config, DEFAULT_LIMITS, department);
    const errors = checkLimits(input, limits, { studentCount: g.students.length, typeDisabled: isTypeDisabled(config, department, typeKeys) });
    if (errors.length) throw invalid(errors.join(". "));
    const clash = await findClash(db, user.collegeId, department, g.students.map((s) => s.id), calendarDays);
    if (clash) throw invalid(`${clash.name} already has a permission covering ${clash.date}`);

    const holds = { isHodOfDepartment: await headsDepartment(db, user, department), isVicePrincipal: user.roles.includes("VICE_PRINCIPAL"), isPrincipal: user.roles.includes("PRINCIPAL") };
    let chain;
    try { chain = buildChain(resolveRoute(config, defaultRoute, { department, requesterType: type, typeKeys }), holds); }
    catch (e) { throw invalid(e instanceof Error ? e.message : "No approver available"); }

    const payload: PermissionPayload = {
      categoryId: category.id, groupId: category.groupId, categoryLabel: category.label,
      title: input.title, description: input.description, ...(input.venue ? { venue: input.venue } : {}),
      fromDate: input.fromDate, toDate: input.toDate, periods: input.periods, coverageDates: calendarDays,
      students: g.students, studentUids: g.students.flatMap((s) => (s.uid ? [s.uid] : [])), proof: input.proof,
      late: isLate(hours, limits.advanceNoticeHours), noticeHours: hours,
      ...(type === "STUDENT" && g.inchargeUid ? { inchargeUid: g.inchargeUid } : {}),
    };
    prepared.push({ department, chain, payload });
  }

  const out: PermissionRequest[] = [];
  for (const p of prepared) {
    out.push(await eng.submit(ctxOf(db, user), {
      collegeId: user.collegeId, scope: p.department, requester: { uid: user.uid, name: user.name, type }, payload: p.payload, chain: p.chain,
    }));
  }
  return out;
}

/**
 * Is any of these students already covered - approved on duty, or in a pending
 * request - on one of `dates`? One read for the approved days (a document per
 * day), one query for the department's pending requests.
 */
async function findClash(db: Firestore, collegeId: string, department: string, studentIds: string[], dates: string[]) {
  const ids = new Set(studentIds);
  const days = await db.getAll(...dates.map((d) => onDutyDayRef(db, collegeId, d)));
  for (const snap of days) {
    const by = (snap.data()?.byStudent ?? {}) as Record<string, Record<string, unknown>>;
    for (const id of ids) if (by[id] && Object.keys(by[id]).length > 0) return { name: id, date: snap.id };
  }
  const pending = await store(db).listByScope<PermissionPayload>(collegeId, PERMISSION_KIND, [department], { limit: 300 });
  const wanted = new Set(dates);
  for (const r of pending) {
    if (r.status !== "PENDING") continue;
    const date = r.payload.coverageDates.find((d) => wanted.has(d));
    const hit = date && r.payload.students.find((s) => ids.has(s.id));
    if (hit) return { name: hit.name, date: date! };
  }
  return null;
}

// ── deciding / withdrawing ───────────────────────────────────────────────────

export const decide = (db: Firestore, user: ActingUser, id: string, decision: "APPROVE" | "REJECT", remark?: string) =>
  engine(db).decide(ctxOf(db, user), { collegeId: user.collegeId, id, actor: { uid: user.uid, name: user.name }, decision, remark });

export const cancelRequest = (db: Firestore, user: ActingUser, id: string, remark?: string) =>
  engine(db).cancel(ctxOf(db, user), { collegeId: user.collegeId, id, actor: { uid: user.uid, name: user.name }, remark });

export const revokeRequest = (db: Firestore, user: ActingUser, id: string, remark: string) =>
  engine(db).revoke(ctxOf(db, user), { collegeId: user.collegeId, id, actor: { uid: user.uid, name: user.name }, remark });

/** Re-runs a failed after-approval step (e.g. updating already-marked sessions). Any approver may trigger it. */
export async function retryEffects(db: Firestore, user: ActingUser, id: string) {
  const req = await store(db).get<PermissionPayload>(user.collegeId, id);
  if (!req) throw new ApprovalError("NOT_FOUND", "Request not found", 404);
  if (!(await canView(db, user, req)) || req.requesterUid === user.uid) throw new ApprovalError("FORBIDDEN", "You can't do that", 403);
  return engine(db).retryEffects(ctxOf(db, user), { collegeId: user.collegeId, id });
}

// ── reading ──────────────────────────────────────────────────────────────────

/** "<stage>|<scope>" inbox keys for everything this login can currently decide. */
export async function inboxKeys(db: Firestore, user: ActingUser): Promise<string[]> {
  const keys: string[] = [];
  if (user.roles.includes("HOD")) {
    const scope = await getHodDepartmentScope(db, user.collegeId, user.uid, { activeOnly: false });
    for (const d of editableDepartmentNames(scope)) keys.push(`HOD|${d}`);
  }
  if (user.roles.includes("VICE_PRINCIPAL")) keys.push("VICE_PRINCIPAL|*");
  if (user.roles.includes("PRINCIPAL")) keys.push("PRINCIPAL|*");
  // Any teaching login may be a class incharge; the key is the incharge id recorded on the request.
  if (user.roles.some((r) => (FACULTY_RAISER_ROLES as readonly string[]).includes(r))) {
    for (const id of await getFacultyIdCandidates(db, user.collegeId, user.uid)) keys.push(`CLASS_INCHARGE|${id}`);
  }
  return Array.from(new Set(keys));
}

export const listInbox = async (db: Firestore, user: ActingUser, opts?: ListOptions) =>
  store(db).listByPendingKeys<PermissionPayload>(user.collegeId, PERMISSION_KIND, await inboxKeys(db, user), opts);

/** Requests this login raised, plus (for a student) those raised for them by faculty. */
export async function listMine(db: Firestore, user: ActingUser, opts?: ListOptions): Promise<PermissionRequest[]> {
  const [raised, covering] = await Promise.all([
    store(db).listByRequester<PermissionPayload>(user.collegeId, PERMISSION_KIND, user.uid, opts),
    store(db).listByPayloadArray<PermissionPayload>(user.collegeId, PERMISSION_KIND, "studentUids", user.uid, opts),
  ]);
  const seen = new Set<string>();
  return [...raised, ...covering].filter((r) => !seen.has(r.id) && !!seen.add(r.id))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, opts?.limit ?? 100);
}

/** Everything in the departments this login oversees (HOD: theirs; Vice Principal / Principal: all). */
export async function listForOversight(db: Firestore, user: ActingUser, opts?: ListOptions): Promise<PermissionRequest[]> {
  let scopes: string[] = [];
  if (user.roles.includes("PRINCIPAL") || user.roles.includes("VICE_PRINCIPAL")) {
    const snap = await db.collection("colleges").doc(user.collegeId).collection("departments").select("name").get();
    scopes = snap.docs.map((d) => (d.data() as { name?: string }).name ?? "").filter(Boolean);
  } else if (user.roles.includes("HOD")) {
    scopes = editableDepartmentNames(await getHodDepartmentScope(db, user.collegeId, user.uid, { activeOnly: false }));
  }
  return store(db).listByScope<PermissionPayload>(user.collegeId, PERMISSION_KIND, scopes, opts);
}

/** May this login see this request? Requester, a covered student, the department's HOD, the Vice Principal / Principal, or its class incharge. */
export async function canView(db: Firestore, user: ActingUser, req: PermissionRequest): Promise<boolean> {
  if (req.requesterUid === user.uid || req.payload.studentUids.includes(user.uid)) return true;
  if (user.roles.includes("PRINCIPAL") || user.roles.includes("VICE_PRINCIPAL")) return true;
  if (await headsDepartment(db, user, req.scope)) return true;
  if (req.payload.inchargeUid) return (await getFacultyIdCandidates(db, user.collegeId, user.uid)).includes(req.payload.inchargeUid);
  return false;
}

export async function getRequest(db: Firestore, user: ActingUser, id: string): Promise<PermissionRequest> {
  const req = await store(db).get<PermissionPayload>(user.collegeId, id);
  // Same answer for "doesn't exist" and "not yours" so ids can't be probed.
  if (!req || req.kind !== PERMISSION_KIND || !(await canView(db, user, req))) throw new ApprovalError("NOT_FOUND", "Request not found", 404);
  return req;
}

// ── configuration ────────────────────────────────────────────────────────────

/** Who the acting login is, for editing configuration: the Principal, or an HOD for their own departments. */
async function configEditor(db: Firestore, user: ActingUser): Promise<ConfigEditor> {
  if (user.roles.includes("PRINCIPAL")) return { role: "PRINCIPAL" };
  if (user.roles.includes("HOD")) {
    return { role: "HOD", departments: editableDepartmentNames(await getHodDepartmentScope(db, user.collegeId, user.uid, { activeOnly: false })) };
  }
  throw new ApprovalError("FORBIDDEN", "Only the Principal or an HOD can change this", 403);
}

/** What the acting login may edit, for the screen: everything (Principal), their own departments (HOD), or nothing. */
export async function describeEditor(db: Firestore, user: ActingUser): Promise<{ college: boolean; departments: string[] | "ALL" }> {
  if (user.roles.includes("PRINCIPAL")) return { college: true, departments: "ALL" };
  if (user.roles.includes("HOD")) {
    return { college: false, departments: editableDepartmentNames(await getHodDepartmentScope(db, user.collegeId, user.uid, { activeOnly: false })) };
  }
  return { college: false, departments: [] };
}

/** The config as this login is allowed to see it (HODs see the college rules too, read-only). */
export const readConfig = (db: Firestore, user: ActingUser) => loadPermissionConfig(db, user.collegeId);

export async function writeConfig(db: Firestore, user: ActingUser, proposed: PermissionConfig): Promise<PermissionConfig> {
  const editor = await configEditor(db, user);
  const current = await loadPermissionConfig(db, user.collegeId);
  const next = applyConfigEdit(current, proposed, editor, allowedStages);
  // Keep limits in range, at college level and in every department override.
  if (next.college.limits) next.college = { ...next.college, limits: clampLimits(next.college.limits) };
  for (const [d, dc] of Object.entries(next.departments)) {
    if (dc.override?.limits) next.departments[d] = { ...dc, override: { ...dc.override, limits: clampLimits(dc.override.limits) } };
  }
  return savePermissionConfig(db, user.collegeId, next, user.name);
}

