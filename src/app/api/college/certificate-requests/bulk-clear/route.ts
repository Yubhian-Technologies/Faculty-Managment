export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { actingUser, authenticate, failure, readJson, ANY_CERTIFICATE_ACTOR_ROLE } from "@/lib/certifications/http";
import { decide } from "@/lib/certifications/service";
import { CertificationError } from "@/lib/certifications/types";

// A department clears many students at once (No dues / Not applicable / Approve) - each one exactly as a single
// decision (its own transaction and checks); one that fails is reported and never stops the rest.
export async function POST(request: Request) {
  try {
    const session = await authenticate(...ANY_CERTIFICATE_ACTOR_ROLE);
    const db = getAdminDb();
    const user = await actingUser(db, session);
    const body = (await readJson(request)) as { items?: unknown; outcome?: unknown };
    const items = (Array.isArray(body.items) ? body.items : []) as { id?: unknown; branchKey?: unknown }[];
    if (items.length === 0 || items.length > 300) throw new CertificationError("INVALID", "Pick between 1 and 300 students", 400);
    const outcome = body.outcome === "NO_DUES" || body.outcome === "NOT_APPLICABLE" ? body.outcome : undefined;
    const done: string[] = [];
    const failed: { id: string; error: string }[] = [];
    for (const it of items) {
      const id = String(it.id ?? "");
      try {
        await decide(db, user, id, "APPROVE", undefined, typeof it.branchKey === "string" ? it.branchKey : undefined, outcome);
        done.push(id);
      } catch (e) {
        failed.push({ id, error: e instanceof Error ? e.message : "Failed" });
      }
    }
    return NextResponse.json({ done, failed });
  } catch (err) {
    return failure(err, "certificate-requests/bulk-clear POST");
  }
}
