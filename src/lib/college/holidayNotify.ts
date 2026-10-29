import type { Firestore } from "firebase-admin/firestore";
import type { HolidayAudience, HolidayCategory } from "@/types";
import { batchNotify } from "@/lib/notify";

// Tells people a holiday has been declared, in their notification bell. Who hears depends on who the
// day is off for: "Students only" holidays and students-only class suspensions reach students alone;
// everything else reaches every active login of the college (faculty, staff, students). Never throws -
// the holiday is already saved, a failed notification must not undo it.

const HEADLINE: Record<HolidayCategory, string> = {
  REGULAR: "Holiday declared",
  BRIDGE: "Compensatory holiday declared",
  CLASS_SUSPENDED: "Classwork suspended",
};

function longDate(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-IN", {
    weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
  });
}

export async function notifyHolidayDeclared(
  db: Firestore,
  collegeId: string,
  holiday: { name: string; dateKey: string; category: HolidayCategory; appliesTo: HolidayAudience }
): Promise<void> {
  try {
    const studentsOnly = holiday.appliesTo === "STUDENTS";
    const snap = await db.collection("colleges").doc(collegeId).collection("users").select("role", "isActive").get();
    const toUids = snap.docs
      .filter((d) => {
        const u = d.data() as { role?: string; isActive?: boolean };
        if (u.isActive === false) return false;
        return studentsOnly ? u.role === "STUDENT" : true;
      })
      .map((d) => d.id);
    const what = holiday.category === "CLASS_SUSPENDED" ? "Classes are suspended" : "Holiday";
    await batchNotify(
      db, collegeId, toUids, "HOLIDAY_DECLARED",
      HEADLINE[holiday.category],
      `${what} on ${longDate(holiday.dateKey)}: ${holiday.name}${studentsOnly ? " (students only)" : ""}.`
    );
  } catch (err) {
    console.error("[notifyHolidayDeclared]", err);
  }
}
