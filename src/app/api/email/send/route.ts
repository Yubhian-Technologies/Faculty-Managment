export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { verifyFirebaseToken } from "@/lib/auth/verifyFirebaseToken";
import { interviewInvitationEmail, offerLetterEmail } from "@/lib/email/templates";
import { getOfferLetterHTML, type OfferLetterData } from "@/lib/pdf/offerLetterTemplate";

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
    const decoded = await verifyFirebaseToken(auth.slice(7));
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
      cc?: string[];
      subject?: string;
      data: Record<string, unknown>;
      pdfBase64?: string;
    };

    let html = "";
    let subject = body.subject ?? "Notification from FMS";
    let attachments: { filename: string; content: Buffer }[] | undefined;

    if (body.type === "INTERVIEW_INVITATION") {
      subject = `Interview Invitation — ${body.data.position as string}`;
      html = interviewInvitationEmail(body.data as Parameters<typeof interviewInvitationEmail>[0]);
    } else if (body.type === "OFFER_LETTER") {
      subject = `Offer Letter — ${body.data.collegeName as string}`;
      html = offerLetterEmail(body.data as Parameters<typeof offerLetterEmail>[0]);

      if (body.pdfBase64) {
        // Real PDF, rendered client-side (see src/lib/pdf/downloadOfferLetter.ts)
        // and shipped here as bytes — no headless-browser dependency server-side.
        attachments = [{ filename: "offer-letter.pdf", content: Buffer.from(body.pdfBase64, "base64") }];
      } else {
        // Fallback for any caller that hasn't been updated to send pdfBase64 —
        // matches the pre-PDF behavior exactly.
        const letterData = body.data as unknown as OfferLetterData & { position?: string };
        const letterHtml = getOfferLetterHTML({ ...letterData, designation: letterData.designation ?? letterData.position ?? "" });
        attachments = [{ filename: "offer-letter.html", content: Buffer.from(letterHtml, "utf8") }];
      }
    } else {
      html = `<p>${String(body.data.message ?? "")}</p>`;
    }

    // Send asynchronously — don't await in prod for faster API response
    transporter.sendMail({
      from: `"${process.env.EMAIL_FROM_NAME ?? "Vishnu People"}" <${process.env.EMAIL_FROM}>`,
      to: body.to,
      ...(body.cc?.length ? { cc: body.cc } : {}),
      subject,
      html,
      attachments,
    }).catch((err) => console.error("[email/send] Failed:", err));

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[email/send]", err);
    return NextResponse.json({ error: "Failed to send email" }, { status: 500 });
  }
}
