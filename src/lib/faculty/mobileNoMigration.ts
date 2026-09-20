// Pure decision logic for scripts/migrate-faculty-phone-to-mobileno.mjs (which imports this
// file directly), kept here so the unit tests exercise the exact code the migration runs.
//
// facultyMembers.phone -> facultyMembers.mobileNo. Values are copied verbatim (empty
// strings included, odd-looking numbers included). A doc with neither key is left alone.
// Two differing non-empty values are a CONFLICT and are never resolved automatically.

export type MobileNoPlan =
  | { kind: "none" } //          no `phone` key: nothing to do (already migrated, or never had one)
  | { kind: "rename"; mobileNo: string } //      only `phone` -> set mobileNo, delete phone
  | { kind: "fill"; mobileNo: string } //        both keys, mobileNo empty -> take phone, delete phone
  | { kind: "drop-phone" } //    both keys, equal (or phone empty) -> delete phone, keep mobileNo
  | { kind: "conflict" } //      both keys, different non-empty values -> report, touch nothing
  | { kind: "non-string" }; //   a value that is not a string -> report, touch nothing

export function planMobileNo(doc: Record<string, unknown>): MobileNoPlan {
  if (!("phone" in doc)) return { kind: "none" };
  const phone = doc.phone;
  if (typeof phone !== "string") return { kind: "non-string" };
  if (!("mobileNo" in doc)) return { kind: "rename", mobileNo: phone };
  const mobileNo = doc.mobileNo;
  if (typeof mobileNo !== "string") return { kind: "non-string" };
  if (phone.trim() === mobileNo.trim()) return { kind: "drop-phone" };
  if (mobileNo.trim() === "") return { kind: "fill", mobileNo: phone };
  if (phone.trim() === "") return { kind: "drop-phone" };
  return { kind: "conflict" };
}

// What a plan changes on the document, as the two keys' final state.
// `mobileNo: undefined` means "leave it as it is"; `deletePhone` removes the old key.
export function mobileNoChange(plan: MobileNoPlan): { mobileNo?: string; deletePhone: boolean } | null {
  switch (plan.kind) {
    case "rename":
    case "fill":
      return { mobileNo: plan.mobileNo, deletePhone: true };
    case "drop-phone":
      return { deletePhone: true };
    default:
      return null;
  }
}
