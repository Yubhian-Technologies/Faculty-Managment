export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { getHodDepartmentScope } from "@/lib/departments/scope";
import type { Firestore } from "firebase-admin/firestore";

async function getUserName(db: Firestore, collegeId: string, uid: string): Promise<string> {
  if (!collegeId || !uid) return "Unknown";
  try {
    const snap = await db.collection("colleges").doc(collegeId).collection("users").doc(uid).get();
    return (snap.data() as { name?: string } | undefined)?.name ?? "Unknown";
  } catch {
    return "Unknown";
  }
}

export async function GET(_request: Request) {
  try {
    const session = await requireCollegeMember("PRINCIPAL", "VICE_PRINCIPAL", "HOD", "SUPER_ADMIN", "COLLEGE_OFFICE", "PANEL_MEMBER", "ACCOUNTS");

    const db = getAdminDb();
    const snap = await db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("candidates")
      .orderBy("createdAt", "desc")
      .get();

    let candidates = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    // Candidate has no department of its own (see src/types/recruitment.ts) -
    // it's only attached to a department via CandidateApplication, and a
    // candidate can be attached to several departments over time. An HOD
    // must still see the shared, not-yet-attached pool (so they can attach
    // new candidates to their own hiring requests), but not a candidate that
    // has only ever been attached to a *different* department's vacancy -
    // otherwise every HOD sees every other department's applicant list.
    if (session.role === "HOD") {
      const scope = await getHodDepartmentScope(db, session.collegeId, session.uid);
      const ownDepartments = new Set([scope.departmentName, ...scope.childDepartmentNames, ...scope.managedDepartmentNames].filter(Boolean));
      const appsSnap = await db.collection("colleges").doc(session.collegeId).collection("candidateApplications").get();
      const attachedToOwnDept = new Set<string>();
      const attachedToOtherDept = new Set<string>();
      for (const doc of appsSnap.docs) {
        const a = doc.data() as { candidateId?: string; department?: string };
        if (!a.candidateId) continue;
        if (a.department && ownDepartments.has(a.department)) attachedToOwnDept.add(a.candidateId);
        else attachedToOtherDept.add(a.candidateId);
      }
      candidates = candidates.filter((c) => attachedToOwnDept.has(c.id) || !attachedToOtherDept.has(c.id));
    }

    return NextResponse.json({ candidates });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/candidates GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("HOD", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN");
    const body = (await request.json()) as {
      name: string;
      email: string;
      phone: string;
      resumeUrl?: string;
      source?: string;
      referralType?: string;
      referralName?: string;
      referralPhone?: string;
      referralDescription?: string;
      referralCollege?: string;
      referralDesignation?: string;
      referralInfluenceType?: string;
      referralInfluenceOther?: string;
      residenceAddress?: string;
      permanentAddress?: string;
    };

    const { name, email, phone, resumeUrl, source, referralType, referralName, referralPhone, referralDescription, referralCollege, referralDesignation, referralInfluenceType, referralInfluenceOther, residenceAddress, permanentAddress } = body;
    if (!name || !email || !phone) {
      return NextResponse.json({ error: "name, email, phone required" }, { status: 400 });
    }

    const db = getAdminDb();
    const addedByName = await getUserName(db, session.collegeId, session.uid);
    const now = new Date();

    const ref = await db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("candidates")
      .add({
        collegeId: session.collegeId,
        name: name.trim(),
        email: email.trim().toLowerCase(),
        phone: phone.trim(),
        resumeUrl: resumeUrl ?? "",
        source: source ?? "WALK_IN",
        ...(residenceAddress ? { residenceAddress: residenceAddress.trim() } : {}),
        ...(permanentAddress ? { permanentAddress: permanentAddress.trim() } : {}),
        ...(source === "REFERRAL" ? {
          referralType: referralType ?? "INTERNAL",
          ...(referralName ? { referralName: referralName.trim() } : {}),
          ...(referralPhone ? { referralPhone: referralPhone.trim() } : {}),
          ...(referralDescription ? { referralDescription: referralDescription.trim() } : {}),
          ...(referralType === "INTERNAL" ? {
            ...(referralCollege ? { referralCollege: referralCollege.trim() } : {}),
            ...(referralDesignation ? { referralDesignation: referralDesignation.trim() } : {}),
          } : {}),
          ...(referralType === "EXTERNAL" ? {
            referralInfluenceType: referralInfluenceType ?? "NONE",
            ...(referralInfluenceType === "OTHER" && referralInfluenceOther
              ? { referralInfluenceOther: referralInfluenceOther.trim() }
              : {}),
          } : {}),
        } : {}),
        addedByUid: session.uid,
        addedByName,
        createdAt: now,
        updatedAt: now,
      });

    await db.collection("colleges").doc(session.collegeId).collection("auditLogs").add({
      collegeId: session.collegeId,
      action: "CANDIDATE_ADDED",
      performedBy: session.uid,
      performedByName: addedByName,
      targetId: ref.id,
      details: { name, email },
      timestamp: now,
    });

    return NextResponse.json({ id: ref.id }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/candidates POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
