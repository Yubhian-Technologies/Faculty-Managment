export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { verifyFirebaseToken } from "@/lib/auth/verifyFirebaseToken";
import { interviewInvitationEmail, offerLetterEmail, appointmentLetterEmail } from "@/lib/email/templates";
import { getOfferLetterHTML, getAppointmentLetterHTML, type OfferLetterData } from "@/lib/pdf/offerLetterTemplate";
import { sendMail } from "@/lib/email/mailer";
import { assertTokenActive } from "@/lib/auth/assertTokenActive";
import { rateLimit } from "@/lib/security/rateLimit";

// Offers, appointment letters and interview invitations are sent by the hiring roles only. The
// route used to accept any valid sign-in, a student included, with caller-chosen recipients.
const SENDER_ROLES = new Set([
  "SUPER_ADMIN", "ADMINISTRATION", "HR_ADMIN", "ADMIN_OFFICE", "LOCATION_DEPT_HEAD",
  "PRINCIPAL", "VICE_PRINCIPAL", "COLLEGE_ADMIN", "DIRECTOR", "COLLEGE_OFFICE", "HOD",
]);
const MAX_RECIPIENTS = 10;
const EMAIL_RE = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/;

async function verifyToken(request: Request): Promise<{ uid: string; role: string } | null> {
  const auth = request.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  try {
    const decoded = await verifyFirebaseToken(auth.slice(7));
    if (!(await assertTokenActive(decoded.uid, decoded.iat))) return null;
    return { uid: decoded.uid, role: String(decoded.role ?? "") };
  } catch {
    return null;
  }
}

const escapeHtml = (v: unknown) =>
  String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export async function POST(request: Request) {
  const caller = await verifyToken(request);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!SENDER_ROLES.has(caller.role)) return NextResponse.json({ error: "Not allowed to send email" }, { status: 403 });
  const limited = rateLimit(`email-send:${caller.uid}`, 30, 60 * 60 * 1000);
  if (!limited.ok) {
    return NextResponse.json({ error: "Too many emails - try again later" }, { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds) } });
  }

  try {
    const body = (await request.json()) as {
      type: "INTERVIEW_INVITATION" | "OFFER_LETTER" | "APPOINTMENT_LETTER" | "GENERAL";
      to: string;
      cc?: string[];
      subject?: string;
      data: Record<string, unknown>;
      pdfBase64?: string;
    };

    let html = "";
    let subject = body.subject ?? "Notification from FMS";
    let attachments: { filename: string; content: Buffer }[] | undefined;

    if (body.type === "INTERVIEW_INVITATION") {
      subject = `Interview Invitation - ${body.data.position as string}`;
      html = interviewInvitationEmail(body.data as Parameters<typeof interviewInvitationEmail>[0]);
    } else if (body.type === "OFFER_LETTER") {
      subject = `Offer Letter - ${body.data.collegeName as string}`;
      html = offerLetterEmail(body.data as Parameters<typeof offerLetterEmail>[0]);

      if (body.pdfBase64) {
        // Real PDF, rendered client-side (see src/lib/pdf/downloadOfferLetter.ts)
        // and shipped here as bytes - no headless-browser dependency server-side.
        attachments = [{ filename: "offer-letter.pdf", content: Buffer.from(body.pdfBase64, "base64") }];
      } else {
        // Fallback for any caller that hasn't been updated to send pdfBase64 -
        // matches the pre-PDF behavior exactly.
        const letterData = body.data as unknown as OfferLetterData & { position?: string };
        const letterHtml = getOfferLetterHTML({ ...letterData, designation: letterData.designation ?? letterData.position ?? "" });
        attachments = [{ filename: "offer-letter.html", content: Buffer.from(letterHtml, "utf8") }];
      }
    } else if (body.type === "APPOINTMENT_LETTER") {
      subject = `Appointment Letter - ${body.data.collegeName as string}`;
      html = appointmentLetterEmail(body.data as Parameters<typeof appointmentLetterEmail>[0]);

      if (body.pdfBase64) {
        attachments = [{ filename: "appointment-letter.pdf", content: Buffer.from(body.pdfBase64, "base64") }];
      } else {
        const letterHtml = getAppointmentLetterHTML(body.data as unknown as Parameters<typeof getAppointmentLetterHTML>[0]);
        attachments = [{ filename: "appointment-letter.html", content: Buffer.from(letterHtml, "utf8") }];
      }
    } else {
      html = `<p>${escapeHtml(body.data?.message)}</p>`;
    }

    const recipients = [body.to, ...(body.cc ?? [])];
    if (!body.to || recipients.length > MAX_RECIPIENTS || recipients.some((r) => typeof r !== "string" || !EMAIL_RE.test(r))) {
      return NextResponse.json({ error: "Invalid recipient list" }, { status: 400 });
    }

    // Send asynchronously - don't await in prod for faster API response
    sendMail({ to: body.to, cc: body.cc, subject, html, attachments })
      .catch((err) => console.error("[email/send] Failed:", err));

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[email/send]", err);
    return NextResponse.json({ error: "Failed to send email" }, { status: 500 });
  }
}
