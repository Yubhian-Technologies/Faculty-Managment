export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { verifyFirebaseToken } from "@/lib/auth/verifyFirebaseToken";
import { getOfferLetterHTML, getAppointmentLetterHTML } from "@/lib/pdf/offerLetterTemplate";
import { getFinanceReportHTML, getFinanceReceiptHTML } from "@/lib/pdf/financeReportTemplate";
import { getResumeHTML } from "@/lib/pdf/resumeTemplate";

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

// Serves the letter/report/resume as an HTML document - no headless-browser
// dependency (Puppeteer et al.) server-side, so this works identically on any
// serverless host with zero native binaries, cold-start cost, or version pinning.
// Offer/appointment letters and finance reports are downloaded as this HTML directly
// (the browser can print it to a real PDF - Ctrl/Cmd+P → Save as PDF - with the exact
// same layout). The resume is the one exception: its client (downloadResumePdf /
// src/lib/pdf/htmlToPdf.ts) converts this same HTML into a real .pdf file in the
// browser via html2canvas + jsPDF before downloading it.
export async function POST(request: Request) {
  const uid = await verifyToken(request);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = (await request.json()) as {
      type: "OFFER_LETTER" | "APPOINTMENT_LETTER" | "FINANCE_REPORT" | "FINANCE_RECEIPT" | "RESUME";
      data: Record<string, unknown>;
    };

    let html = "";
    const filenames: Record<typeof body.type, string> = {
      OFFER_LETTER: "offer-letter.html",
      APPOINTMENT_LETTER: "appointment-letter.html",
      FINANCE_REPORT: "financial-report.html",
      FINANCE_RECEIPT: "finance-receipt.html",
      RESUME: "resume.html",
    };
    const filename = filenames[body.type];

    if (body.type === "OFFER_LETTER") {
      html = getOfferLetterHTML(body.data as unknown as Parameters<typeof getOfferLetterHTML>[0]);
    } else if (body.type === "APPOINTMENT_LETTER") {
      html = getAppointmentLetterHTML(
        body.data as Parameters<typeof getAppointmentLetterHTML>[0]
      );
    } else if (body.type === "FINANCE_REPORT") {
      html = getFinanceReportHTML(body.data as Parameters<typeof getFinanceReportHTML>[0]);
    } else if (body.type === "FINANCE_RECEIPT") {
      html = getFinanceReceiptHTML(body.data as Parameters<typeof getFinanceReceiptHTML>[0]);
    } else {
      html = getResumeHTML(body.data as unknown as Parameters<typeof getResumeHTML>[0]);
    }

    return new Response(html, {
      headers: {
        "Content-Type": "text/html",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("[pdf/generate]", err);
    return NextResponse.json({ error: "Document generation failed" }, { status: 500 });
  }
}
