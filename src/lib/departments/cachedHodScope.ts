import { getHodDepartmentScope, type HodDepartmentScope } from "@/lib/departments/scope";
import { cachedValue } from "@/lib/firestore/sharedReads";

/**
 * `getHodDepartmentScope` (several reads one after another) kept 20 s per server instance, for pages that only SHOW
 * data (the same window as the live-roles cache). Never for a check before a write - those call the real one.
 */
export function cachedHodScope(db: FirebaseFirestore.Firestore, collegeId: string, uid: string): Promise<HodDepartmentScope> {
  return cachedValue(`hodScope/${collegeId}/${uid}`, 20_000, () => getHodDepartmentScope(db, collegeId, uid));
}
