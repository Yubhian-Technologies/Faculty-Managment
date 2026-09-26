// A college's financial year period, set explicitly by start/end date (so a
// non-April-March year works). Labelled like the existing budget cycles use,
// e.g. 2026-04-01..2027-03-31 -> "2026-27".

export function financialYearLabel(startDate: string, endDate: string): string {
  const s = Number(startDate.slice(0, 4));
  const e = Number(endDate.slice(0, 4));
  return s === e ? String(s) : `${s}-${String(e % 100).padStart(2, "0")}`;
}

export interface FinancialYearItem {
  id: string;
  label: string;
  startDate: string; // YYYY-MM-DD
  endDate: string;
}

export function financialYearContaining(list: FinancialYearItem[], isoDate: string): FinancialYearItem | undefined {
  return list.find((f) => isoDate >= f.startDate && isoDate <= f.endDate);
}
