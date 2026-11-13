export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { verificationsCol } from "@/lib/certifications/store";

// The QR check on a printed certificate: anyone holding the code sees whether it is genuine - the number, the
// certificate, the student's name and Regd. No, the college and the date - and whether it was revoked. Nothing
// else of the student is returned, and an unknown code says only that.
export async function GET(_request: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await params;
    if (!/^[A-Z0-9]{6,16}$/.test(code)) return NextResponse.json({ valid: false }, { status: 404 });
    const snap = await verificationsCol(getAdminDb()).doc(code).get();
    if (!snap.exists) return NextResponse.json({ valid: false }, { status: 404 });
    const d = snap.data() as {
      certificateNumber: string; typeName: string; studentName: string; studentRollNumber: string; collegeName: string; issuedAt: string;
      revoked?: { at: string; reason: string } | null;
    };
    return NextResponse.json({
      valid: !d.revoked,
      certificate: {
        certificateNumber: d.certificateNumber, typeName: d.typeName, studentName: d.studentName, studentRollNumber: d.studentRollNumber,
        collegeName: d.collegeName, issuedAt: d.issuedAt, revokedAt: d.revoked?.at ?? null,
      },
    });
  } catch (err) {
    console.error("[public/certificate-verify GET]", err);
    return NextResponse.json({ error: "Unable to complete the request. Try again; if it continues, contact the administrator." }, { status: 500 });
  }
}
