/**
 * READ-ONLY companion to restore-vit-employee-category.mjs. Never writes.
 *
 *   node scripts/verify-vit-employee-category.mjs --fingerprint <out.json>
 *       Hashes every field of every VIT faculty doc EXCEPT employeeCategory (plus updatedAt),
 *       so a later --verify can prove nothing else changed.
 *
 *   node scripts/verify-vit-employee-category.mjs --verify <fingerprint.json>
 *       Re-reads every VIT faculty doc straight from Firestore and reports:
 *         - count per employeeCategory value, and how many are still missing
 *         - every doc whose category differs from the Excel-derived expectation (matched by Employee ID)
 *         - Excel Employee IDs with no VIT doc
 *         - any doc whose NON-category fields (or updatedAt) differ from the fingerprint
 *
 * Options: --file <xlsx>   (default ~/Downloads/VIT_faculty_import_template -data.xlsx)
 */
import "dotenv/config";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ExcelJS from "exceljs";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const VIT_COLLEGE_ID = "bc77d03b57194edeb006";
const VIT_COLLEGE_NAME = "VISHNU INSTITUTE OF TECHNOLOGY";
const CATEGORY_MAP = {
  regular: "REGULAR", contract: "CONTRACT", visiting: "VISITING", "regular(hyd)": "REGULAR",
  "professor of practice": "PROFESSOR_OF_PRACTICE", "asst.prof. of practice": "ASST_PROF_OF_PRACTICE",
};
const argv = process.argv.slice(2);
const opt = (n) => { const i = argv.indexOf(n); return i !== -1 ? argv[i + 1] : null; };
const XLSX_PATH = opt("--file") ?? path.join(os.homedir(), "Downloads", "VIT_faculty_import_template -data.xlsx");

const cellStr = (v) => {
  if (v == null) return "";
  if (typeof v === "object") return v.richText ? v.richText.map((t) => t.text).join("").trim() : v.result != null ? String(v.result).trim() : v.text != null ? String(v.text).trim() : "";
  return String(v).trim();
};
const norm = (v) => {
  if (v === null || v === undefined) return null;
  if (typeof v?.toMillis === "function") return { __ts: `${v.seconds}.${v.nanoseconds}` };
  if (v?.path && v?.firestore) return { __ref: v.path };
  if (Array.isArray(v)) return v.map(norm);
  if (typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((x) => [x, norm(v[x])]));
  return v;
};
const fingerprintOf = (d) => {
  const { employeeCategory, ...rest } = d.data();
  return {
    hash: crypto.createHash("sha256").update(JSON.stringify(norm(rest))).digest("hex"),
    fieldCount: Object.keys(rest).length,
    updatedAt: JSON.stringify(norm(d.data().updatedAt)),
  };
};

async function main() {
  const rawKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY ?? "";
  const privateKey = rawKey.replace(/^["']|["']$/g, "").replace(/\\n/g, "\n");
  if (!getApps().length) initializeApp({ credential: cert({ projectId: process.env.FIREBASE_ADMIN_PROJECT_ID, clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL, privateKey }) });
  const db = getFirestore();
  const collegeRef = db.collection("colleges").doc(VIT_COLLEGE_ID);
  const college = await collegeRef.get();
  if (!college.exists || String(college.data().name ?? "").trim().toUpperCase() !== VIT_COLLEGE_NAME) throw new Error("College is not VISHNU INSTITUTE OF TECHNOLOGY - refusing to run");
  const snap = await collegeRef.collection("facultyMembers").get();

  const fpOut = opt("--fingerprint");
  if (fpOut) {
    const docs = {};
    for (const d of snap.docs) docs[d.id] = { ...fingerprintOf(d), employeeCategoryBefore: d.data().employeeCategory ?? null };
    fs.writeFileSync(fpOut, JSON.stringify({ capturedAt: new Date().toISOString(), docs }));
    console.log(`Fingerprinted ${snap.size} VIT faculty docs -> ${fpOut}`);
    return;
  }

  const fpIn = opt("--verify");
  if (!fpIn) throw new Error("Pass --fingerprint <out.json> or --verify <fingerprint.json>");
  const before = JSON.parse(fs.readFileSync(fpIn, "utf8"));

  // Excel: only Employee ID + Employee Category are read.
  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(XLSX_PATH);
  const ws = wb.getWorksheet("Template");
  const hdr = ws.getRow(1).values.map(cellStr).map((h) => h.toLowerCase());
  const idCol = hdr.indexOf("employee id"), catCol = hdr.indexOf("employee category");
  if (idCol < 1 || catCol < 1) throw new Error("Employee ID / Employee Category column not found in Excel");
  const excel = new Map();
  for (let r = 2; r <= ws.rowCount; r++) {
    const id = cellStr(ws.getRow(r).getCell(idCol).value); if (!id) continue;
    excel.set(id, cellStr(ws.getRow(r).getCell(catCol).value));
  }

  const byId = new Map(); for (const d of snap.docs) byId.set(String(d.data().employeeId ?? "").trim(), d);
  const counts = {}; const wrongCat = [], otherChanged = [], noExcelRow = [], newDocs = [];
  for (const d of snap.docs) {
    const cat = d.data().employeeCategory; const key = cat ? String(cat) : "(missing)";
    counts[key] = (counts[key] ?? 0) + 1;
    const eid = String(d.data().employeeId ?? "").trim();
    if (!excel.has(eid)) noExcelRow.push(eid);
    else {
      const expected = CATEGORY_MAP[excel.get(eid).toLowerCase().replace(/\s+/g, " ").trim()];
      if (cat !== expected) wrongCat.push({ eid, expected, actual: cat ?? "(missing)", excel: excel.get(eid) });
    }
    const b = before.docs[d.id];
    if (!b) { newDocs.push(d.id); continue; }
    const now = fingerprintOf(d);
    if (now.hash !== b.hash || now.fieldCount !== b.fieldCount || now.updatedAt !== b.updatedAt) otherChanged.push({ eid, hashSame: now.hash === b.hash, updatedAtSame: now.updatedAt === b.updatedAt });
  }
  const unmatched = [...excel.keys()].filter((id) => !byId.has(id));
  const gone = Object.keys(before.docs).filter((id) => !snap.docs.some((d) => d.id === id));

  console.log(`\nPOST-WRITE VERIFICATION - ${VIT_COLLEGE_NAME} - read live from Firestore ${new Date().toISOString()}`);
  console.log(`VIT faculty docs now: ${snap.size}   (fingerprint had ${Object.keys(before.docs).length}; new: ${newDocs.length}; removed: ${gone.length})`);
  console.log(`\nCategory counts:`);
  for (const k of ["REGULAR", "CONTRACT", "VISITING", "PROFESSOR_OF_PRACTICE", "ASST_PROF_OF_PRACTICE", "PART_TIME", "(missing)"]) console.log(`  ${k.padEnd(24)} ${counts[k] ?? 0}`);
  const other = Object.keys(counts).filter((k) => !["REGULAR", "CONTRACT", "VISITING", "PROFESSOR_OF_PRACTICE", "ASST_PROF_OF_PRACTICE", "PART_TIME", "(missing)"].includes(k));
  if (other.length) console.log(`  UNEXPECTED VALUES: ${other.map((k) => `${k}=${counts[k]}`).join(", ")}`);
  console.log(`\nDocs whose category differs from the Excel-derived value (by Employee ID): ${wrongCat.length}`);
  wrongCat.forEach((w) => console.log(`  ${w.eid}: expected ${w.expected} (excel "${w.excel}"), actual ${w.actual}`));
  console.log(`\nExcel Employee IDs with no VIT doc (unmatched): ${unmatched.length}${unmatched.length ? "  -> " + unmatched.join(", ") : ""}`);
  console.log(`VIT docs with no Excel row: ${noExcelRow.length}`);
  console.log(`\nDocs where ANY field other than employeeCategory (or updatedAt) changed since the fingerprint: ${otherChanged.length}`);
  otherChanged.forEach((o) => console.log(`  ${o.eid}: non-category fields ${o.hashSame ? "same" : "CHANGED"}, updatedAt ${o.updatedAtSame ? "same" : "CHANGED"}`));
}
main().then(() => process.exit(0)).catch((e) => { console.error("ERROR:", e.message ?? e); process.exit(1); });
