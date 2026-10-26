export interface HonorificPlanRow {
  id: string; employeeId: string; legalName: string; status: string; honorific: unknown; target?: string; userUid?: string | null;
}
export interface HonorificPlan {
  collegeId: string; catalog: string[]; dr: string | null; phd: number;
  willSet: HonorificPlanRow[]; alreadyHave: number; conflicts: HonorificPlanRow[]; skippedNoName: HonorificPlanRow[]; skippedNoCatalogDr: number;
}
export interface HonorificChange {
  collegeId: string; facultyId: string; employeeId: string; legalName: string;
  before: { honorific: unknown; present: boolean }; after: { honorific: string };
}
export interface HonorificResult extends HonorificChange {
  result: { ok: boolean; reason?: string; oldName?: string; newName?: string; login?: boolean; systemLogin?: boolean; assignments?: number; slots?: number; sections?: number };
}
export function activeHonorificNames(db: unknown, collegeId: string): Promise<string[]>;
export function planPhdHonorific(db: unknown, collegeId: string): Promise<HonorificPlan>;
export function setFacultyHonorific(db: unknown, collegeId: string, facultyId: string, honorific: string | null): Promise<HonorificResult["result"]>;
export function applyPlans(db: unknown, plans: HonorificPlan[], saveLog: (log: { takenAt: string; changes: HonorificChange[] }) => void): Promise<HonorificResult[]>;
export function revertLog(db: unknown, log: { changes: HonorificChange[] }): Promise<HonorificResult[]>;
