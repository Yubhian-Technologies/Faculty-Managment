export const normalizeCode: (c: unknown) => string;
export const normalizeName: (n: unknown) => string;
export const codeKeyId: (scope: string, regulation: string, code: string) => string;
export const nameKeyId: (scope: string, regulation: string, name: string) => string;
export interface PlanMember { id: string; scope: string; regulation: string; code: string; rawCode?: string; name: string; nameKey: string; courseId: string; used: number; isActive: boolean }
export interface PlanClash { scope: string; regulation: string; field: "code" | "name"; value: string; members: PlanMember[] }
export function planSubjectKeys(
  subjects: { id: string; data: Record<string, any> }[],
  courses: { id: string; data: Record<string, any> }[],
  usage?: Map<string, number>,
): {
  legacy: string[];
  unscoped: { id: string; code: string; reason: string }[];
  clashes: PlanClash[];
  keys: { id: string; field: "code" | "name"; subjectId: string }[];
  subjectFixes: { id: string; set: { catalogId?: string; nameKey?: string; code?: string } }[];
};
