import { FieldValue } from "firebase-admin/firestore";
import type { TrainingEntry } from "@/types";
import { migrateAcademicProfile, migrateTrainingEntries } from "./fieldRenames";

// Keeps a co-conducted FDP/Workshop/MOOC entry in sync onto each
// co-conductor's own facultyMembers doc. The coordinator's own copy (wherever
// this entry lives in THEIR fdpsWorkshopsMoocsCertifications array) is the master; this never
// touches it - only the OTHER participants' copies. One-directional by
// design: a co-conductor's own copy renders read-only in the form
// (TrainingEntryFields, `isCoConductedCopy`), so there is never a conflicting
// edit to reconcile the other way.
//
// Only entries with an `id` are sync-eligible (a fresh row gets one the
// moment a co-conductor is first added - see TrainingEntryFields). Matching
// across saves is by that `id`, not array position.
//
// Called after the coordinator's own doc has already been written, from both
// PATCH /api/college/faculty/[id] and PATCH /api/college/faculty/me, wrapped
// in try/catch by the caller - a sync failure must never block the primary
// save (same "best-effort cross-doc sync" convention already used a few
// lines below in [id]/route.ts for the linked-login name/photo sync).
export async function syncTrainingEntryCoConductors(
  db: FirebaseFirestore.Firestore,
  collegeId: string,
  ownerFacultyId: string,
  ownerFacultyName: string,
  previousEntries: TrainingEntry[] | undefined,
  nextEntries: TrainingEntry[] | undefined
): Promise<void> {
  // Both lists may still be in the legacy key shape (previousEntries comes
  // straight from an un-migrated Firestore doc) - lift them to the current one.
  previousEntries = migrateTrainingEntries(previousEntries) as TrainingEntry[] | undefined;
  nextEntries = migrateTrainingEntries(nextEntries) as TrainingEntry[] | undefined;
  const prevById = new Map<string, TrainingEntry>();
  for (const e of previousEntries ?? []) {
    if (e.id && !e.isCoConductedCopy) prevById.set(e.id, e);
  }
  const nextById = new Map<string, TrainingEntry>();
  for (const e of nextEntries ?? []) {
    if (e.id && !e.isCoConductedCopy) nextById.set(e.id, e);
  }

  const relevantIds = new Set<string>();
  for (const [id, e] of prevById) if ((e.coConductingFaculty?.length ?? 0) > 0) relevantIds.add(id);
  for (const [id, e] of nextById) if ((e.coConductingFaculty?.length ?? 0) > 0) relevantIds.add(id);
  if (relevantIds.size === 0) return;

  // facultyId -> { toDelete: entry ids, toUpsert: entries }
  const deletesByFaculty = new Map<string, Set<string>>();
  const upsertsByFaculty = new Map<string, TrainingEntry[]>();

  for (const id of relevantIds) {
    const prev = prevById.get(id);
    const next = nextById.get(id);
    const oldParticipants = new Set((prev?.coConductingFaculty ?? []).map((c) => c.facultyId));
    const newParticipants = new Set((next?.coConductingFaculty ?? []).map((c) => c.facultyId));

    for (const facultyId of oldParticipants) {
      if (!newParticipants.has(facultyId)) {
        if (!deletesByFaculty.has(facultyId)) deletesByFaculty.set(facultyId, new Set());
        deletesByFaculty.get(facultyId)!.add(id);
      }
    }

    if (next) {
      const copy: TrainingEntry = {
        ...next,
        // Guard against a master entry whose own coordinator name was never
        // properly kept in sync (a stale/blank value would otherwise get
        // copied verbatim, leaving every co-conductor's copy blank too).
        nameOfTheFacultyCoordinator: next.nameOfTheFacultyCoordinator || ownerFacultyName,
        ownerFacultyId,
        ownerFacultyName,
        isCoConductedCopy: true,
      };
      for (const facultyId of newParticipants) {
        if (!upsertsByFaculty.has(facultyId)) upsertsByFaculty.set(facultyId, []);
        upsertsByFaculty.get(facultyId)!.push(copy);
      }
    }
  }

  const affectedFacultyIds = new Set([...deletesByFaculty.keys(), ...upsertsByFaculty.keys()]);
  affectedFacultyIds.delete(ownerFacultyId);
  if (affectedFacultyIds.size === 0) return;

  const collegeRef = db.collection("colleges").doc(collegeId);
  const facultyColl = collegeRef.collection("facultyMembers");

  await db.runTransaction(async (tx) => {
    const refs = [...affectedFacultyIds].map((id) => facultyColl.doc(id));
    // tx.getAll(...) - not Promise.all(refs.map(ref => tx.get(ref))) - is the
    // supported way to read several docs within one transaction; concurrent
    // individual tx.get() calls on the same transaction aren't reliable.
    const snaps = await tx.getAll(...refs);

    snaps.forEach((snap, i) => {
      if (!snap.exists) return;
      const facultyId = refs[i].id;
      // Other faculty docs may still hold the legacy key names - read their
      // list through the registry (the legacy `trainingEntries` key included).
      const data = snap.data() as { academicProfile?: unknown };
      const profile = migrateAcademicProfile(data.academicProfile) as
        | { fdpsWorkshopsMoocsCertifications?: TrainingEntry[] }
        | undefined;
      const existing = profile?.fdpsWorkshopsMoocsCertifications ?? [];

      const idsToDelete = deletesByFaculty.get(facultyId) ?? new Set<string>();
      const toUpsert = upsertsByFaculty.get(facultyId) ?? [];
      const upsertIds = new Set(toUpsert.map((e) => e.id));

      const kept = existing.filter((e) => !(e.id && (idsToDelete.has(e.id) || upsertIds.has(e.id))));
      const nextTrainingEntries = [...kept, ...toUpsert];

      tx.update(refs[i], {
        "academicProfile.fdpsWorkshopsMoocsCertifications": nextTrainingEntries,
        // A doc must never hold both the new list and its legacy twin.
        "academicProfile.trainingEntries": FieldValue.delete(),
        updatedAt: new Date(),
      });
    });
  });
}
