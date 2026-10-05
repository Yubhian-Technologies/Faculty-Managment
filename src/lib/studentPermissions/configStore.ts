import type { Firestore } from "firebase-admin/firestore";
import { emptyConfig } from "@/lib/approvals";
import type { PermissionConfig } from "./types";

// The permission configuration: one small document per college.
//   colleges/{collegeId}/settings/studentPermissionConfig
// (the `settings` collection already exists for per-college singletons such as
// nav visibility). Reads are one document; the whole config is loaded per
// request and resolved in memory by the pure resolvers in lib/approvals/config.

const ref = (db: Firestore, collegeId: string) =>
  db.collection("colleges").doc(collegeId).collection("settings").doc("studentPermissionConfig");

export async function loadPermissionConfig(db: Firestore, collegeId: string): Promise<PermissionConfig> {
  const snap = await ref(db, collegeId).get();
  if (!snap.exists) return emptyConfig();
  const d = snap.data() as Partial<PermissionConfig>;
  return {
    enabled: d.enabled !== false,
    college: d.college ?? {},
    departments: d.departments ?? {},
    updatedAt: d.updatedAt,
    updatedByName: d.updatedByName,
  };
}

export async function savePermissionConfig(db: Firestore, collegeId: string, config: PermissionConfig, updatedByName: string): Promise<PermissionConfig> {
  const next: PermissionConfig = { ...config, updatedAt: new Date().toISOString(), updatedByName };
  // JSON round-trip drops undefined (Firestore rejects it) and detaches from caller objects.
  await ref(db, collegeId).set(JSON.parse(JSON.stringify(next)));
  return next;
}
