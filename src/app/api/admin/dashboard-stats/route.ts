export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth/verifySession";
import { getAdminAuth, getAdminDb, getAdminStorage } from "@/lib/firebase/admin";

const GLOBAL_ROLES = ["MANAGEMENT", "FINANCE", "PURCHASE_DEPT"] as const;
const AUDIT_WINDOW_DAYS = 30;

// Super Admin dashboard's four stat tiles + System Health - previously
// hardcoded ("-" / all-green). Every count below is a single-field where +
// count() aggregate (cheap, and never needs a composite Firestore index) run
// per college/location, since colleges/locations are still few enough in this
// deployment for that fan-out to be fine. "Ongoing Hirings" counts
// vacancyRequests still in APPROVED status (recruitment open) - not the same,
// stricter signal as isHiringClosed() (see hiringPipeline.ts), which also
// requires every approved candidate's credentials to be issued; this is a
// simpler "how many roles are currently being recruited for" headline number.
export async function GET() {
  try {
    await requireSuperAdmin();
    const db = getAdminDb();

    // listDocuments() returns bare DocumentReferences (ids only, no field
    // data fetched) - cheaper than a full get() when only the ids are needed.
    const [collegeRefs, locationRefs] = await Promise.all([
      db.collection("colleges").listDocuments(),
      db.collection("locations").listDocuments(),
    ]);
    const collegeIds = collegeRefs.map((d) => d.id);
    const locationIds = locationRefs.map((d) => d.id);

    const auditSince = new Date(Date.now() - AUDIT_WINDOW_DAYS * 24 * 60 * 60 * 1000);

    const [collegeCounts, locationCounts, globalActiveCounts] = await Promise.all([
      Promise.all(
        collegeIds.map(async (id) => {
          const collegeRef = db.collection("colleges").doc(id);
          const [activeUsers, ongoingHirings, auditEvents] = await Promise.all([
            collegeRef.collection("users").where("isActive", "==", true).count().get(),
            collegeRef.collection("vacancyRequests").where("status", "==", "APPROVED").count().get(),
            collegeRef.collection("auditLogs").where("timestamp", ">=", auditSince).count().get(),
          ]);
          return {
            activeUsers: activeUsers.data().count,
            ongoingHirings: ongoingHirings.data().count,
            auditEvents: auditEvents.data().count,
          };
        })
      ),
      Promise.all(
        locationIds.map(async (id) => {
          const activeUsers = await db.collection("locations").doc(id).collection("locationUsers").where("isActive", "==", true).count().get();
          return activeUsers.data().count;
        })
      ),
      Promise.all(
        GLOBAL_ROLES.map(async (role) => {
          const snap = await db.collection("systemUsers").where("role", "==", role).count().get();
          return snap.data().count;
        })
      ),
    ]);

    const activeUsers =
      collegeCounts.reduce((sum, c) => sum + c.activeUsers, 0) +
      locationCounts.reduce((sum, n) => sum + n, 0) +
      globalActiveCounts.reduce((sum, n) => sum + n, 0);
    const ongoingHirings = collegeCounts.reduce((sum, c) => sum + c.ongoingHirings, 0);
    const auditEvents = collegeCounts.reduce((sum, c) => sum + c.auditEvents, 0);

    // System Health - a real (cheap) round-trip per service rather than a
    // hardcoded "all green": one Firestore read, one Auth lookup, one Storage
    // bucket check. Each failure is caught independently so one down service
    // doesn't hide the other two's real status.
    const [firestoreOk, authOk, storageOk] = await Promise.all([
      db.collection("colleges").limit(1).get().then(() => true).catch(() => false),
      getAdminAuth().then((auth) => auth.listUsers(1)).then(() => true).catch(() => false),
      getAdminStorage().bucket().exists().then(([exists]) => exists).catch(() => false),
    ]);

    return NextResponse.json({
      colleges: collegeIds.length,
      activeUsers,
      ongoingHirings,
      auditEvents,
      auditWindowDays: AUDIT_WINDOW_DAYS,
      systemHealth: { firestore: firestoreOk, authentication: authOk, storage: storageOk },
    });
  } catch (err) {
    if (err instanceof Error && err.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[admin/dashboard-stats GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
