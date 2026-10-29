// College setting "Website Display Name" (Settings > Website Display Name, colleges/{id}/settings/displayName).
//
// A faculty member enters a Display Name (surname short form + name) on their profile. WHERE it is used instead of
// their Full Name is the college's choice, one tick per place. Every place that shows a faculty name and is meant
// to follow this setting is one entry in DISPLAY_NAME_SURFACES - the Settings card lists the registry, so a new
// faculty-related place only needs (1) an entry here and (2) its code calling displayNameFor(..., key).

export interface DisplayNameSurface {
  key: string;
  /** The faculty-related module this place belongs to (the card groups its ticks by module). */
  module: string;
  label: string;
  description: string;
  /** False = listed so the admin can see it is planned, but its code does not use the setting yet (cannot be ticked). */
  ready: boolean;
}

export const DISPLAY_NAME_SURFACES: DisplayNameSurface[] = [
  { key: "publicProfile", module: "Website", label: "Public faculty profile", ready: true,
    description: "The name on a faculty member's public profile page (the link anyone can open)." },
  { key: "resume", module: "Resume", label: "Resume (PDF and preview)", ready: true,
    description: "The name in the heading of a faculty resume. The \"Full Name (as per SSC)\" line inside it stays the real name." },
  { key: "sectionTimetable", module: "Timetable", label: "Section timetable - faculty and Class I/C", ready: true,
    description: "Faculty names in the cells, the subject list and the Class I/C line of a section timetable - on screen, PDF, print and Excel (including the Principal's all-sections downloads)." },
  { key: "individualTimetable", module: "Timetable", label: "Individual faculty timetable", ready: true,
    description: "The faculty name on a faculty member's own timetable PDF / Excel: HOD > Timetable > Individual timetable, and the Teaching Load page downloads." },
  { key: "teachingLoad", module: "Teaching", label: "Teaching load and assignments", ready: true,
    description: "Faculty names on the HOD Teaching Assignments page and its PDF / Excel, and the Teaching Load tab of a faculty profile and its downloads." },
  { key: "facultyLists", module: "Faculty records", label: "Faculty lists", ready: true,
    description: "The name (and avatar) in the HOD, Principal and College Office faculty lists. CSV exports and official records keep the Full Name." },
  { key: "attendanceLeave", module: "Attendance and leave", label: "Attendance and leave", ready: true,
    description: "Faculty names in the Leave History Register (and its export), leave profiles, leave approval cover lists, Faculty Not Posted and Faculty Attendance Completion reports." },
  { key: "dashboardName", module: "Dashboard", label: "Dashboard greeting and sidebar name", ready: true,
    description: "The faculty member's own name in the \"Hello, ...\" / \"Welcome, ...\" greeting on their dashboard (faculty and HOD) and in the name card at the bottom of the sidebar / mobile menu." },
  { key: "mentoring", module: "Mentoring", label: "Student mentoring", ready: true,
    description: "The mentor's name on the HOD mentoring pages (assign, browse, my mentees) and the Principal's student finder." },
];

export type DisplayNameSurfaceKey = (typeof DISPLAY_NAME_SURFACES)[number]["key"];

export type DisplayNameSettings = Record<string, boolean>;

/** Stored settings -> one boolean per known surface (missing / unknown = off). */
export function readDisplayNameSettings(raw: unknown): DisplayNameSettings {
  const surfaces = (typeof raw === "object" && raw !== null ? (raw as { surfaces?: unknown }).surfaces : undefined) as Record<string, unknown> | undefined;
  return Object.fromEntries(DISPLAY_NAME_SURFACES.map((s) => [s.key, surfaces?.[s.key] === true && s.ready]));
}

/** A request body's `surfaces` -> the booleans to store; an unknown key or non-boolean is an error. */
export function normalizeDisplayNameSettings(raw: unknown): { ok: true; surfaces: DisplayNameSettings } | { ok: false; error: string } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { ok: false, error: "surfaces must be an object" };
  const input = raw as Record<string, unknown>;
  const byKey = new Map(DISPLAY_NAME_SURFACES.map((s) => [s.key, s]));
  for (const [k, v] of Object.entries(input)) {
    const place = byKey.get(k);
    if (!place) return { ok: false, error: `Unknown place: ${k}` };
    if (typeof v !== "boolean") return { ok: false, error: `${k} must be true or false` };
    if (v && !place.ready) return { ok: false, error: `${place.label} does not use the display name yet` };
  }
  return { ok: true, surfaces: Object.fromEntries(DISPLAY_NAME_SURFACES.map((s) => [s.key, input[s.key] === true])) };
}

/** "AV" + "VENU GOPAL" -> "AV VENU GOPAL"; with the person's honorific "Dr" -> "Dr.AV VENU GOPAL" (same "Dr.Name" form as facultyDisplayName). */
export function formatDisplayName(surname: string, name: string, honorific?: unknown): string {
  const base = `${surname.trim()} ${name.trim()}`.trim();
  const raw = typeof honorific === "string" ? honorific.trim().replace(/\.+$/, "") : "";
  if (!base || !raw) return base;
  return `${raw.charAt(0).toUpperCase()}${raw.slice(1).toLowerCase()}.${base}`;
}

/**
 * The name to show for a faculty member in one place: their Display Name when the college ticked that place AND
 * the person has filled in both parts, otherwise the usual name (`fallback`).
 */
export function displayNameFor(
  faculty: { displaySurname?: unknown; displayName?: unknown; honorific?: unknown },
  settings: DisplayNameSettings,
  surfaceKey: DisplayNameSurfaceKey,
  fallback: string,
): string {
  if (!settings[surfaceKey]) return fallback;
  const surname = typeof faculty.displaySurname === "string" ? faculty.displaySurname.trim() : "";
  const name = typeof faculty.displayName === "string" ? faculty.displayName.trim() : "";
  return surname && name ? formatDisplayName(surname, name, faculty.honorific) : fallback;
}
