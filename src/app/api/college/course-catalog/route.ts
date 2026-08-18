export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { loadAcademicRegulations } from "@/lib/firestore/academicRegulations";

// colleges/{collegeId}/courseCatalog - the Principal's master list of course
// definitions (canonical name + short code + duration). Departments only *select*
// from this list, they never re-type a course name, so duplicates can't creep in.

export async function GET() {
  try {
    const session = await requireCollegeMember(
      "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN", "HOD", "COLLEGE_OFFICE", "DEAN"
    );

    const db = getAdminDb();
    const snap = await db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("courseCatalog")
      .get();

    const items = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => ((a as { name?: string }).name ?? "").localeCompare((b as { name?: string }).name ?? ""));

    return NextResponse.json({ items });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[course-catalog GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("PRINCIPAL", "SUPER_ADMIN");
    const body = (await request.json()) as {
      name?: string;
      code?: string;
      durationYears?: number;
      regulations?: string[];
    };

    const name = body.name?.trim();
    const code = body.code?.toUpperCase().trim();
    const durationYears = Number(body.durationYears);

    if (!name || !code || !durationYears) {
      return NextResponse.json({ error: "name, code and durationYears are required" }, { status: 400 });
    }
    if (durationYears < 1 || durationYears > 10) {
      return NextResponse.json({ error: "durationYears must be between 1 and 10" }, { status: 400 });
    }

    const db = getAdminDb();

    const regulations = Array.from(new Set((body.regulations ?? []).map((r) => r.trim()).filter(Boolean)));
    if (regulations.length > 0) {
      const { regulations: declared } = await loadAcademicRegulations(db, session.collegeId);
      const invalid = regulations.filter((r) => !declared.includes(r));
      if (invalid.length > 0) {
        return NextResponse.json(
          { error: `Not declared under Settings > Academic Regulations: ${invalid.join(", ")}` },
          { status: 400 },
        );
      }
    }
    const catalogCol = db.collection("colleges").doc(session.collegeId).collection("courseCatalog");

    const actorSnap = await db.collection("colleges").doc(session.collegeId).collection("users").doc(session.uid).get();
    const actorName = (actorSnap.data() as { name?: string } | undefined)?.name ?? session.email ?? "Unknown";
    const now = new Date();

    // Check-then-add wasn't atomic (a plain get() followed by a plain add())
    // - two submits landing close together (a double-click, or two people
    // adding the same course at once) could both read "no clash" before
    // either had written, and both succeed, leaving two catalog entries with
    // the same name (exactly what let "Bachelor of Technology" appear twice
    // in every course picker downstream). A transaction makes the whole
    // read-check-write atomic: Firestore retries whichever one loses the
    // race once it notices the collection changed underneath it.
    const ref = catalogCol.doc();
    let duplicateError: string | null = null;
    await db.runTransaction(async (tx) => {
      const existing = await tx.get(catalogCol);
      const nameKey = name.toLowerCase();
      const clash = existing.docs.find((d) => {
        const data = d.data() as { name?: string; code?: string };
        return (data.name ?? "").trim().toLowerCase() === nameKey || (data.code ?? "").trim().toUpperCase() === code;
      });
      if (clash) {
        duplicateError = "A course with this name or code already exists";
        return;
      }
      tx.set(ref, {
        collegeId: session.collegeId,
        name,
        code,
        durationYears,
        regulations,
        isActive: true,
        createdBy: session.uid,
        createdByName: actorName,
        createdAt: now,
        updatedAt: now,
      });
    });
    if (duplicateError) {
      return NextResponse.json({ error: duplicateError }, { status: 409 });
    }

    return NextResponse.json({ id: ref.id }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[course-catalog POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
