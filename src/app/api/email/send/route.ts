export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { adminAuth } from "@/lib/firebase/admin";
import { interviewInvitationEmail, offerLetterEmail } from "@/lib/email/templates";

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT ?? 587),
  secure: Number(process.env.SMTP_PORT) === 465,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

async function verifyToken(request: Request): Promise<string | null> {
  const auth = request.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  try {
    const decoded = await adminAuth.verifyIdToken(auth.slice(7));
    return decoded.uid;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const uid = await verifyToken(request);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = (await request.json()) as {
      type: "INTERVIEW_INVITATION" | "OFFER_LETTER" | "GENERAL";
      to: string;
      subject?: string;
      data: Record<string, unknown>;
    };

    let html = "";
    let subject = body.subject ?? "Notification from FMS";

    if (body.type === "INTERVIEW_INVITATION") {
      subject = `Interview Invitation — ${body.data.position as string}`;
      html = interviewInvitationEmail(body.data as Parameters<typeof interviewInvitationEmail>[0]);
    } else if (body.type === "OFFER_LETTER") {
      subject = `Offer Letter — ${body.data.collegeName as string}`;
      html = offerLetterEmail(body.data as Parameters<typeof offerLetterEmail>[0]);
    } else {
      html = `<p>${String(body.data.message ?? "")}</p>`;
    }

    // Send asynchronously — don't await in prod for faster API response
    transporter.sendMail({
      from: `"${process.env.EMAIL_FROM_NAME ?? "FMS"}" <${process.env.EMAIL_FROM}>`,
      to: body.to,
      subject,
      html,
    }).catch((err) => console.error("[email/send] Failed:", err));

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[email/send]", err);
    return NextResponse.json({ error: "Failed to send email" }, { status: 500 });
  }
}
