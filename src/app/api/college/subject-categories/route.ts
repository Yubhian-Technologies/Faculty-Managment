export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { categoryDocId, checkCategoryDefinition, isStandardCategoryCode, type CategoryDefinition } from "@/lib/subjects/categoryDefinitions";
import { SUBJECT_CATEGORY_LABELS } from "@/types";

// Subject categories the college defines for itself (short code + full form),
// managed on Academics > Categories and used to validate Course Structure
// imports. Stored at colleges/{id}/subjectCategories/{CODE}; a subject keeps
// the code in its own `category` field, so nothing that reads subjects changes.

const READ_ROLES = ["PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN", "ACADEMICS", "HOD", "COLLEGE_OFFICE"] as const;
const WRITE_ROLES = ["PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN", "ACADEMICS"] as const;
const MAX_PER_REQUEST = 100;

const entrySchema = z.object({ code: z.string(), fullForm: z.string() });
// newCode: a custom category's rename target. Omitted/unchanged for a plain
// relabel. Never honored for a standard code - see PATCH's own doc-comment.
const patchSchema = entrySchema.extend({ newCode: z.string().optional() });

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

// Changes a category's full form, and - for a custom category only, while
// nothing uses it yet - its code too. A standard (AICTE) code has no doc here
// until its first edit (that edit creates it, an upsert, same as every
// subsequent relabel) and its code can never change: it's the literal value
// hardcoded business logic elsewhere compares against (e.g. elective
// detection on "PEC"/"OEC"), so renaming it would silently break that.
// Renaming a CUSTOM code is refused while any subject already stores it -
// nothing here cascades that value onto subjects or their semester copies,
// so a rename only ever happens when there is nothing left to go stale.
export async function PATCH(request: Request) {
  try {
    const session = await requireCollegeMember(...WRITE_ROLES);
    const parsed = patchSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Send the code and the new full form." }, { status: 400 });

    const db = getAdminDb();
    const ref = categoriesRef(session.collegeId);
    const docRef = ref.doc(categoryDocId(parsed.data.code));
    const snap = await docRef.get();
    const standard = isStandardCategoryCode(parsed.data.code);
    if (!snap.exists && !standard) return NextResponse.json({ error: "That category isn't defined." }, { status: 404 });

    const currentCode = snap.exists ? (snap.data() as CategoryDefinition).code : parsed.data.code.trim().toUpperCase();
    const existing = (await ref.get()).docs.map((d) => d.data() as CategoryDefinition);
    const wantsRename = !!parsed.data.newCode?.trim() && parsed.data.newCode.trim().toUpperCase() !== currentCode;

    if (wantsRename && standard) {
      return NextResponse.json({ error: "A standard category's code can't be changed - only its full form. Add a new category instead." }, { status: 400 });
    }

    if (wantsRename) {
      const inUse = await db.collection("colleges").doc(session.collegeId).collection("subjects").where("category", "==", currentCode).limit(1).get();
      if (!inUse.empty) {
        return NextResponse.json({ error: `${currentCode} is used by existing subjects, so its code can't be changed. Add a new category instead.` }, { status: 409 });
      }
      const check = checkCategoryDefinition({ code: parsed.data.newCode!, fullForm: parsed.data.fullForm }, existing, currentCode);
      if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 });

      const newRef = ref.doc(categoryDocId(check.code));
      const now = new Date();
      try {
        await db.runTransaction(async (tx) => {
          const dest = await tx.get(newRef);
          if (dest.exists) throw new Error("CATEGORY_CODE_TAKEN");
          tx.delete(docRef);
          tx.set(newRef, { collegeId: session.collegeId, code: check.code, fullForm: check.fullForm, createdBy: session.uid, createdAt: now, updatedAt: now });
        });
      } catch (err) {
        if (err instanceof Error && err.message === "CATEGORY_CODE_TAKEN") {
          return NextResponse.json({ error: `${check.code} is already defined.` }, { status: 409 });
        }
        throw err;
      }
      return NextResponse.json({ category: { code: check.code, fullForm: check.fullForm } });
    }

    const check = checkCategoryDefinition({ code: currentCode, fullForm: parsed.data.fullForm }, existing, currentCode);
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 });

    const now = new Date();
    if (snap.exists) {
      await docRef.update({ fullForm: check.fullForm, updatedAt: now });
    } else {
      await docRef.set({ collegeId: session.collegeId, code: currentCode, fullForm: check.fullForm, createdBy: session.uid, createdAt: now, updatedAt: now });
    }
    return NextResponse.json({ category: { code: currentCode, fullForm: check.fullForm } });
  } catch (err) {
    return handleError(err, "[college/subject-categories PATCH]");
  }
}

// Removes a definition. For a genuine custom category this is refused while
// any subject still uses the code, so a subject is never left with a category
// nobody can see the name of. For a standard (AICTE) category this instead
// resets it to its built-in label - the category itself is always defined,
// so usage is never a reason to block it.
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
    if (!isStandardCategoryCode(stored)) {
      const inUse = await db.collection("colleges").doc(session.collegeId).collection("subjects").where("category", "==", stored).limit(1).get();
      if (!inUse.empty) {
        return NextResponse.json({ error: `${stored} is used by existing subjects, so it can't be removed.` }, { status: 409 });
      }
    }
    await docRef.delete();
    return NextResponse.json({ success: true, reset: isStandardCategoryCode(stored) ? { code: stored, fullForm: SUBJECT_CATEGORY_LABELS[stored] } : undefined });
  } catch (err) {
    return handleError(err, "[college/subject-categories DELETE]");
  }
}
