// A record shows for the person who submitted it (`uid`) AND for every internal faculty member
// named on it (`internalAuthorUids`: Co-PI, inventor, ...) - from the moment it is submitted, not
// only once it is verified, so a named colleague sees it (and doesn't enter it a second time, or
// spot a wrong name) while it is still pending. Both queries merged by doc id.
export async function fetchOwnAndCoListed(
  coll: FirebaseFirestore.CollectionReference, targetUid: string
): Promise<Array<Record<string, unknown> & { id: string }>> {
  const [own, listed] = await Promise.all([
    coll.where("uid", "==", targetUid).get(),
    coll.where("internalAuthorUids", "array-contains", targetUid).get(),
  ]);
  const byId = new Map<string, Record<string, unknown> & { id: string }>();
  for (const d of [...own.docs, ...listed.docs]) byId.set(d.id, { id: d.id, ...d.data() });
  return [...byId.values()];
}
