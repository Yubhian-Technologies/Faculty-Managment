export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { verifyFirebaseToken } from "@/lib/auth/verifyFirebaseToken";
import { getOfferLetterHTML, getAppointmentLetterHTML } from "@/lib/pdf/offerLetterTemplate";

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
      type: "OFFER_LETTER" | "APPOINTMENT_LETTER";
      data: Record<string, unknown>;
    };

    let html = "";
    const filename =
      body.type === "OFFER_LETTER" ? "offer-letter.pdf" : "appointment-letter.pdf";

    if (body.type === "OFFER_LETTER") {
      html = getOfferLetterHTML(body.data as Parameters<typeof getOfferLetterHTML>[0]);
    } else {
      html = getAppointmentLetterHTML(
        body.data as Parameters<typeof getAppointmentLetterHTML>[0]
      );
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
    await page.setContent(html, { waitUntil: "networkidle0" });

    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "0", bottom: "0", left: "0", right: "0" },
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
