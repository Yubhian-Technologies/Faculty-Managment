export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { toDate } from "@/lib/utils";
import { istDateKey } from "@/lib/attendance/istTime";
import { nowInIndia } from "@/lib/leave/dayCounter";

// HR dashboard (HR; the Principal / VP may read it too): the college's recruitment at a glance - open posts by
// department, where every application stands, interviews this week, offers waiting for an answer, joining this
// month and the average days from an approved hiring request to the selection. One read of each hiring collection.

type Doc = Record<string, unknown> & { id: string };
const dayKey = (v: unknown) => { const d = toDate(v as never); return d ? istDateKey(d) : null; };

export async function GET() {
  try {
    const session = await requireCollegeMember("HR", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN");
    const college = getAdminDb().collection("colleges").doc(session.collegeId);
    const [vSnap, aSnap, bSnap, oSnap] = await Promise.all([
      college.collection("vacancyRequests").get(),
      college.collection("candidateApplications").get(),
      college.collection("hiringBatches").select("department", "position", "interviewDate", "currentPhase", "status", "vacancyRequestId").get(),
      college.collection("offerLetters").select("status", "joiningDate", "candidateName", "department", "designation", "candidateConfirmedJoiningDate").get(),
    ]);
    const all = (s: FirebaseFirestore.QuerySnapshot) => s.docs.map((d) => ({ id: d.id, ...d.data() }) as Doc);
    const vacancies = all(vSnap), apps = all(aSnap), batches = all(bSnap), offers = all(oSnap);
    const today = nowInIndia().dateISO;
    const month = today.slice(0, 7);
    const weekEnd = (() => { const d = new Date(`${today}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 6); return d.toISOString().slice(0, 10); })();

    const stageOf = (a: Doc) => {
      if (a.status === "APPROVED") return "SELECTED";
      if (a.status === "REJECTED") return "REJECTED";
      const sc = a.screening as { result?: string } | undefined;
      if (sc?.result === "NOT_SUITABLE") return "NOT_SUITABLE";
      if (a.batchId) return "INTERVIEW";
      if (a.isShortlisted) return "SHORTLISTED";
      return "TO_SCREEN";
    };
    const stages: Record<string, number> = { TO_SCREEN: 0, SHORTLISTED: 0, INTERVIEW: 0, SELECTED: 0, NOT_SUITABLE: 0, REJECTED: 0 };
    const byVacancy = new Map<string, Record<string, number>>();
    for (const a of apps) {
      const st = stageOf(a);
      stages[st] += 1;
      const v = String(a.vacancyRequestId ?? "");
      const cur = byVacancy.get(v) ?? { total: 0, TO_SCREEN: 0, SHORTLISTED: 0, INTERVIEW: 0, SELECTED: 0 };
      cur.total += 1;
      if (st in cur) cur[st] += 1;
      byVacancy.set(v, cur);
    }

    const open = vacancies
      .filter((v) => v.status === "APPROVED" && Number(v.requiredCount ?? 0) > 0)
      .map((v) => ({
        id: v.id, department: String(v.department ?? ""), position: String(v.position ?? ""), category: String(v.positionCategory ?? "TEACHING"),
        posts: Number(v.requiredCount ?? 0), mode: String(v.hiringMode ?? "OFFLINE"),
        approvedOn: dayKey((v.principalResponse as { respondedAt?: unknown } | undefined)?.respondedAt) ?? dayKey(v.createdAt),
        counts: byVacancy.get(v.id) ?? { total: 0, TO_SCREEN: 0, SHORTLISTED: 0, INTERVIEW: 0, SELECTED: 0 },
      }))
      .sort((a, b) => a.department.localeCompare(b.department) || a.position.localeCompare(b.position));

    const interviews = batches
      .map((b) => ({ id: b.id, department: String(b.department ?? ""), position: String(b.position ?? ""), date: dayKey(b.interviewDate), phase: String(b.currentPhase ?? "") }))
      .filter((b) => b.date && b.date >= today && b.date <= weekEnd && b.phase !== "COMPLETED")
      .sort((a, b) => a.date!.localeCompare(b.date!));

    const pendingOffers = offers.filter((o) => o.status === "SENT" || o.status === "GENERATED")
      .map((o) => ({ id: o.id, name: String(o.candidateName ?? ""), department: String(o.department ?? ""), designation: String(o.designation ?? ""), status: String(o.status), joining: dayKey(o.joiningDate) }));
    const joining = offers.filter((o) => o.status === "ACCEPTED")
      .map((o) => ({ id: o.id, name: String(o.candidateName ?? ""), department: String(o.department ?? ""), designation: String(o.designation ?? ""), date: String(o.candidateConfirmedJoiningDate ?? "") || dayKey(o.joiningDate) }))
      .filter((o) => o.date?.startsWith(month))
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));

    // Days from the hiring request's approval to the Principal's selection (selected applications only).
    const vById = new Map(vacancies.map((v) => [v.id, v]));
    const spans: number[] = [];
    for (const a of apps) {
      if (a.status !== "APPROVED") continue;
      const v = vById.get(String(a.vacancyRequestId ?? ""));
      const from = toDate(((v?.principalResponse as { respondedAt?: unknown } | undefined)?.respondedAt ?? v?.createdAt) as never);
      const to = toDate(a.updatedAt as never);
      if (from && to && to >= from) spans.push((to.getTime() - from.getTime()) / 86_400_000);
    }

    return NextResponse.json({
      kpis: {
        openPosts: open.reduce((n, v) => n + v.posts, 0),
        openRequests: open.length,
        toScreen: stages.TO_SCREEN,
        interviewsThisWeek: interviews.length,
        offersPending: pendingOffers.length,
        joiningThisMonth: joining.length,
        avgDaysToHire: spans.length ? Math.round(spans.reduce((s, x) => s + x, 0) / spans.length) : null,
        pendingRequests: vacancies.filter((v) => v.status === "PENDING").length,
      },
      stages,
      open,
      interviews,
      pendingOffers,
      joining,
    });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "You do not have access, or your session has expired. Sign in again to continue." }, { status: 401 });
    }
    console.error("[college/hr/overview GET]", err);
    return NextResponse.json({ error: "Unable to complete the request. Try again; if it continues, contact the administrator." }, { status: 500 });
  }
}
