// Rooms created before benches existed only have a `capacity`; read them as
// that many benches with one student each, so nothing breaks until College
// Office edits them.
export function roomBenches(r: { benches?: number; capacity: number }): number {
  return r.benches ?? r.capacity;
}

export function roomPerBench(r: { studentsPerBench?: number; perBench?: number }): number {
  return r.studentsPerBench ?? r.perBench ?? 1;
}
