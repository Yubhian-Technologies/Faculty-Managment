// Public surface of the approvals engine. Import from "@/lib/approvals" - the
// individual files are an implementation detail.
export * from "./types";
export * from "./stateMachine";
export * from "./config";
export * from "./ports";
export { createApprovalEngine } from "./engine";
export type { ApprovalEngine, EngineDeps, SubmitInput } from "./engine";
export { createFirestoreStore, APPROVAL_COLLECTION } from "./firestoreStore";
export { createMemoryStore } from "./memoryStore";
