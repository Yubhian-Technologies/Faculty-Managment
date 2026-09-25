// Single Responsibility: Circular persistence (CRUD + publish).
// Depends on Firestore + atomic fan-out via notifications; no UI/auth coupling.
// SOLID: extracted behind small functions so API routes and UI depend on abstractions.

import type { Firestore } from "firebase-admin/firestore";
import type { Circular, CircularAudience, EmployeeScope } from "@/types/circular";
import { notify } from "@/lib/notify";
import { sendMail } from "@/lib/email/mailer";

function circularsCol(db: Firestore, collegeId: string) {
  return db.collection("colleges").doc(collegeId).collection("circulars");
}

// TEACHING vs NON_TEACHING mapping for audience expansion.
// Keep in one place so roster queries stay consistent with teaching/non-teaching split.
const TEACHING_ROLES = new Set<string>([
  "PANEL_MEMBER",
  "HOD",
  "DEPARTMENT_OFFICE",
  "DEAN",
  "IQAC_COORDINATOR",
  "T_AND_P",
  "R_AND_D",
  "PRINCIPAL",
  "VICE_PRINCIPAL",
  "COLLEGE_ADMIN",
]);

function employeeTypeMatches(role: string, scope: EmployeeScope): boolean {
  if (scope === "ALL") return true;
  const isTeaching = TEACHING_ROLES.has(role);
  return scope === "TEACHING" ? isTeaching : !isTeaching;
}

export interface CreateCircularInput {
  collegeId: string;
  subject: string;
  body: string;
  date: Date;
  audience: CircularAudience;
  messageFrom: string;
  attachments: { fileName: string; fileUrl: string; fileType?: string; fileSize?: number }[];
  createdBy: string;
  createdByName: string;
  createdByRole: string;
}

function validateInput(input: CreateCircularInput) {
  if (!input.subject?.trim()) throw new Error("Subject is required");
  if (!input.body?.trim()) throw new Error("Body is required");
  if (!input.messageFrom?.trim()) throw new Error("Message from is required");
  if (!input.date || Number.isNaN(input.date.getTime())) throw new Error("Date is required");
  if (!input.audience) throw new Error("Audience is required");
}

export async function createCircular(db: Firestore, input: CreateCircularInput): Promise<Circular> {
  validateInput(input);
  const now = new Date() as unknown as Circular["createdAt"];
  const ref = circularsCol(db, input.collegeId).doc();
  const payload: Circular = {
    id: ref.id,
    collegeId: input.collegeId,
    subject: input.subject.trim(),
    body: input.body.trim(),
    date: input.date as unknown as Circular["date"],
    audience: {
      employeeType: input.audience.employeeType,
      departmentIds: [...(input.audience.departmentIds ?? [])],
      departmentNames: input.audience.departmentNames ?? [],
      recipientKind: input.audience.recipientKind ?? "STAFF",
      targetYears: input.audience.targetYears ?? [],
    },
    messageFrom: input.messageFrom.trim(),
    attachments: input.attachments ?? [],
    status: "DRAFT",
    createdBy: input.createdBy,
    createdByName: input.createdByName,
    createdByRole: input.createdByRole as Circular["createdByRole"],
    createdAt: now,
    updatedAt: now,
  };
  await ref.set(payload);
  return payload;
}

export async function getCircular(db: Firestore, collegeId: string, id: string): Promise<Circular | null> {
  const snap = await circularsCol(db, collegeId).doc(id).get();
  return snap.exists ? (snap.data() as Circular) : null;
}

export async function listCirculars(db: Firestore, collegeId: string, opts?: { status?: string; limit?: number }): Promise<Circular[]> {
  let q: FirebaseFirestore.Query = circularsCol(db, collegeId).orderBy("createdAt", "desc");
  if (opts?.status) q = q.where("status", "==", opts.status);
  if (opts?.limit) q = q.limit(opts.limit);
  const snap = await q.get();
  return snap.docs.map((d) => d.data() as Circular);
}

// Publish: flip status + fan-out notifications to audience.
// Audience expansion: teaching/non-teaching + departmentIds filter.
// Uses batched writes + per-recipient notify (non-fatal).
export async function publishCircular(
  db: Firestore,
  collegeId: string,
  circularId: string,
  actor: { uid: string; name: string }
): Promise<Circular> {
  const ref = circularsCol(db, collegeId).doc(circularId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error("NOT_FOUND");
  const circular = snap.data() as Circular;
  if (circular.status === "PUBLISHED") return circular;

  const now = new Date() as unknown as Circular["createdAt"];
  await ref.update({
    status: "PUBLISHED",
    publishedAt: now,
    publishedBy: actor.uid,
    publishedByName: actor.name,
    updatedAt: now,
  });

  const updated: Circular = { ...circular, status: "PUBLISHED", publishedAt: now, publishedBy: actor.uid, publishedByName: actor.name, updatedAt: now };

  // Audience expansion — best-effort notify.
  try {
    await notifyCircularAudience(db, collegeId, updated);
  } catch {
    /* non-fatal */
  }

  return updated;
}

async function notifyCircularAudience(db: Firestore, collegeId: string, circular: Circular): Promise<void> {
  if (circular.audience.recipientKind === "STUDENTS") {
    await notifyCircularStudents(db, collegeId, circular);
    return;
  }

  const collegeRef = db.collection("colleges").doc(collegeId);
  // Determine departments filter: empty = all
  const deptIds = circular.audience.departmentIds ?? [];
  // Build role recipients by employeeType
  // We notify both users (college-scoped) and, for teaching scope, facultyMembers with linked uids is covered via users.
  // For simplicity, fan-out to users collection filtered by audience.

  // Fetch all college users once (bounded college scale), filter in memory to avoid composite-index sprawl.
  const snap = await collegeRef.collection("users").get();
  const link = `/circulars/${circular.id}`;
  const title = circular.subject;
  const message = `${circular.messageFrom}: ${circular.subject}`;

  for (const doc of snap.docs) {
    const u = doc.data() as { role?: string; department?: string };
    const role = u.role as string | undefined;
    const dept = u.department as string | undefined;
    if (!role) continue;
    if (!employeeTypeMatches(role, circular.audience.employeeType)) continue;
    if (deptIds.length > 0) {
      // For teaching scope, need to check department match; for mixed departments, use department id vs name
      // audience departmentIds are ids; users store department name. Map via departments lookup if needed.
      // Here we match by id or name (tolerate both) to keep decoupled.
      const inDept = deptIds.includes(dept ?? "") || (circular.audience.departmentNames ?? []).includes(dept ?? "");
      if (!inDept) continue;
    }
    await notify(db, collegeId, doc.id, "CIRCULAR_PUBLISHED", title, message, link);
  }
}

// Students have no login/notification box (see CircularAudience's own
// doc-comment) - delivered by email instead, to whichever matched students
// actually have one on file. A student with no email recorded is simply
// skipped, same as the staff path silently skips a user doc with no role.
async function notifyCircularStudents(db: Firestore, collegeId: string, circular: Circular): Promise<void> {
  const collegeRef = db.collection("colleges").doc(collegeId);
  const years = circular.audience.targetYears ?? [];
  const deptIds = circular.audience.departmentIds ?? [];
  const deptNames = circular.audience.departmentNames ?? [];

  // Firestore "in" caps at 30 values - academic years are always a handful
  // (1..durationYears), nowhere close to that limit.
  let query: FirebaseFirestore.Query = collegeRef.collection("students").where("status", "==", "REGULAR");
  if (years.length > 0) query = query.where("year", "in", years);
  const snap = await query.get();

  const subject = circular.subject;
  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;line-height:1.6;color:#111">
      <p style="color:#555;font-size:13px;margin:0 0 12px">From: ${circular.messageFrom}</p>
      <h2 style="margin:0 0 12px">${circular.subject}</h2>
      <div style="white-space:pre-wrap">${circular.body}</div>
    </div>`;

  const sends: Promise<void>[] = [];
  for (const doc of snap.docs) {
    const s = doc.data() as { department?: string; email?: string };
    if (deptIds.length > 0 || deptNames.length > 0) {
      const inDept = deptIds.includes(s.department ?? "") || deptNames.includes(s.department ?? "");
      if (!inDept) continue;
    }
    const email = s.email?.trim();
    if (!email) continue;
    // Best-effort, one bad address must never block the rest of the batch.
    sends.push(sendMail({ to: email, subject, html }).catch((err) => {
      console.error(`[circular/notifyCircularStudents] Failed for ${doc.id}:`, err);
    }));
  }
  await Promise.all(sends);
}

// Download/print payload shape — keeps view and download in one schema.
export function toPrintableHtml(circular: Circular): string {
  const dateStr = (() => {
    try {
      const d = (circular.date as unknown as { toDate?: () => Date })?.toDate?.() ?? new Date(circular.date as unknown as string);
      return d.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", year: "numeric", month: "long", day: "numeric" });
    } catch {
      return "";
    }
  })();
  const attachments = circular.attachments?.map((a) => `<li><a href="${a.fileUrl}" target="_blank" rel="noreferrer">${a.fileName}</a></li>`).join("") ?? "";
  return `<!doctype html>
<html><head><meta charset="utf-8"/><title>${circular.subject}</title>
<style>body{font-family:Inter,system-ui,Arial,sans-serif;padding:40px;color:#111} .head{border-bottom:2px solid #111;padding-bottom:16px;margin-bottom:24px} .meta{color:#555;font-size:13px} .body{white-space:pre-wrap;line-height:1.6} @media print{.no-print{display:none}}</style>
</head><body>
<div class="head"><h1 style="margin:0">${circular.subject}</h1><div class="meta">From: ${circular.messageFrom} · Date: ${dateStr} · Circular ID: ${circular.id}</div></div>
<div class="body">${circular.body}</div>
${attachments ? `<h3>Attachments</h3><ul>${attachments}</ul>` : ""}
<div class="no-print" style="margin-top:32px"><button onclick="window.print()">Print</button> <a href="${circular.attachments?.[0]?.fileUrl ?? "#"}" download>Download attachment</a></div>
</body></html>`;
}
