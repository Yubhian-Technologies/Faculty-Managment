import type { Firestore } from "firebase-admin/firestore";
import type { SectionLabBatchSetting } from "@/types";

// Per section and lab (PRACTICAL subject): batch by batch, or the whole section
// together - see SectionLabBatchSetting. With no setting at all nothing changes:
// a split lab period uses its own batch label. Otherwise:
//   - "no batch" (batchWise false): the lab's periods ignore their batch label -
//     whole-section roster, visible to every student.
//   - batch-wise (true): each of the lab's faculty can be given one batch
//     (Faculty A -> Batch 1, Faculty B -> Batch 2); that faculty's periods use it.

export const LAB_BATCH_SETTINGS = "sectionLabBatchSettings";

export const labBatchSettingId = (sectionId: string, subjectId: string) => `${sectionId}_${subjectId}`;

export const normalizeBatch = (value: string | null | undefined) => (value ?? "").trim().toLowerCase();

export interface LabBatchMode {
  batchWise: boolean;
  /** facultyMembers doc id -> batch label. */
  batchByFaculty: Record<string, string>;
}

/** settingId (`${sectionId}_${subjectId}`) -> its mode. A lab with no setting is absent. */
export type LabBatchModes = Map<string, LabBatchMode>;

export async function loadLabBatchModes(
  db: Firestore,
  collegeId: string,
  pairs: { sectionId?: string; subjectId?: string }[],
): Promise<LabBatchModes> {
  const ids = Array.from(new Set(
    pairs.filter((p) => p.sectionId && p.subjectId).map((p) => labBatchSettingId(p.sectionId as string, p.subjectId as string)),
  ));
  const out: LabBatchModes = new Map();
  if (ids.length === 0) return out;
  const col = db.collection("colleges").doc(collegeId).collection(LAB_BATCH_SETTINGS);
  const snaps = await db.getAll(...ids.map((id) => col.doc(id)));
  for (const s of snaps) {
    if (!s.exists) continue;
    const d = s.data() as SectionLabBatchSetting;
    out.set(s.id, { batchWise: d.batchWise !== false, batchByFaculty: d.batchByFaculty ?? {} });
  }
  return out;
}

/**
 * The batch a period's roster / visibility should actually use, for the faculty
 * the period belongs to (`facultyId` = the assignment's own faculty, not a
 * substitute): none when its lab is set to "no batch"; the faculty's own batch when
 * the lab is batch-wise and gave them one; else the period's own label.
 */
export function effectiveLabBatch(
  slotLabBatch: string | null | undefined,
  modes: LabBatchModes,
  sectionId: string | undefined,
  subjectId: string | undefined,
  facultyId?: string,
): string | undefined {
  const mode = sectionId && subjectId ? modes.get(labBatchSettingId(sectionId, subjectId)) : undefined;
  if (!mode) return slotLabBatch || undefined;
  if (!mode.batchWise) return undefined;
  const mine = facultyId ? mode.batchByFaculty[facultyId] : undefined;
  return mine || slotLabBatch || undefined;
}
