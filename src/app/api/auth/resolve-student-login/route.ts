export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";

// Server-side (Admin SDK) resolver the login page calls BEFORE
// signInWithEmailAndPassword whenever the identifier isn't an email: a
// student knows only their Roll Number, never their real (synthetic)
// Firebase Auth email, so this looks that email up for them - across every
// college, since the login page has no college picker. Deliberately never a
// client Firestore query - it must not leak any other student's data, only
// whether a match exists and, if exactly one does, that one student's own
// loginEmail.
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { rollNumber?: string };
    const rollNumber = body.rollNumber?.trim();
    if (!rollNumber) {
      return NextResponse.json({ error: "Roll Number is required" }, { status: 400 });
    }

    // No college picker on the login page - looks across every college's
    // students subcollection (same collectionGroup pattern as the public
    // faculty lookup, api/public/faculty-public). Fails closed on ambiguity
    // rather than guessing.
    const db = getAdminDb();
    const rollNumberUpper = rollNumber.toUpperCase();

    // Fast path: direct O(1) point read from global studentUsernames collection
    const usernameDoc = await db.collection("studentUsernames").doc(rollNumberUpper).get();
    if (usernameDoc.exists) {
      const data = usernameDoc.data() as { loginEmail?: string };
      if (data?.loginEmail) {
        return NextResponse.json({ loginEmail: data.loginEmail });
      }
    }

    const snap = await db
      .collectionGroup("students")
      .where("rollNumberUpper", "==", rollNumberUpper)
      .get();

    const withLogin = snap.docs.filter((d) => Boolean(d.data().uid));

    if (withLogin.length === 0) {
      return NextResponse.json({ error: "No login found for that Roll Number" }, { status: 404 });
    }
    if (withLogin.length > 1) {
      // Two students - possibly at different colleges, since there's no
      // college picker to narrow the search - share a Roll Number and both
      // have logins. create-login's own duplicate check only guards within
      // one college, so a cross-college collision is possible; fail closed
      // rather than guess which one signed in.
      return NextResponse.json(
        { error: "Multiple accounts match this Roll Number - contact your College Office" },
        { status: 409 }
      );
    }

    const loginEmail = (withLogin[0].data() as { loginEmail?: string }).loginEmail;
    if (!loginEmail) {
      return NextResponse.json({ error: "No login found for that Roll Number" }, { status: 404 });
    }

    return NextResponse.json({ loginEmail });
  } catch (err) {
    console.error("[auth/resolve-student-login POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
