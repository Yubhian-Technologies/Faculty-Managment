// A timetable change made by the College Admin / Principal (role PRINCIPAL - a College Admin is normalized to it)
// is stamped on the section: sections/{id}.timetableAdminUpdate { byUid, byName, at } - shown as
// "Updated by <name> (Admin) on <date>" on the timetable. Best-effort: never fails the change itself.

export async function stampTimetableAdminUpdate(
  db: FirebaseFirestore.Firestore,
  collegeId: string,
  sectionId: string | undefined,
  session: { uid: string; role: string },
): Promise<void> {
  if (session.role !== "PRINCIPAL" || !sectionId) return;
  try {
    const college = db.collection("colleges").doc(collegeId);
    const name = ((await college.collection("users").doc(session.uid).get()).data() as { name?: string } | undefined)?.name ?? "";
    await college.collection("sections").doc(sectionId).update({ timetableAdminUpdate: { byUid: session.uid, byName: name, at: new Date() } });
  } catch (err) {
    console.error("[timetable/adminStamp]", err);
  }
}
