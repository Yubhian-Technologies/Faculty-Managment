import nodemailer from "nodemailer";

// Single shared transporter - lazily created so a route/service that never
// sends email never pays for constructing one, and one env-var read pulls
// double duty across every caller instead of each rebuilding it.
let transporter: nodemailer.Transporter | null = null;
function getTransporter(): nodemailer.Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }
  return transporter;
}

export interface SendMailOptions {
  to: string;
  cc?: string[];
  subject: string;
  html: string;
  attachments?: { filename: string; content: Buffer }[];
}

// Server-side send, for callers running inside an API route/service that
// already know they're allowed to send (e.g. a just-authorized circular
// publish) - unlike /api/email/send, this has no Bearer-token check of its
// own, so it must never be exposed directly to the client.
export async function sendMail(opts: SendMailOptions): Promise<void> {
  await getTransporter().sendMail({
    from: `"${process.env.EMAIL_FROM_NAME ?? "Vishnu People"}" <${process.env.EMAIL_FROM}>`,
    to: opts.to,
    ...(opts.cc?.length ? { cc: opts.cc } : {}),
    subject: opts.subject,
    html: opts.html,
    attachments: opts.attachments,
  });
}
