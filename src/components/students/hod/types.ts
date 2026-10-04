import type { StudentListItem, Section } from "@/types";

export type StudentRow = Record<string, unknown> & StudentListItem;
export type SectionRow = Section & { id: string; accessLevel?: "primary" | "secondary" };
