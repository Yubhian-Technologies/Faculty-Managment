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
      OFFER_LETTER: "offer-letter.pdf",
      APPOINTMENT_LETTER: "appointment-letter.pdf",
      FINANCE_REPORT: "financial-report.pdf",
      FINANCE_RECEIPT: "finance-receipt.pdf",
      RESUME: "resume.pdf",
    };
    const filename = filenames[body.type];

    if (body.type === "OFFER_LETTER") {
      html = getOfferLetterHTML(body.data as Parameters<typeof getOfferLetterHTML>[0]);
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

    // Dynamic import via variable to avoid static bundling
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const puppeteerPkg = "puppeteer";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const puppeteer = await (import(/* webpackIgnore: true */ puppeteerPkg) as Promise<any>).catch(() => null);

    if (!puppeteer) {
      // Fallback: return HTML as a download if Puppeteer not available (Vercel)
      return new Response(html, {
        headers: {
          "Content-Type": "text/html",
          "Content-Disposition": `attachment; filename="${filename.replace(".pdf", ".html")}"`,
        },
      });
    }

    const browser = await puppeteer.default.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    const page = await browser.newPage();
    // A4 @ 96dpi — keeps the DOM layout width in sync with the printed page width so
    // content isn't laid out against Puppeteer's default 800x600 viewport and then
    // rescaled to fit A4 (the classic cause of PDFs rendering "shrunk" in a corner).
    await page.setViewport({ width: 794, height: 1123 });
    await page.setContent(html, { waitUntil: "networkidle0" });

    // The resume reads at normal font size and is free to spill onto additional pages —
    // give it real page margins so page breaks have breathing room. Other letter/report
    // templates are short, single-page documents designed around zero margin.
    const margin = body.type === "RESUME"
      ? { top: "12mm", bottom: "12mm", left: "0", right: "0" }
      : { top: "0", bottom: "0", left: "0", right: "0" };

    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      margin,
    });

    await browser.close();

    return new Response(pdfBuffer, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("[pdf/generate]", err);
    return NextResponse.json({ error: "PDF generation failed" }, { status: 500 });
  }
}
