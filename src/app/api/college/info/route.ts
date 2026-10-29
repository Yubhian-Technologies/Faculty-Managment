export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeContext } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { resolveCollegeAcademicYear } from "@/lib/college/collegeAcademicYear";

import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { writeAuditLogSafe } from "@/lib/audit/safeAuditLog";
import { readSignatureGroups, selectedSignatureRows } from "@/lib/timetable/signatureAuthority";

export async function GET(request: Request) {
  try {
    // Every college-scoped role reads the same public-facing identity block
    // (name/code/affiliation/address/phone/logo) - it powers the letterhead on
    // every generated report and PDF, so a role missing from this list renders
    // the literal fallback "College" instead of its own institution's name
    // (see useCollegeInfo + InstitutionalTimetableTable's own fallbacks).
    // CLASS_LEADER used to be absent here, which is what left the class
    // leader's timetable grid, PDF and XLS export headerless.
    const session = await requireCollegeContext(
      request,
      "PRINCIPAL", "VICE_PRINCIPAL", "HOD", "SUPER_ADMIN", "COLLEGE_OFFICE", "PANEL_MEMBER", "ACCOUNTS", "COLLEGE_ACCOUNTS", "FINANCE", "PURCHASE_DEPT",
      "COLLEGE_STAFF", "ACADEMICS", "IQAC_COORDINATOR", "T_AND_P", "R_AND_D", "PLACEMENT_DEPT", "LIBRARY", "EXAM_CELL", "WEBMASTER", "STUDENT",
      "CLASS_LEADER"
    );
    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);
    const [snap, sigSnap, loadSigSnap] = await Promise.all([
      collegeRef.get(),
      collegeRef.collection("settings").doc("timetableSignatures").get(),
      collegeRef.collection("settings").doc("teachingLoadSignatures").get(),
    ]);
    const sigGroups = readSignatureGroups(sigSnap.exists ? sigSnap.data()?.groups : []);
    const loadSigGroups = readSignatureGroups(loadSigSnap.exists ? loadSigSnap.data()?.groups : []);
    const data = snap.data() as {
      name?: string;
      code?: string;
      affiliation?: string;
      phone?: string;
      contactPhone?: string;
      email?: string;
      contactEmail?: string;
      address?: string;
      type?: string;
      logoUrl?: string;
    } | undefined;

    // The college's city (its location's city) - printed beside the college name on timetables.
    let city = "";
    const locationId = (snap.data() as { locationId?: string } | undefined)?.locationId;
    if (locationId) {
      try {
        const loc = await db.collection("locations").doc(locationId).get();
        city = ((loc.data() as { city?: string } | undefined)?.city ?? "").trim();
      } catch (err) {
        console.error("[college/info GET] location lookup", err);
      }
    }

    const rawLogo = data?.logoUrl?.trim() ?? "";
    const isCustom = Boolean(rawLogo && rawLogo !== "/vishnulogo.png");
    const logoUrl = isCustom ? rawLogo : "/vishnulogo.png";

    // The college's current academic year ("2026-27") - printed on exam documents.
    let academicYear = "";
    try { academicYear = await resolveCollegeAcademicYear(db, session.collegeId); } catch { /* left blank */ }

    return NextResponse.json({
      name: data?.name ?? "",
      academicYear,
      code: data?.code ?? "",
      affiliation: data?.affiliation ?? "",
      phone: data?.contactPhone || data?.phone || "",
      email: data?.contactEmail || data?.email || "",
      address: data?.address ?? "",
      city,
      type: data?.type,
      logoUrl,
      hasCustomLogo: isCustom,
      rawLogoUrl: rawLogo,
      timetableSignatureRows: selectedSignatureRows(sigGroups),
      teachingLoadSignatureRows: selectedSignatureRows(loadSigGroups),
    });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/info GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const session = await requireCollegeContext(
      request,
      "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN"
    );
    const body = (await readJsonBody(request)) as { logoUrl?: string | null };
    const db = getAdminDb();

    const raw = typeof body.logoUrl === "string" ? body.logoUrl.trim() : "";
    // If empty string, null, or matching the default path, clear it to "" so it defaults to /vishnulogo.png
    const newLogo = raw === "/vishnulogo.png" || !raw ? "" : raw;

    await db.collection("colleges").doc(session.collegeId).update({
      logoUrl: newLogo,
      updatedAt: new Date(),
    });

    await writeAuditLogSafe(db, session.collegeId, {
      action: "COLLEGE_SETTINGS_UPDATED",
      performedBy: session.uid,
      targetId: session.collegeId,
      details: {
        field: "logoUrl",
        logoUrl: newLogo || "DEFAULT_VISHNU_LOGO",
      },
    });

    return NextResponse.json({
      ok: true,
      logoUrl: newLogo || "/vishnulogo.png",
      hasCustomLogo: Boolean(newLogo),
    });
  } catch (err) {
    const badBody = badBodyResponse(err);
    if (badBody) return badBody;
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/info PATCH]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
