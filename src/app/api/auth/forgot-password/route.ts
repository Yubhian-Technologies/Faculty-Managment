export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { checkRateLimit, clientIp } from "@/lib/security/rateLimit";
import { findFacultyLoginUid, MAX_EMPLOYEE_ID_LENGTH } from "@/lib/faculty/loginLookup";
import { studentRollDocId, studentRollKey } from "@/lib/students/loginDefaults";
import { sendMail } from "@/lib/email/mailer";

// Login > Forgot Password (public). POST { identifier } - what the person signs in with:
//   an email        the reset link goes to that address (a students.internal placeholder never receives mail);
//   an Employee ID  the faculty login's email;
//   a Regd. No      the student's login, sent to the EMAIL ON THEIR STUDENT RECORD (their sign-in address is an
//                   internal placeholder that cannot receive mail).
// The answer is always the same, whether or not an account matched, so this can't be used to learn who has an
// account; rate limited per address and per identifier like the other sign-in endpoints. The link is Firebase's
// own password reset link (generatePasswordResetLink), sent by the app's mail (SMTP).

const IP_LIMIT = 10;
const KEY_LIMIT = 3;
const WINDOW_MS = 15 * 60_000;
const SENT = { ok: true, message: "If an account matches, a password reset link has been sent to its email. Students: it goes to the email on your student record." };
const isPlaceholder = (email: string) => /@students\.internal$/i.test(email);
const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** The Auth login to reset and where to send the link, or null when nothing matches / nowhere to send. */
async function resolve(identifier: string): Promise<{ loginEmail: string; sendTo: string; name: string } | null> {
  const auth = await getAdminAuth();
  const db = getAdminDb();
  if (identifier.includes("@")) {
    if (!isEmail(identifier) || isPlaceholder(identifier)) return null;
    const u = await auth.getUserByEmail(identifier.toLowerCase()).catch(() => null);
    return u?.email ? { loginEmail: u.email, sendTo: u.email, name: u.displayName ?? "" } : null;
  }
  if (identifier.length <= MAX_EMPLOYEE_ID_LENGTH) {
    const uid = await findFacultyLoginUid(db, identifier).catch(() => null);
    if (uid) {
      const u = await auth.getUser(uid).catch(() => null);
      if (u?.email && !isPlaceholder(u.email)) return { loginEmail: u.email, sendTo: u.email, name: u.displayName ?? "" };
      return null;
    }
  }
  // Student Regd. No: the global registry gives the login + the student record, whose own email gets the link.
  if (!studentRollKey(identifier)) return null;
  const reg = (await db.collection("studentUsernames").doc(studentRollDocId(identifier)).get()).data() as
    { active?: boolean; loginEmail?: string; uid?: string; collegeId?: string; studentDocId?: string } | undefined;
  if (!reg || reg.active === false || !reg.collegeId || !reg.studentDocId) return null;
  const student = (await db.collection("colleges").doc(reg.collegeId).collection("students").doc(reg.studentDocId).get()).data() as { email?: string; name?: string; uid?: string } | undefined;
  const sendTo = String(student?.email ?? "").trim().toLowerCase();
  if (!student || !isEmail(sendTo)) return null;
  const uid = reg.uid ?? student.uid;
  const u = uid ? await auth.getUser(uid).catch(() => null) : reg.loginEmail ? await auth.getUserByEmail(reg.loginEmail).catch(() => null) : null;
  return u?.email ? { loginEmail: u.email, sendTo, name: student.name ?? "" } : null;
}

export async function POST(request: Request) {
  try {
    const perIp = checkRateLimit(`forgot-password:ip:${clientIp(request)}`, IP_LIMIT, WINDOW_MS);
    if (!perIp.allowed) return NextResponse.json({ error: "Too many requests. Try again in a few minutes." }, { status: 429, headers: { "Retry-After": String(perIp.retryAfterSeconds) } });
    const body = (await readJsonBody(request)) as { identifier?: unknown };
    const identifier = typeof body?.identifier === "string" ? body.identifier.trim() : "";
    if (!identifier) return NextResponse.json({ error: "Enter your email, Employee ID or Regd. No." }, { status: 400 });
    if (identifier.length > 254) return NextResponse.json({ error: "That is too long." }, { status: 400 });
    const perKey = checkRateLimit(`forgot-password:key:${identifier.toLowerCase()}`, KEY_LIMIT, WINDOW_MS);
    if (!perKey.allowed) return NextResponse.json(SENT); // same answer - never reveals anything

    const target = await resolve(identifier);
    if (target) {
      const base = (process.env.APP_URL ?? new URL(request.url).origin).replace(/\/+$/, "");
      const link = await (await getAdminAuth()).generatePasswordResetLink(target.loginEmail, { url: `${base}/login` });
      await sendMail({
        to: target.sendTo,
        subject: "Reset your Vishnu People password",
        html: `<p>Dear ${esc(target.name || "user")},</p>
<p>We received a request to reset the password of your Vishnu People account. Click the link below to choose a new password:</p>
<p><a href="${esc(link)}">Reset my password</a></p>
<p>The link works once and expires in about an hour. If you did not ask for this, ignore this email - your password stays as it is.</p>
<p>Vishnu People</p>`,
      }).catch((e) => { console.error("[auth/forgot-password] mail", e); });
    }
    return NextResponse.json(SENT);
  } catch (err) {
    const bad = badBodyResponse(err);
    if (bad) return bad;
    console.error("[auth/forgot-password POST]", err);
    return NextResponse.json({ error: "Unable to complete the request. Try again; if it continues, contact the administrator." }, { status: 500 });
  }
}
