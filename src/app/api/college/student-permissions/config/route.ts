export const dynamic = "force-dynamic";

import { writeAuditLogSafe } from "@/lib/audit/safeAuditLog";
import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { actingUser, authenticate, failure, readJson } from "@/lib/studentPermissions/http";
import { describeEditor, readConfig, writeConfig } from "@/lib/studentPermissions/service";
import { PERMISSION_GROUPS } from "@/lib/studentPermissions/categories";
import { allowedStages, DEFAULT_LIMITS, defaultRoute, PERMISSION_STAGE_LABELS, type PermissionConfig } from "@/lib/studentPermissions/types";

// The routing configuration. The Principal edits everything and decides which
// departments' HODs may edit their own department's rules; a delegated HOD edits
// only their own department; the Vice Principal can read it. Enforcement is in
// applyConfigEdit (lib/approvals/config.ts), so a forbidden edit is refused, never silently dropped.
export async function GET() {
  try {
    const session = await authenticate("PRINCIPAL", "VICE_PRINCIPAL", "HOD");
    const db = getAdminDb();
    const user = await actingUser(db, session);
    const deptSnap = await db.collection("colleges").doc(session.collegeId).collection("departments").select("name").get();
    const departments = deptSnap.docs.map((d) => (d.data() as { name?: string }).name ?? "").filter(Boolean).sort();
    return NextResponse.json({
      config: await readConfig(db, user),
      departments,
      groups: PERMISSION_GROUPS,
      stages: { STUDENT: allowedStages("STUDENT"), FACULTY: allowedStages("FACULTY") },
      stageLabels: PERMISSION_STAGE_LABELS,
      defaults: { limits: DEFAULT_LIMITS, route: { STUDENT: defaultRoute("STUDENT"), FACULTY: defaultRoute("FACULTY") } },
      editor: await describeEditor(db, user),
    });
  } catch (err) {
    return failure(err, "college/student-permissions/config GET");
  }
}

export async function PUT(request: Request) {
  try {
    const session = await authenticate("PRINCIPAL", "HOD");
    const db = getAdminDb();
    const user = await actingUser(db, session);
    const proposed = (await readJson(request)) as { config?: PermissionConfig };
    if (!proposed?.config || typeof proposed.config !== "object") return NextResponse.json({ error: "config is required" }, { status: 400 });
    const saved = await writeConfig(db, user, proposed.config);
    await writeAuditLogSafe(db, session.collegeId, { action: "STUDENT_PERMISSION_CONFIG_UPDATED", performedBy: session.uid, performedByName: user.name, details: { byRole: user.roles.includes("PRINCIPAL") ? "PRINCIPAL" : "HOD" } });
    return NextResponse.json({ config: saved });
  } catch (err) {
    return failure(err, "college/student-permissions/config PUT");
  }
}
