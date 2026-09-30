export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { categoryDocId, checkCategoryDefinition, type CategoryDefinition } from "@/lib/subjects/categoryDefinitions";

// Subject categories the college defines for itself (short code + full form),
// managed on Academics > Categories and used to validate Course Structure
// imports. Stored at colleges/{id}/subjectCategories/{CODE}; a subject keeps
// the code in its own `category` field, so nothing that reads subjects changes.

const READ_ROLES = ["PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN", "ACADEMICS", "HOD", "COLLEGE_OFFICE"] as const;
const WRITE_ROLES = ["PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN", "ACADEMICS"] as const;
const MAX_PER_REQUEST = 100;

const entrySchema = z.object({ code: z.string(), fullForm: z.string() });

function handleError(err: unknown, label: string) {
  if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  console.error(label, err);
  return NextResponse.json({ error: "Internal error" }, { status: 500 });
}

function categoriesRef(collegeId: string) {
  return getAdminDb().collection("colleges").doc(collegeId).collection("subjectCategories");
}

export async function GET() {
  try {
    const session = await requireCollegeMember(...READ_ROLES);
    const snap = await categoriesRef(session.collegeId).get();
    const categories: CategoryDefinition[] = snap.docs
      .map((d) => d.data() as CategoryDefinition)
      .filter((c) => c.code && c.fullForm)
      .sort((a, b) => a.code.localeCompare(b.code));
    return NextResponse.json({ categories });
  } catch (err) {
    return handleError(err, "[college/subject-categories GET]");
  }
}

// Adds one or several categories. All or nothing: if any entry is invalid or
// already defined, none is saved and the message names the entry.
export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember(...WRITE_ROLES);
    const parsed = z.object({ categories: z.array(entrySchema).min(1).max(MAX_PER_REQUEST) }).safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Send at least one category with a code and a full form." }, { status: 400 });

    const db = getAdminDb();
    const ref = categoriesRef(session.collegeId);
    const existing = (await ref.get()).docs.map((d) => d.data() as CategoryDefinition);

    const accepted: CategoryDefinition[] = [];
    for (const entry of parsed.data.categories) {
      const check = checkCategoryDefinition(entry, [...existing, ...accepted]);
      if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 });
      accepted.push({ code: check.code, fullForm: check.fullForm });
    }

    const now = new Date();
    const batch = db.batch();
    for (const c of accepted) {
      // create() fails if another request defined the same code meanwhile.
      batch.create(ref.doc(categoryDocId(c.code)), { collegeId: session.collegeId, code: c.code, fullForm: c.fullForm, createdBy: session.uid, createdAt: now, updatedAt: now });
    }
    try {
      await batch.commit();
    } catch (err) {
      if ((err as { code?: number }).code === 6) {
        return NextResponse.json({ error: "One of these categories was just defined by someone else. Reload and try again." }, { status: 409 });
      }
      throw err;
    }
    return NextResponse.json({ categories: accepted }, { status: 201 });
  } catch (err) {
    return handleError(err, "[college/subject-categories POST]");
  }
}

// Changes a category's full form. The short code is the key subjects refer to,
// so it can't be renamed.
export async function PATCH(request: Request) {
  try {
    const session = await requireCollegeMember(...WRITE_ROLES);
    const parsed = entrySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Send the code and the new full form." }, { status: 400 });

    const ref = categoriesRef(session.collegeId);
    const docRef = ref.doc(categoryDocId(parsed.data.code));
    const snap = await docRef.get();
    if (!snap.exists) return NextResponse.json({ error: "That category isn't defined." }, { status: 404 });

    const existing = (await ref.get()).docs.map((d) => d.data() as CategoryDefinition);
    const current = snap.data() as CategoryDefinition;
    const check = checkCategoryDefinition({ code: current.code, fullForm: parsed.data.fullForm }, existing, current.code);
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 });

    await docRef.update({ fullForm: check.fullForm, updatedAt: new Date() });
    return NextResponse.json({ category: { code: current.code, fullForm: check.fullForm } });
  } catch (err) {
    return handleError(err, "[college/subject-categories PATCH]");
  }
}

// Removes a definition. Refused while any subject still uses the code, so a
// subject is never left with a category nobody can see the name of.
export async function DELETE(request: Request) {
  try {
    const session = await requireCollegeMember(...WRITE_ROLES);
    const code = new URL(request.url).searchParams.get("code")?.trim();
    if (!code) return NextResponse.json({ error: "code is required" }, { status: 400 });

    const db = getAdminDb();
    const docRef = categoriesRef(session.collegeId).doc(categoryDocId(code));
    const snap = await docRef.get();
    if (!snap.exists) return NextResponse.json({ error: "That category isn't defined." }, { status: 404 });

    const stored = (snap.data() as CategoryDefinition).code;
    const inUse = await db.collection("colleges").doc(session.collegeId).collection("subjects").where("category", "==", stored).limit(1).get();
    if (!inUse.empty) {
      return NextResponse.json({ error: `${stored} is used by existing subjects, so it can't be removed.` }, { status: 409 });
    }
    await docRef.delete();
    return NextResponse.json({ success: true });
  } catch (err) {
    return handleError(err, "[college/subject-categories DELETE]");
  }
}
