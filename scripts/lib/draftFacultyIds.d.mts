export function facultyIdsOf(slots: unknown): string[];
export function planDraftFacultyIds(drafts: { id: string; data: Record<string, unknown> }[]): {
  updates: { id: string; facultyIds: string[]; previous: string[] | null }[];
  alreadyCorrect: number;
};
