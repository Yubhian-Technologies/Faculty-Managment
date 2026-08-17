// Resolves the "who to contact" block for an offer/appointment-letter email:
// prefers the batch's assigned Interview Coordinator's phone/email; if there's
// no coordinator assigned, or the coordinator has neither phone nor email on
// file, falls back to the batch's HOD so the candidate is never left with no
// one to contact. Shared by every offer-email composer (college-office/offers,
// college-office/documents/candidate/[applicationId], accounts/hiring) so the
// fallback rule lives in one place instead of three hand-synced copies.
export async function resolveOfferContactBlock(params: {
  coordinatorUid?: string;
  coordinatorName?: string;
  hodUid?: string;
  hodName?: string;
}): Promise<string> {
  const { coordinatorUid, coordinatorName, hodUid, hodName } = params;
  if (!coordinatorUid && !hodUid) return "";

  type UsersRes = { users?: { uid: string; phone?: string; email?: string }[] };
  const usersRes = await fetch("/api/college/users?allDepts=true&includeAll=true")
    .then((r) => r.json() as Promise<UsersRes>)
    .catch((): UsersRes => ({}));
  const users = usersRes.users ?? [];

  const coordinator = coordinatorUid ? users.find((u) => u.uid === coordinatorUid) : undefined;
  const coordinatorHasContact = !!(coordinator?.phone || coordinator?.email);

  const person = coordinatorHasContact
    ? { name: coordinatorName, phone: coordinator?.phone, email: coordinator?.email, label: "Interview Coordinator" }
    : (() => {
        const hod = hodUid ? users.find((u) => u.uid === hodUid) : undefined;
        return { name: hodName, phone: hod?.phone, email: hod?.email, label: "Department HOD" };
      })();

  const lines = [person.name, person.phone ? `Phone: ${person.phone}` : "", person.email ? `Email: ${person.email}` : ""].filter(Boolean);
  return lines.length > 0 ? `\nFor any queries, please contact your ${person.label}:\n${lines.join("\n")}\n` : "";
}
