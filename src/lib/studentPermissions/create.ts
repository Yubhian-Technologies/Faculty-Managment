import type { Firestore } from "firebase-admin/firestore";
import { ZodError } from "zod";
import { ApprovalError, isTypeDisabled, resolveLimits, resolveRoute } from "@/lib/approvals";
import { istDateKey } from "@/lib/attendance/istTime";
import { getClassDays } from "@/lib/studentAttendance/classDay";
import { findOnDutyClash } from "@/lib/studentAttendance/onDuty";
import type { StudentRecord } from "@/types";
import { categoryTypeKeys, findCategory } from "./categories";
import { headsDepartment, loadStudentByUid, loadStudentsByIds, ownershipOf, type SectionOwner } from "./directory";
import { loadPermissionConfig } from "./configStore";
import {
  buildChain, checkLimits, facultyPermissionInputSchema, hasEarlierPendingOverlap, isLate, isOwnProofUrl, mayRequest, noticeHours, resolveRequesters, permissionInputSchema, resolveProofRequired,
  type PermissionInput,
} from "./rules";
import {
  DEFAULT_LIMITS, defaultRoute, PERMISSION_KIND,
  type ActingUser, type PermissionPayload, type PermissionRequest, type PermissionRequesterType, type PermissionStudentRef,
} from "./types";
import { ctxOf, engine, store } from "./wiring";

// Use-case: raise a permission request (a student for themselves, or faculty for a
// group). Validates everything first, then submits one request per approving department.

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
  const students = await loadStudentsByIds(db, user.collegeId, ids);
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
  // Proof must be a file this module uploaded for this college - never an arbitrary link.
  if (input.proof.some((f) => !isOwnProofUrl(f.url, user.collegeId))) throw invalid("Proof must be uploaded through this form");

  // Group by the department that owns each student's section: that is who approves.
  const cache = new Map<string, SectionOwner>();
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
    const layers = [config.departments?.[department]?.override?.limits, config.college?.limits];
    if (!mayRequest(resolveRequesters(layers, typeKeys), user.roles)) throw invalid("Your role can't raise this type of permission");
    const resolved = resolveLimits(config, DEFAULT_LIMITS, department);
    const proofRequired = resolveProofRequired(layers, typeKeys);
    const limits = { ...resolved, proofRequired };
    const errors = checkLimits(input, limits, { studentCount: g.students.length, typeDisabled: isTypeDisabled(config, department, typeKeys), today: istDateKey() });
    if (errors.length) throw invalid(errors.join(". "));
    const clash = await findClash(db, user.collegeId, department, g.students, calendarDays);
    if (clash) throw invalid(`${clash.name} already has a permission covering ${clash.date}`);

    const holds = { isHodOfDepartment: await headsDepartment(db, user, department), isVicePrincipal: user.roles.includes("VICE_PRINCIPAL"), isPrincipal: user.roles.includes("PRINCIPAL") };
    let chain;
    try { chain = buildChain(resolveRoute(config, defaultRoute, { department, requesterType: type, typeKeys }), holds); }
    catch (e) { throw invalid(e instanceof Error ? e.message : "No approver available"); }

    const customLabel = input.otherCategory?.trim();
    const payload: PermissionPayload = {
      categoryId: category.id, groupId: category.groupId, categoryLabel: customLabel || category.label,
      ...(customLabel ? { otherCategory: customLabel } : {}),
      title: input.title, description: input.description, ...(input.venue ? { venue: input.venue } : {}),
      fromDate: input.fromDate, toDate: input.toDate, periods: input.periods, coverageDates: calendarDays,
      students: g.students, studentUids: g.students.flatMap((s) => (s.uid ? [s.uid] : [])), proof: input.proof,
      late: isLate(hours, limits.advanceNoticeHours), noticeHours: hours,
      ...(type === "STUDENT" && g.inchargeUid ? { inchargeUid: g.inchargeUid } : {}),
    };
    prepared.push({ department, chain, payload });
  }

  const out: PermissionRequest[] = [];
  let duplicate: string | null = null;
  for (const p of prepared) {
    const req = await eng.submit(ctxOf(db, user), {
      collegeId: user.collegeId, scope: p.department, requester: { uid: user.uid, name: user.name, type }, payload: p.payload, chain: p.chain,
    });
    // The "already covered?" check above and the save are separate steps, so a double-click (or two people) can slip two
    // requests through. Re-check now that this one exists: of two racing requests exactly one backs off.
    const pending = await store(db).listByScope<PermissionPayload>(user.collegeId, PERMISSION_KIND, [p.department], { limit: 300 });
    if (hasEarlierPendingOverlap({ id: req.id, createdAt: req.createdAt, coverageDates: p.payload.coverageDates, studentIds: p.payload.students.map((s) => s.id) }, pending)) {
      await eng.cancel(ctxOf(db, user), { collegeId: user.collegeId, id: req.id, actor: { uid: user.uid, name: user.name }, remark: "Duplicate of an earlier request" });
      duplicate = p.payload.title;
      continue;
    }
    out.push(req);
  }
  if (out.length === 0 && duplicate) throw invalid("These students already have a permission request covering those days");
  return out;
}

/** Is any of these students already covered - approved on duty, or in a pending request - on one of `dates`? */
async function findClash(db: Firestore, collegeId: string, department: string, students: PermissionStudentRef[], dates: string[]) {
  const onDuty = await findOnDutyClash(db, collegeId, dates, students.map((s) => s.id));
  if (onDuty) return { name: students.find((s) => s.id === onDuty.studentId)?.name ?? onDuty.studentId, date: onDuty.date };

  const ids = new Set(students.map((s) => s.id));
  const wanted = new Set(dates);
  const pending = await store(db).listByScope<PermissionPayload>(collegeId, PERMISSION_KIND, [department], { limit: 300 });
  for (const r of pending) {
    if (r.status !== "PENDING") continue;
    const date = r.payload.coverageDates.find((d) => wanted.has(d));
    const hit = date && r.payload.students.find((s) => ids.has(s.id));
    if (hit) return { name: hit.name, date: date! };
  }
  return null;
}
