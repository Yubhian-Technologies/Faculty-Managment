import type { Firestore } from "firebase-admin/firestore";
import { createApprovalEngine, createFirestoreStore } from "@/lib/approvals";
import { studentPermissionKind } from "./kind";
import { createPermissionEventSink } from "./notifications";
import type { ActingUser, PermissionContext } from "./types";

// Where the approvals engine is assembled for this kind: the Firestore store, the
// kind, and the notification sink. The use-case files call these, never the
// concrete adapters.

export const ctxOf = (db: Firestore, user: ActingUser): PermissionContext => ({ db, collegeId: user.collegeId, actorRoles: user.roles });
export const store = (db: Firestore) => createFirestoreStore(db);
export const engine = (db: Firestore) => createApprovalEngine({ kind: studentPermissionKind, store: store(db), onEvent: createPermissionEventSink(db) });
