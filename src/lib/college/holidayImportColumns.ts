// CSV column definitions for College Office's bulk Holiday import - a
// simpler alternative to adding each one through the Add Holiday dialog when
// there's a whole academic calendar to enter at once. See
// api/college/holidays/import/route.ts.

export interface HolidayImportCsvColumn {
  key: string;
  label: string;
  required: boolean;
  sample: string;
  aliases?: string[];
}

export const HOLIDAY_IMPORT_COLUMNS: HolidayImportCsvColumn[] = [
  { key: "sno", label: "S.No", required: false, sample: "1", aliases: ["Sno", "S No", "Serial No", "Serial Number"] },
  { key: "occasion", label: "Occasion", required: true, sample: "Independence Day", aliases: ["Holiday", "Name", "Event"] },
  { key: "date", label: "Date (YYYY-MM-DD)", required: true, sample: "2026-08-15", aliases: ["Date"] },
  { key: "type", label: "Type", required: false, sample: "National", aliases: ["Holiday Type"] },
  { key: "hostelersOutingAllowed", label: "Hostellers Outing", required: false, sample: "No", aliases: ["Hostelers Outing", "Hostellers Permitted", "Hostelers Permitted", "Outing"] },
];

/** Hostellers Outing column: yes / no. Blank = not stated (undefined); null = unrecognised. */
export function parseOutingFlag(raw: string | undefined): boolean | undefined | null {
  const t = (raw ?? "").trim().toLowerCase();
  if (!t) return undefined;
  if (["yes", "y", "true", "permitted", "allowed"].includes(t)) return true;
  if (["no", "n", "false", "not permitted", "not allowed"].includes(t)) return false;
  return null;
}

export const HOLIDAY_IMPORT_HINTS = [
  "S.No is optional - it's just for your own reference in the file and isn't stored.",
  "Occasion and Date are required for every row.",
  "Date must be in YYYY-MM-DD format (e.g. 2026-08-15).",
  "Type must be one of National, Regional, College or Restricted (not case-sensitive) - leave blank to default to College.",
  "Every imported holiday is a regular holiday for faculty and students. Compensatory holidays, classwork suspensions and sem breaks are added on the Holidays page.",
  "Hostellers Outing is optional: Yes or No - are hostellers permitted to go out on that day. Blank leaves it unstated.",
];
