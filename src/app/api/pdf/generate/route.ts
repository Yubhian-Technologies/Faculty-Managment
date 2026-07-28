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

async function htmlToPdf(html: string): Promise<Buffer | null> {
  try {
    const puppeteer = await import("puppeteer");
    const browser = await puppeteer.default.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: "networkidle0" });
      const pdf = await page.pdf({ format: "A4", printBackground: true });
      return Buffer.from(pdf);
    } finally {
      await browser.close();
    }
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const uid = await verifyToken(request);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = (await request.json()) as {
      type: "OFFER_LETTER" | "APPOINTMENT_LETTER" | "FINANCE_REPORT" | "FINANCE_RECEIPT" | "RESUME";
      data: Record<string, unknown>;
    };

    const filenames: Record<typeof body.type, string> = {
      OFFER_LETTER: "offer-letter",
      APPOINTMENT_LETTER: "appointment-letter",
      FINANCE_REPORT: "financial-report",
      FINANCE_RECEIPT: "finance-receipt",
      RESUME: "resume",
    };
    const baseName = filenames[body.type];

    let html = "";
    if (body.type === "OFFER_LETTER") {
      html = getOfferLetterHTML(body.data as unknown as Parameters<typeof getOfferLetterHTML>[0]);
    } else if (body.type === "APPOINTMENT_LETTER") {
      html = getAppointmentLetterHTML(body.data as Parameters<typeof getAppointmentLetterHTML>[0]);
    } else if (body.type === "FINANCE_REPORT") {
      html = getFinanceReportHTML(body.data as Parameters<typeof getFinanceReportHTML>[0]);
    } else if (body.type === "FINANCE_RECEIPT") {
      html = getFinanceReceiptHTML(body.data as Parameters<typeof getFinanceReceiptHTML>[0]);
    } else {
      html = getResumeHTML(body.data as unknown as Parameters<typeof getResumeHTML>[0]);
    }

    const pdfBuffer = await htmlToPdf(html);

    if (pdfBuffer) {
      return new Response(pdfBuffer, {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${baseName}.pdf"`,
          "Cache-Control": "no-store",
        },
      });
    }

    // Puppeteer unavailable — return HTML so the user can print-to-PDF
    return new Response(html, {
      headers: {
        "Content-Type": "text/html",
        "Content-Disposition": `attachment; filename="${baseName}.html"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("[pdf/generate]", err);
    return NextResponse.json({ error: "Document generation failed" }, { status: 500 });
  }
}
