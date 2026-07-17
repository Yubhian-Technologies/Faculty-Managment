// Shared academic-year helpers used by college/academic-years/route.ts and the
// admin/colleges "Academic Years" UI. Years are added sequentially (1, 2, 3, …)
// by Location Admin / Principal — a college can have any number of years of
// study (3-year diploma, 4-year B.Tech, 5-year, etc.), so there's no fixed
// upper bound and no on/off toggle, just ordinal labels generated on the fly.

export function yearOrdinalLabel(yearNumber: number): string {
  const n = Math.abs(Math.trunc(yearNumber));
  const suffix =
    n % 100 >= 11 && n % 100 <= 13 ? "th"
    : n % 10 === 1 ? "st"
    : n % 10 === 2 ? "nd"
    : n % 10 === 3 ? "rd"
    : "th";
  return `${n}${suffix} Year`;
}

export async function ensureAcademicYear(
  db: FirebaseFirestore.Firestore,
  collegeId: string,
  yearNumber: number
): Promise<string> {
  const collection = db.collection("colleges").doc(collegeId).collection("academicYears");
  const existing = await collection.where("yearNumber", "==", yearNumber).limit(1).get();
  const now = new Date();

  if (!existing.empty) {
    const ref = existing.docs[0].ref;
    await ref.update({ isActive: true, updatedAt: now });
    return ref.id;
  }

  const ref = await collection.add({
    collegeId,
    yearNumber,
    label: yearOrdinalLabel(yearNumber),
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  return ref.id;
}
