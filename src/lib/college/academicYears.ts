// Shared academic-year upsert used by college/academic-years/route.ts and by
// the admin/colleges creation wizard (Administration sets up years of study
// for a college in the same request it creates the college in).

export const YEAR_LABELS: Record<number, string> = { 1: "1st Year", 2: "2nd Year", 3: "3rd Year", 4: "4th Year" };

export async function ensureAcademicYear(
  db: FirebaseFirestore.Firestore,
  collegeId: string,
  yearNumber: number,
  isActive = true
): Promise<string> {
  const collection = db.collection("colleges").doc(collegeId).collection("academicYears");
  const existing = await collection.where("yearNumber", "==", yearNumber).limit(1).get();
  const now = new Date();

  if (!existing.empty) {
    const ref = existing.docs[0].ref;
    await ref.update({ isActive, updatedAt: now });
    return ref.id;
  }

  const ref = await collection.add({
    collegeId,
    yearNumber,
    label: YEAR_LABELS[yearNumber],
    isActive,
    createdAt: now,
    updatedAt: now,
  });
  return ref.id;
}
