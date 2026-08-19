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
];

export const HOLIDAY_IMPORT_HINTS = [
  "S.No is optional - it's just for your own reference in the file and isn't stored.",
  "Occasion and Date are required for every row.",
  "Date must be in YYYY-MM-DD format (e.g. 2026-08-15).",
  "Type must be one of National, Regional, College or Restricted (not case-sensitive) - leave blank to default to College.",
  "Every imported holiday applies to both faculty and students - edit its Applies To afterward from the Holidays list if a specific one needs to be students-only.",
];
