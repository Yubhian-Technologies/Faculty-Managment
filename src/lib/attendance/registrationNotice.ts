import { getDepartmentHeadUids, notify, notifyRole } from "@/lib/notify";
import { writeAuditLogSafe } from "@/lib/audit/safeAuditLog";

// Every change to someone's self check-in registration (face registered, phone registered, registration reset)
// is audited and told to whoever can reset it: the department's HOD(s); for an HOD (or someone with no
// department HOD) the Principal. A registration on a colleague's phone / face therefore never goes unnoticed.

type Db = FirebaseFirestore.Firestore;
export type RegistrationEvent = "FACE_REGISTERED" | "PHONE_REGISTERED" | "RESET";

const TEXT: Record<RegistrationEvent, (name: string, detail: string) => { title: string; message: string }> = {
  FACE_REGISTERED: (n) => ({ title: "Face registered for check-in", message: `${n} registered their face for attendance check-in.` }),
  PHONE_REGISTERED: (n, d) => ({ title: "Phone registered for check-in", message: `${n} registered a phone${d ? ` (${d})` : ""} for attendance check-in.` }),
  RESET: (n, d) => ({ title: "Check-in registration reset", message: `${d || "Someone"} reset ${n}'s attendance check-in registration (face and phone). They register again at their next check-in.` }),
};

export async function noticeRegistration(db: Db, collegeId: string, args: {
  event: RegistrationEvent; personUid: string; actorUid: string; detail?: string;
}): Promise<void> {
  try {
    const users = db.collection("colleges").doc(collegeId).collection("users");
    const [person, actor] = await Promise.all([users.doc(args.personUid).get(), users.doc(args.actorUid).get()]);
    const p = person.data() as { name?: string; department?: string } | undefined;
    const actorName = (actor.data() as { name?: string } | undefined)?.name ?? "";
    const name = p?.name ?? "A staff member";
    await writeAuditLogSafe(db, collegeId, {
      action: `CHECK_IN_${args.event}`, performedBy: args.actorUid, performedByName: actorName, targetId: args.personUid,
      details: { person: name, ...(args.detail ? { detail: args.detail } : {}) },
    });
    const { title, message } = TEXT[args.event](name, args.event === "RESET" ? actorName : args.detail ?? "");
    const heads = p?.department ? (await getDepartmentHeadUids(db, collegeId, p.department)).filter((u) => u !== args.personUid) : [];
    const to = heads.filter((u) => u !== args.actorUid);
    if (to.length) {
      for (const uid of to) await notify(db, collegeId, uid, `CHECK_IN_${args.event}`, title, message, "/hod/attendance");
    } else if (!heads.length) {
      // An HOD themselves, or no HOD for the department: the Principal looks after it.
      await notifyRole(db, collegeId, "PRINCIPAL", `CHECK_IN_${args.event}`, title, message, "/principal/attendance");
    }
    // The person is told when someone else changed their registration.
    if (args.actorUid !== args.personUid) {
      await notify(db, collegeId, args.personUid, `CHECK_IN_${args.event}`, title, message, "/panel/attendance");
    }
  } catch (err) {
    console.error("[attendance/registrationNotice]", err);
  }
}
