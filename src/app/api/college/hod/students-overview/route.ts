export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { overviewAttendance } from "@/lib/students/hodStudentsOverviewServer";
import { hodStudentsForOverview } from "@/lib/students/hodPagedList";
import { compareStudentsForList } from "@/lib/students/listOrder";
import { ACTIVE_HOD_DEPT_COOKIE } from "@/lib/roles/activeHodDepartment";

// The HOD Students page's overview, for the students its filters show (Department / branch / Course / Year - the same
// roster as the list): number cards, one card per section, and per student today's mark, semester %, mentor, mobile
// and login - for the table's columns and the quick filters. Attendance comes from the HOD dashboard's figures
// (today read fresh-ish, 60 s; semester kept 10 minutes), counted the same way as the reports.

const LEFT = new Set(["DISCONTINUED", "GRADUATED", "TRANSFERRED", "PASSED_OUT"]);
const SHORT = 75;
const CRITICAL = 65;

// Kept 60 s per HOD + filter + Working-as pick (the page asks again on every Load / Refresh).
const cache = new Map<string, { at: number; body: unknown }>();

const genderOf = (g: unknown) => {
  const v = String(g ?? "").trim().toLowerCase();
  return v === "male" || v === "m" ? "M" : v === "female" || v === "f" ? "F" : "";
};

export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember("HOD");
    const db = getAdminDb();
    const params = new URL(request.url).searchParams;
    const { cookies } = await import("next/headers");
    const pick = (await cookies()).get(ACTIVE_HOD_DEPT_COOKIE)?.value ?? "";
    const cacheKey = `${session.collegeId}|${session.uid}|${pick}|${params.toString()}`;
    const hit = cache.get(cacheKey);
    if (hit && Date.now() - hit.at < 60_000 && !process.env.FIRESTORE_EMULATOR_HOST) return NextResponse.json(hit.body);
    const [all, sectionSnap] = await Promise.all([
      hodStudentsForOverview(db, session, params),
      db.collection("colleges").doc(session.collegeId).collection("sections").select("name", "department", "year", "courseId", "facultyInchargeName").get(),
    ]);
    const students = all.filter((s) => !LEFT.has(String(s.status ?? "").toUpperCase())).sort(compareStudentsForList);
    const sectionDoc = new Map(sectionSnap.docs.map((d) => [`${d.get("department")}|${Number(d.get("year"))}|${d.get("name")}`,
      { id: d.id, courseId: String(d.get("courseId") ?? ""), year: Number(d.get("year")), incharge: String(d.get("facultyInchargeName") ?? "") }]));
    const sectionIdOf = (s: { department?: string; year?: number; section?: string }) => (s.section ? sectionDoc.get(`${s.department}|${Number(s.year)}|${s.section}`)?.id ?? null : null);
    const usedSections = [...new Set(students.map(sectionIdOf).filter((x): x is string => !!x))];
    const att = await overviewAttendance(db, session.collegeId,
      [...sectionDoc.values()].filter((d) => usedSections.includes(d.id)),
      students.map((s) => ({ id: s.id, sectionId: sectionIdOf(s), dateOfJoining: (s as { dateOfJoining?: string }).dateOfJoining ?? null })), SHORT);
    const todayBy = att.today;
    const pctBy = att.pct;

    const k = { total: students.length, boys: 0, girls: 0, admission: {} as Record<string, number>, below75: 0, below65: 0, absentToday: 0, onDutyToday: 0, noMobile: 0, noMentor: 0, noLogin: 0, noSection: 0 };
    const bySection = new Map<string, { key: string; name: string; department: string; year: number; strength: number; mentored: number }>();
    const rows: Record<string, { r: string; n: string; s: string; t: "P" | "A" | "OD" | null; p: number | null; m: string | null; mob: boolean; login: boolean; adm: string; g: string }> = {};
    for (const s of students) {
      const g = genderOf(s.gender);
      if (g === "M") k.boys += 1; else if (g === "F") k.girls += 1;
      const adm = String(s.admissionType ?? "").trim() || "Not set";
      k.admission[adm] = (k.admission[adm] ?? 0) + 1;
      const pct = pctBy[s.id] ?? null;
      if (pct != null && pct < SHORT) k.below75 += 1;
      if (pct != null && pct < CRITICAL) k.below65 += 1;
      const t = todayBy[s.id] ?? null;
      if (t === "A") k.absentToday += 1;
      if (t === "OD") k.onDutyToday += 1;
      const mob = !!String(s.mobileNo ?? "").trim();
      const login = !!s.uid;
      const mentor = (s as { mentorUid?: string; mentorName?: string }).mentorUid ? String((s as { mentorName?: string }).mentorName ?? "Assigned") : null;
      if (!mob) k.noMobile += 1;
      if (!mentor) k.noMentor += 1;
      if (!login) k.noLogin += 1;
      if (!s.section) k.noSection += 1;
      else {
        const key = `${s.department}|${Number(s.year)}|${s.section}`;
        const cur = bySection.get(key) ?? { key, name: String(s.section), department: String(s.department ?? ""), year: Number(s.year), strength: 0, mentored: 0 };
        cur.strength += 1;
        if (mentor) cur.mentored += 1;
        bySection.set(key, cur);
      }
      rows[s.id] = { r: String(s.rollNumber ?? ""), n: String(s.name ?? ""), s: String(s.section ?? ""), t, p: pct, m: mentor, mob, login, adm, g };
    }

    const sections = [...bySection.values()]
      .sort((a, b) => a.department.localeCompare(b.department) || a.year - b.year || a.name.localeCompare(b.name, undefined, { numeric: true }))
      .map((s) => {
        const doc = sectionDoc.get(s.key);
        const stat = doc ? att.section[doc.id] : undefined;
        return {
          ...s,
          todayPct: stat?.todayPct ?? null,
          semesterPct: stat?.pct ?? null,
          below: stat?.below ?? 0,
          incharge: doc?.incharge ?? "",
        };
      });

    const body = { kpis: k, sections, students: rows, order: students.map((s) => s.id) };
    cache.set(cacheKey, { at: Date.now(), body });
    if (cache.size > 200) cache.delete(cache.keys().next().value!);
    return NextResponse.json(body);
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "You do not have access, or your session has expired. Sign in again to continue." }, { status: 401 });
    }
    console.error("[college/hod/students-overview GET]", err);
    return NextResponse.json({ error: "Unable to complete the request. Try again; if it continues, contact the administrator." }, { status: 500 });
  }
}
