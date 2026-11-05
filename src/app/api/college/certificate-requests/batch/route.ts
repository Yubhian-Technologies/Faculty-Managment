export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { actingUser, authenticate, failure, readJson } from "@/lib/certifications/http";
import { batchGroups, startBatch } from "@/lib/certifications/configured";
import { loadTypes } from "@/lib/certifications/store";
import { CERTIFICATE_REQUESTS_COL } from "@/lib/certifications/transitions";

// The College Office (or Principal / VP) starts a certificate the office starts - No Dues - for whole classes.
const ROLES = ["COLLEGE_OFFICE", "PRINCIPAL", "VICE_PRINCIPAL"] as const;

/** The classes to choose from (branch / year / section / status with student counts) and the office-started types. */
export async function GET() {
  try {
    const session = await authenticate(...ROLES);
    const db = getAdminDb();
    const [groups, types] = await Promise.all([batchGroups(db, session.collegeId), loadTypes(db, session.collegeId)]);
    // A No Dues installed before it became office-started: offered for switching to the new form (Setup > Reset).
    const oldNoDues = types.find((t) => t.catalogKey === "NO_DUES" && t.startedBy !== "OFFICE");
    const oldInUse = oldNoDues ? !(await CERTIFICATE_REQUESTS_COL(db, session.collegeId).where("certificateTypeId", "==", oldNoDues.id).limit(1).get()).empty : false;
    return NextResponse.json({
      groups,
      types: types.filter((t) => t.startedBy === "OFFICE").map((t) => ({ id: t.id, name: t.name, isActive: t.isActive })),
      ...(oldNoDues ? { oldNoDues: { id: oldNoDues.id, name: oldNoDues.name, inUse: oldInUse } } : {}),
    });
  } catch (err) {
    return failure(err, "certificate-requests/batch GET");
  }
}

/** { typeId, groups: [key], dryRun } - dryRun counts who would be started and who is skipped, writing nothing. */
export async function POST(request: Request) {
  try {
    const session = await authenticate(...ROLES);
    const db = getAdminDb();
    const user = await actingUser(db, session);
    const body = (await readJson(request)) as { typeId?: unknown; groups?: unknown; dryRun?: unknown };
    const keys = Array.isArray(body.groups) ? body.groups.filter((k): k is string => typeof k === "string") : [];
    const result = await startBatch(db, user, String(body.typeId ?? ""), keys, body.dryRun === true);
    return NextResponse.json(result);
  } catch (err) {
    return failure(err, "certificate-requests/batch POST");
  }
}
