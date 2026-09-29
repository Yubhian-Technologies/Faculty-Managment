// Small pure math module, same convention as studentAttendance/shortage.ts -
// unit-testable in isolation, no Firestore/Next.js imports.
export function calcFine(dueAt: Date, returnedAt: Date, perDayRate: number): number {
  const daysLate = Math.max(0, Math.floor((returnedAt.getTime() - dueAt.getTime()) / 86_400_000));
  return daysLate * perDayRate;
}

export function isOverdue(dueAt: Date, asOf: Date = new Date()): boolean {
  return asOf.getTime() > dueAt.getTime();
}

export function daysOverdue(dueAt: Date, asOf: Date = new Date()): number {
  return Math.max(0, Math.floor((asOf.getTime() - dueAt.getTime()) / 86_400_000));
}
