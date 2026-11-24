export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { writeAuditLogSafe } from "@/lib/audit/safeAuditLog";
import { sendMail } from "@/lib/email/mailer";
import { interviewInvitationEmail } from "@/lib/email/templates";
import { dmy, toDate } from "@/lib/utils";
import { istDateKey } from "@/lib/attendance/istTime";

// POST: email every candidate of an interview batch their invitation (date and time, venue or online link, the
// documents to bring). HR, the batch's HOD or the Principal / VP; only once the Principal has approved the batch and
// before the interview starts. Sending again re-sends to everyone (e.g. after a reschedule). Records when and by whom.

const PLATFORM: Record<string, string> = { GOOGLE_MEET: "Google Meet", ZOOM: "Zoom", MICROSOFT_TEAMS: "Microsoft Teams", OTHER: "Online" };
const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireCollegeMember("HR", "HOD", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN");
    const { id } = await params;
    const db = getAdminDb();
    const college = db.collection("colleges").doc(session.collegeId);
    const snap = await college.collection("hiringBatches").doc(id).get();
    if (!snap.exists) return NextResponse.json({ error: "Interview batch not found. It may have been deleted." }, { status: 404 });
    const b = snap.data() as {
      hodUid?: string; status?: string; currentPhase?: string; position?: string; department?: string; applicationIds?: string[];
      interviewDate?: unknown; interviewTime?: string; interviewVenue?: string; hiringMode?: string; meetingPlatform?: string; meetingLink?: string; requiredDocuments?: string[];
    };
    if (session.role === "HOD" && b.hodUid !== session.uid) {
      return NextResponse.json({ error: "You do not have access to this action." }, { status: 403 });
    }
    if (b.status !== "APPROVED") return NextResponse.json({ error: "Send the invitations once the Principal has approved the interview." }, { status: 409 });
    if (!["HOD_FINAL_SETUP", "INTERVIEW_READY"].includes(b.currentPhase ?? "")) {
      return NextResponse.json({ error: "The interview has already started or finished." }, { status: 409 });
    }
    const online = b.hiringMode === "ONLINE";
    if (online && !b.meetingLink) return NextResponse.json({ error: "Add the online meeting link first." }, { status: 400 });
    if (!online && !b.interviewVenue) return NextResponse.json({ error: "Add the interview venue first." }, { status: 400 });

    const appIds = b.applicationIds ?? [];
    const apps = appIds.length ? await db.getAll(...appIds.map((a) => college.collection("candidateApplications").doc(a))) : [];
    const candIds = [...new Set(apps.map((a) => a.get("candidateId") as string | undefined).filter((x): x is string => !!x))];
    const cands = candIds.length ? await db.getAll(...candIds.map((c) => college.collection("candidates").doc(c))) : [];
    const [collegeSnap, me] = await Promise.all([college.get(), college.collection("users").doc(session.uid).get()]);
    const collegeName = String(collegeSnap.get("name") ?? "");
    const contactEmail = String(me.get("email") ?? process.env.EMAIL_FROM ?? "");
    const date = toDate(b.interviewDate as never);
    const when = `${date ? dmy(istDateKey(date)) : ""}${b.interviewTime ? `, ${b.interviewTime}` : ""}`;
    const venue = online ? `${PLATFORM[b.meetingPlatform ?? ""] ?? "Online"}: ${b.meetingLink}` : String(b.interviewVenue);

    let sent = 0;
    const failed: string[] = [];
    for (const c of cands) {
      const email = String(c.get("email") ?? "").trim();
      const name = String(c.get("name") ?? "");
      if (!email) { failed.push(name); continue; }
      try {
        await sendMail({
          to: email,
          subject: `Interview Invitation - ${b.position ?? ""}, ${collegeName}`,
          html: interviewInvitationEmail({
            candidateName: esc(name), position: esc(b.position), department: esc(b.department), interviewDate: esc(when),
            venue: esc(venue), documents: (b.requiredDocuments ?? []).map(esc), collegeName: esc(collegeName), contactEmail: esc(contactEmail),
          }),
        });
        sent += 1;
      } catch (e) {
        console.error("[hiring-batches/invitations] send failed", e);
        failed.push(name);
      }
    }
    const actor = String(me.get("name") ?? "Unknown");
    const now = new Date();
    await snap.ref.update({ invitationsSentAt: now, invitationsSentByName: actor, invitationsSentCount: sent, updatedAt: now });
    await writeAuditLogSafe(db, session.collegeId, { action: "INTERVIEW_INVITATIONS_SENT", performedBy: session.uid, performedByName: actor, targetId: id, details: { sent, failed: failed.length } });
    return NextResponse.json({ sent, failed });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "You do not have access, or your session has expired. Sign in again to continue." }, { status: 401 });
    }
    console.error("[college/hiring-batches/[id]/invitations POST]", err);
    return NextResponse.json({ error: "Unable to complete the request. Try again; if it continues, contact the administrator." }, { status: 500 });
  }
}
