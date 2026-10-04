/**
 * Stamps `dateKey` (IST YYYY-MM-DD) on existing attendanceRecords and, per college,
 * writes the marker colleges/{id}/counters/attendanceDateKeys {backfilled:true} that
 * switches the attendance report onto the fast per-date query.
 *
 * The date comes from the document id (`${uid}_${YYYY-MM-DD}`); a record whose id
 * doesn't match that shape is reported and left alone. Because one bad record would
 * make the fast path incomplete, the marker is only written for a college when EVERY
 * record in it has a dateKey afterwards.
 *
 * DRY RUN by default; --apply writes (after saving a backup of the changed docs'
 * previous values). Idempotent. Restrict with --college=<id>.
 *
 * Usage: node scripts/backfill-attendance-date-keys.mjs [--college=<id>] [--apply]
 */
import { init, parseArgs, writeBackup, banner } from "./lib/scriptKit.mjs";
import { FieldValue } from "firebase-admin/firestore";

const { apply, opt } = parseArgs();
const onlyCollege = opt("college");
const { db } = init();
banner(apply);

const ID_DATE = /_(\d{4}-\d{2}-\d{2})$/;
const colleges = onlyCollege
  ? [{ id: onlyCollege }]
  : (await db.collection("colleges").select().get()).docs.map((d) => ({ id: d.id }));

const backup = [];
let total = 0, toStamp = 0, unparseable = 0;
const perCollege = [];

for (const { id } of colleges) {
  const snap = await db.collection("colleges").doc(id).collection("attendanceRecords").select("dateKey").get();
  const writes = [];
  let bad = 0;
  for (const d of snap.docs) {
    total++;
    if (typeof d.get("dateKey") === "string" && d.get("dateKey")) continue;
    const m = ID_DATE.exec(d.id);
    if (!m) { bad++; unparseable++; console.log(`  unparseable id (left alone): colleges/${id}/attendanceRecords/${d.id}`); continue; }
    writes.push({ ref: d.ref, dateKey: m[1] });
    backup.push({ path: d.ref.path, dateKey: null });
  }
  toStamp += writes.length;
  perCollege.push({ id, records: snap.size, writes, bad });
  console.log(`College ${id}: ${snap.size} records, ${writes.length} to stamp, ${bad} unparseable`);
}
console.log(`\nTotal records: ${total}; to stamp: ${toStamp}; unparseable: ${unparseable}`);

if (!apply) {
  console.log("Dry run only - nothing written. Re-run with --apply.");
  process.exit(0);
}

if (backup.length) console.log(`Backup written: ${writeBackup("attendance-date-keys", backup)}`);
for (const c of perCollege) {
  for (let i = 0; i < c.writes.length; i += 400) {
    const batch = db.batch();
    for (const w of c.writes.slice(i, i + 400)) batch.update(w.ref, { dateKey: w.dateKey });
    await batch.commit();
  }
  if (c.bad === 0) {
    await db.collection("colleges").doc(c.id).collection("counters").doc("attendanceDateKeys")
      .set({ backfilled: true, at: FieldValue.serverTimestamp() });
    console.log(`College ${c.id}: stamped ${c.writes.length}, fast path ENABLED`);
  } else {
    console.log(`College ${c.id}: stamped ${c.writes.length}, fast path NOT enabled (${c.bad} unparseable ids)`);
  }
}
