export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { clientIp, rateLimit } from "@/lib/security/rateLimit";
import { publicApplicationSchema } from "@/lib/validations";

// Public careers page: lists a college's open positions and takes self-applications.
// Runs server-side (Admin SDK) so Firestore rules can stay closed to browsers - the page used to
// read vacancyRequests and write candidates/candidateApplications directly from the visitor's browser.

type Params = { params: Promise<{ collegeId: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { collegeId } = await params;
  try {
    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(collegeId);
    const collegeSnap = await collegeRef.get();
    if (!collegeSnap.exists) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const snap = await collegeRef.collection("vacancyRequests").where("status", "==", "APPROVED").get();
    // Only what the page shows - never the requester or internal notes.
    const openings = snap.docs.map((d) => {
      const v = d.data() as { position?: string; department?: string; requiredCount?: number };
      return { id: d.id, position: v.position ?? "", department: v.department ?? "", requiredCount: v.requiredCount ?? 1 };
    });
    return NextResponse.json({ college: { id: collegeSnap.id, name: collegeSnap.get("name") ?? "" }, openings });
  } catch (err) {
    console.error("[public/careers GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: Params) {
  const { collegeId } = await params;
  const limited = rateLimit(`careers-apply:${clientIp(request)}`, 20, 3600000);
  if (!limited.ok) {
    return NextResponse.json({ error: "Too many requests - please try again later" }, { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds) } });
  }
  try {
    const body = (await readJsonBody(request)) as { vacancyRequestId?: string; resumeUrl?: string } & Record<string, unknown>;
    const parsed = publicApplicationSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid application" }, { status: 400 });
    }
    const vacancyRequestId = String(body.vacancyRequestId ?? "");
    const resumeUrl = String(body.resumeUrl ?? "");
    if (!vacancyRequestId) return NextResponse.json({ error: "Select a position" }, { status: 400 });
    // The resume is uploaded straight to Storage by the page; only accept a link into this college's resumes folder.
    if (!resumeUrl.startsWith("https://") || !decodeURIComponent(resumeUrl).includes(`colleges/${collegeId}/resumes/`)) {
      return NextResponse.json({ error: "Resume is required" }, { status: 400 });
    }

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(collegeId);
    const vacancySnap = await collegeRef.collection("vacancyRequests").doc(vacancyRequestId).get();
    if (!vacancySnap.exists || vacancySnap.get("status") !== "APPROVED") {
      return NextResponse.json({ error: "This position is no longer open" }, { status: 409 });
    }

    const now = new Date();
    const candidateRef = collegeRef.collection("candidates").doc();
    const applicationRef = collegeRef.collection("candidateApplications").doc();
    const batch = db.batch();
    batch.set(candidateRef, {
      name: parsed.data.name,
      email: parsed.data.email,
      phone: parsed.data.phone,
      resumeUrl,
      source: "CAREERS_PAGE",
      addedByUid: "",
      addedByName: "Careers Page (self-applied)",
      collegeId,
      createdAt: now,
      updatedAt: now,
    });
    batch.set(applicationRef, {
      candidateId: candidateRef.id,
      vacancyRequestId,
      batchId: "",
      department: vacancySnap.get("department") ?? "",
      position: vacancySnap.get("position") ?? "",
      currentStage: "DEMO",
      status: "PENDING",
      isShortlisted: false,
      hasArrived: false,
      addedByUid: "",
      addedByName: "Careers Page (self-applied)",
      collegeId,
      createdAt: now,
      updatedAt: now,
    });
    await batch.commit();
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (err) {
    const bad = badBodyResponse(err);
    if (bad) return bad;
    console.error("[public/careers POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
