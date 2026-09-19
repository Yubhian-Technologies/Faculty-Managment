/**
 * One-off, VIT-only restore of FacultyMember.employeeCategory from the original
 * import spreadsheet, after the field was accidentally wiped.
 *
 * SAFETY MODEL
 *  - Scope: ONLY colleges/{VIT_COLLEGE_ID}/facultyMembers. The college doc's name
 *    is verified before anything runs. No collectionGroup queries.
 *  - Matching: strictly by Employee ID (exact, trimmed). Never by row number,
 *    name similarity, or position. A record is only ever updated when its ID maps
 *    to exactly ONE VIT faculty doc AND exactly one Excel row.
 *  - Identity cross-check: the Excel legal/PAN name must resemble the DB name for
 *    the matched doc; otherwise the record is REVIEW and is NOT updated.
 *  - Writes ONLY the employeeCategory field, and only where it is missing/empty.
 *    Never overwrites a non-empty value. Never touches employmentType, name,
 *    designation, department, employeeId, or updatedAt.
 *  - Each write carries the doc's lastUpdateTime as a precondition, so a record
 *    edited by someone since this script read it is skipped, not clobbered.
 *  - Idempotent: a second run finds the field already set and changes nothing.
 *  - Reads only the 6 spreadsheet columns it needs (never passwords, Aadhar, PAN).
 *
 * The DB only accepts REGULAR | VISITING | CONTRACT | PART_TIME (the API rejects
 * anything else and the UI label lookup would render blank), so values are mapped
 * to those keys. Categories with no valid key are reported as NEEDS_DECISION and
 * are never written.
 *
 * Dry-run by default. To write, ALL of these are required:
 *   --apply  --expect <N>   (N must equal the number of records the fresh plan
 *                            says it will change, so a stale approval can't apply)
 *
 * Usage:
 *   node scripts/restore-vit-employee-category.mjs                 # dry run
 *   node scripts/restore-vit-employee-category.mjs --list-ready    # also print every planned change
 *   node scripts/restore-vit-employee-category.mjs --apply --expect 250
 *
 * Options: --file <xlsx>  --out <dir>  --college-id <id>
 */

import "dotenv/config";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ExcelJS from "exceljs";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const VIT_COLLEGE_ID = "bc77d03b57194edeb006";
const VIT_COLLEGE_NAME = "VISHNU INSTITUTE OF TECHNOLOGY";
// Must match EMPLOYEE_CATEGORY_LABELS in src/types/core.ts.
const VALID_CATEGORIES = new Set(["REGULAR", "VISITING", "CONTRACT", "PART_TIME", "PROFESSOR_OF_PRACTICE", "ASST_PROF_OF_PRACTICE"]);

// Excel value (lower-cased, whitespace collapsed) -> DB enum key.
const CATEGORY_MAP = {
  regular: "REGULAR",
  contract: "CONTRACT",
  visiting: "VISITING",
  "regular(hyd)": "REGULAR",
  "professor of practice": "PROFESSOR_OF_PRACTICE",
  "asst.prof. of practice": "ASST_PROF_OF_PRACTICE",
};
// Anything not in CATEGORY_MAP is reported as NEEDS_DECISION and never written.
const NEEDS_DECISION = new Set();

// Owner-confirmed: the Excel spelling differs from the DB by a typo but it is the SAME person.
// The ID must still match exactly and the names must still be reasonably close (>= 0.85);
// this only lifts the stricter default threshold for these specific IDs.
const CONFIRMED_NAME_VARIANTS = new Set(["VIT0631"]);

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n, d) => { const i = argv.indexOf(n); return i !== -1 && argv[i + 1] ? argv[i + 1] : d; };
const APPLY = flag("--apply");
const LIST_READY = flag("--list-ready");
const COLLEGE_ID = opt("--college-id", VIT_COLLEGE_ID);
const XLSX_PATH = opt("--file", path.join(os.homedir(), "Downloads", "VIT_faculty_import_template -data.xlsx"));
const OUT_DIR = opt("--out", path.join(os.homedir(), "Downloads", "vit-employee-category-restore"));
const EXPECT = opt("--expect", null);

// ─── helpers ────────────────────────────────────────────────────────────────
const cellStr = (v) => {
  if (v == null) return "";
  if (typeof v === "object") {
    if (v.richText) return v.richText.map((t) => t.text).join("").trim();
    if (v.result != null) return String(v.result).trim();
    if (v.text != null) return String(v.text).trim();
    return "";
  }
  return String(v).trim();
};
const isEmpty = (v) => v == null || (typeof v === "string" && v.trim() === "");
const normKey = (s) => s.toLowerCase().replace(/\s+/g, " ").trim();
const normId = (s) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
const normText = (s) => normKey(String(s ?? "")).replace(/[^a-z0-9]+/g, " ").trim();

const TITLES = new Set(["dr", "mr", "mrs", "ms", "miss", "prof", "professor", "smt", "sri", "shri", "kumari"]);
const nameTokens = (s) => normText(s).split(" ").filter((t) => t && !TITLES.has(t));

function lev(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}
// 0..1. Order-insensitive. Full-word matches count 1, initial-only matches count 0.5, and a
// pair with NO full-word match is capped at 0.4 so a bare initial can never vouch for identity.
// The edit-distance branch covers run-together spellings ("RAMUINALA" vs "RAMU INALA").
function nameScore(a, b) {
  const ta = nameTokens(a), tb = nameTokens(b);
  if (!ta.length || !tb.length) return 0;
  const [small, big] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  const used = new Set(); let exact = 0, initial = 0; const rest = [];
  for (const t of small) {
    const i = big.findIndex((u, k) => !used.has(k) && u === t);
    if (i !== -1) { used.add(i); if (t.length > 1) exact++; else initial++; } else rest.push(t);
  }
  for (const t of rest) { // pair a lone initial on one side with a full word on the other
    const i = big.findIndex((u, k) => !used.has(k) && ((t.length === 1 && u.length > 1 && u.startsWith(t)) || (u.length === 1 && t.length > 1 && t.startsWith(u))));
    if (i !== -1) { used.add(i); initial++; }
  }
  let tokenScore = (exact + 0.5 * initial) / small.length;
  if (exact === 0) tokenScore = Math.min(tokenScore, 0.4);
  const ja = [...ta].sort().join(""), jb = [...tb].sort().join("");
  const editScore = 1 - lev(ja, jb) / Math.max(ja.length, jb.length);
  return Math.max(tokenScore, editScore);
}

// Excel uses abbreviations ("CSE", "Asst.Prof."); the DB stores canonical forms
// ("COMPUTER SCIENCE AND ENGINEERING", "ASSISTANT_PROFESSOR"). Compare after normalising both.
const STOP = new Set(["and", "of", "the", "in"]);
const initialsOf = (s) => normText(s).split(" ").filter((w) => w && !STOP.has(w)).map((w) => w[0]).join("");
function deptMatches(x, y) {
  const a = normText(x), b = normText(y);
  if (!a || !b) return a === b;
  if (a === b) return true;
  const ia = a.replace(/ /g, ""), ib = b.replace(/ /g, "");
  if (ia.length >= 2 && initialsOf(y).includes(ia)) return true;
  if (ib.length >= 2 && initialsOf(x).includes(ib)) return true;
  return b.startsWith(a) || a.startsWith(b);
}
const DESIG_ALIAS = { asst: "assistant", assoc: "associate", prof: "professor", sr: "senior", jr: "junior" };
const desigKey = (s) => normText(s).split(" ").map((t) => DESIG_ALIAS[t] ?? t).filter((t) => t && !STOP.has(t)).sort().join(" ");
const desigMatches = (x, y) => desigKey(x) === desigKey(y);
const bestNameScore = (xs, ys) => {
  let best = 0;
  for (const x of xs) for (const y of ys) if (x && y) best = Math.max(best, nameScore(x, y));
  return best;
};
const csvCell = (v) => { const s = v == null ? "" : String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const ts = () => new Date().toISOString().replace(/[:.]/g, "-");

// ─── read Excel (only the columns we need) ──────────────────────────────────
async function readExcel() {
  if (!fs.existsSync(XLSX_PATH)) throw new Error(`Excel file not found: ${XLSX_PATH}`);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(XLSX_PATH);
  const ws = wb.getWorksheet("Template");
  if (!ws) throw new Error('Sheet "Template" not found in the workbook');
  const headers = ws.getRow(1).values.map(cellStr);
  const col = (pred, label) => {
    const i = headers.findIndex((h) => h && pred(h.toLowerCase()));
    if (i === -1) throw new Error(`Required column not found in Excel: ${label}`);
    return i;
  };
  const c = {
    dept: col((h) => h.startsWith("dept"), "Dept."),
    id: col((h) => h === "employee id", "Employee ID"),
    legal: col((h) => h.startsWith("legal name"), "Legal Name"),
    pan: col((h) => h.startsWith("full name"), "Full Name (as per PAN)"),
    desig: col((h) => h === "designation", "Designation"),
    cat: col((h) => h === "employee category", "Employee Category"),
  };
  const rows = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const id = cellStr(row.getCell(c.id).value);
    if (!id) continue;
    rows.push({
      excelRow: r, employeeId: id,
      dept: cellStr(row.getCell(c.dept).value), legalName: cellStr(row.getCell(c.legal).value),
      panName: cellStr(row.getCell(c.pan).value), designation: cellStr(row.getCell(c.desig).value),
      category: cellStr(row.getCell(c.cat).value),
    });
  }
  return rows;
}

// ─── main ───────────────────────────────────────────────────────────────────
async function run() {
  const rawKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY ?? "";
  const privateKey = rawKey.replace(/^["']|["']$/g, "").replace(/\\n/g, "\n");
  if (!getApps().length) {
    initializeApp({ credential: cert({ projectId: process.env.FIREBASE_ADMIN_PROJECT_ID, clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL, privateKey }) });
  }
  const db = getFirestore();

  // Scope guard: this script only ever touches VIT.
  const collegeRef = db.collection("colleges").doc(COLLEGE_ID);
  const collegeSnap = await collegeRef.get();
  if (!collegeSnap.exists) throw new Error(`College ${COLLEGE_ID} not found`);
  const collegeName = String(collegeSnap.data().name ?? "").trim();
  if (collegeName.toUpperCase() !== VIT_COLLEGE_NAME) {
    throw new Error(`Refusing to run: college ${COLLEGE_ID} is "${collegeName}", expected "${VIT_COLLEGE_NAME}"`);
  }

  const excelRows = await readExcel();
  const facSnap = await collegeRef.collection("facultyMembers").get();
  const dbDocs = facSnap.docs.map((d) => ({ doc: d, ...d.data() }));

  // Index the DB by employeeId (exact-trimmed, and a punctuation/case-insensitive key for collision checks).
  const byExact = new Map(), byNorm = new Map();
  for (const f of dbDocs) {
    const id = String(f.employeeId ?? "").trim();
    if (!id) continue;
    (byExact.get(id) ?? byExact.set(id, []).get(id)).push(f);
    (byNorm.get(normId(id)) ?? byNorm.set(normId(id), []).get(normId(id))).push(f);
  }
  const excelById = new Map();
  for (const r of excelRows) (excelById.get(r.employeeId) ?? excelById.set(r.employeeId, []).get(r.employeeId)).push(r);

  const results = [];
  const matchedDocIds = new Set();

  for (const r of excelRows) {
    const catKey = normKey(r.category);
    const mapped = CATEGORY_MAP[catKey] ?? null;
    const res = {
      excelRow: r.excelRow, employeeId: r.employeeId, status: "", reason: "", warnings: [],
      excelLegalName: r.legalName, excelPanName: r.panName, excelDept: r.dept, excelDesignation: r.designation,
      excelCategory: r.category, newEmployeeCategory: mapped, nameScore: null,
      docId: "", dbLegalName: "", dbName: "", dbDept: "", dbDesignation: "", currentEmployeeCategory: "",
    };
    results.push(res);

    const sameIdRows = excelById.get(r.employeeId);
    if (sameIdRows.length > 1) { res.status = "AMBIGUOUS"; res.reason = `Employee ID appears ${sameIdRows.length}x in the Excel`; continue; }

    const hits = byExact.get(r.employeeId) ?? [];
    if (hits.length > 1) { res.status = "AMBIGUOUS"; res.reason = `Employee ID matches ${hits.length} VIT faculty docs`; continue; }
    if (hits.length === 0) {
      const near = byNorm.get(normId(r.employeeId)) ?? [];
      res.status = "UNMATCHED";
      res.reason = near.length
        ? `No exact ID match; a DB doc has a differently-formatted ID "${near[0].employeeId}" (NOT updated - confirm manually)`
        : "Employee ID not found among VIT faculty";
      // Informational only: a DB doc with a very similar name may be the same person under a changed ID.
      let best = null;
      for (const f of dbDocs) {
        const s = bestNameScore([r.legalName, r.panName], [f.legalName, f.name]);
        if (s >= 0.85 && (!best || s > best.s)) best = { s, f };
      }
      if (best) res.reason += `; similar name exists on DB ID "${best.f.employeeId}" (info only)`;
      continue;
    }

    const f = hits[0];
    if (byNorm.get(normId(String(f.employeeId)))?.length > 1) {
      res.status = "AMBIGUOUS"; res.reason = "ID collides with another VIT doc after case/punctuation normalisation"; continue;
    }
    matchedDocIds.add(f.doc.id);
    Object.assign(res, {
      docId: f.doc.id, dbLegalName: f.legalName ?? "", dbName: f.name ?? "",
      dbDept: f.department ?? "", dbDesignation: String(f.designation ?? ""),
      currentEmployeeCategory: isEmpty(f.employeeCategory) ? "" : String(f.employeeCategory),
    });
    res.nameScore = Number(bestNameScore([r.legalName, r.panName], [f.legalName, f.name]).toFixed(2));

    // Warnings that don't block (identity is settled by ID + name; these may reflect legit edits/renames since import).
    if (!deptMatches(r.dept, f.department)) res.warnings.push(`DEPT_DIFF (excel "${r.dept}" vs db "${f.department ?? ""}")`);
    if (!desigMatches(r.designation, f.designation)) res.warnings.push(`DESIGNATION_DIFF (excel "${r.designation}" vs db "${f.designation ?? ""}")`);

    if (!isEmpty(f.employeeCategory)) {
      res.status = "SKIP_ALREADY_SET";
      res.reason = `employeeCategory already "${f.employeeCategory}"` + (mapped && mapped !== f.employeeCategory ? ` (differs from Excel-derived ${mapped}; NOT overwritten)` : "");
      continue;
    }
    if (NEEDS_DECISION.has(catKey)) { res.status = "NEEDS_DECISION"; res.reason = `"${r.category}" has no valid employeeCategory key (allowed: ${[...VALID_CATEGORIES].join("/")}); not written`; continue; }
    if (!mapped || !VALID_CATEGORIES.has(mapped)) { res.status = "NEEDS_DECISION"; res.reason = `Unrecognised Excel category "${r.category}"; not written`; continue; }
    // Strict by default: anything short of an identical (normalised) name needs >= 0.75... except
    // owner-confirmed typo variants, which must still be >= 0.85 close.
    const confirmed = CONFIRMED_NAME_VARIANTS.has(r.employeeId);
    const minScore = confirmed ? 0.85 : 0.75;
    if (res.nameScore < minScore) { res.status = "REVIEW"; res.reason = `Name mismatch (score ${res.nameScore}) - ID matched but names differ; not written`; continue; }
    if (confirmed && res.nameScore < 1) res.warnings.push("CONFIRMED_NAME_VARIANT (owner-confirmed same person)");
    res.status = "READY";
  }

  const dbNotInExcel = dbDocs.filter((f) => !matchedDocIds.has(f.doc.id));
  const ready = results.filter((r) => r.status === "READY");
  const count = (s) => results.filter((r) => r.status === s).length;

  // ─── report ───────────────────────────────────────────────────────────────
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const stamp = ts();
  const csvPath = path.join(OUT_DIR, `dry-run-${stamp}.csv`);
  const cols = ["status", "employeeId", "docId", "dbLegalName", "dbName", "excelLegalName", "excelPanName", "nameScore", "dbDept", "excelDept", "dbDesignation", "excelDesignation", "currentEmployeeCategory", "excelCategory", "newEmployeeCategory", "warnings", "reason", "excelRow"];
  const csv = "﻿" + [cols.join(","), ...results.map((r) => cols.map((c) => csvCell(c === "warnings" ? r.warnings.join(" | ") : r[c])).join(","))].join("\r\n");
  fs.writeFileSync(csvPath, csv);

  const line = "-".repeat(78);
  console.log(`\n${line}\n${APPLY ? "APPLY" : "DRY RUN"} - employeeCategory restore for ${collegeName} (${COLLEGE_ID})\n${line}`);
  console.log(`Excel file                          : ${XLSX_PATH}`);
  console.log(`Excel rows read (Template sheet)    : ${excelRows.length}`);
  console.log(`VIT faculty records in Firestore    : ${dbDocs.length}`);
  console.log(`Excel rows matched to exactly 1 doc : ${results.filter((r) => r.docId).length}`);
  console.log(`VIT docs with NO Excel row          : ${dbNotInExcel.length}`);
  console.log(`\nOutcome per Excel row:`);
  for (const s of ["READY", "SKIP_ALREADY_SET", "NEEDS_DECISION", "REVIEW", "AMBIGUOUS", "UNMATCHED"]) console.log(`  ${s.padEnd(18)} ${count(s)}`);
  const byNew = {}; for (const r of ready) byNew[r.newEmployeeCategory] = (byNew[r.newEmployeeCategory] ?? 0) + 1;
  console.log(`\nWould write (READY): ${ready.length}  ->  ${JSON.stringify(byNew)}`);
  console.log(`Records with non-blocking warnings (dept/designation differs from Excel): ${results.filter((r) => r.warnings.length && r.docId).length}`);

  const printGroup = (title, items, fmt) => { if (!items.length) return; console.log(`\n== ${title} (${items.length}) ==`); items.forEach((x) => console.log("  " + fmt(x))); };
  printGroup("UNMATCHED Excel IDs - not in VIT Firestore, NOT updated", results.filter((r) => r.status === "UNMATCHED"),
    (r) => `${r.employeeId} | ${r.excelLegalName || r.excelPanName} | ${r.excelDept} | ${r.excelDesignation} | excel cat: ${r.excelCategory}\n      ${r.reason}`);
  printGroup("NEEDS_DECISION - no valid DB category, NOT updated", results.filter((r) => r.status === "NEEDS_DECISION"),
    (r) => `${r.employeeId} | ${r.dbLegalName} | db dept: ${r.dbDept} | db designation: ${r.dbDesignation} | excel cat: "${r.excelCategory}" | excel designation: ${r.excelDesignation}`);
  printGroup("REVIEW - ID matched but names differ, NOT updated", results.filter((r) => r.status === "REVIEW"),
    (r) => `${r.employeeId} | db: ${r.dbLegalName}/${r.dbName} | excel: ${r.excelLegalName}/${r.excelPanName} | score ${r.nameScore}`);
  printGroup("AMBIGUOUS - NOT updated", results.filter((r) => r.status === "AMBIGUOUS"), (r) => `${r.employeeId} | ${r.reason}`);
  printGroup("SKIP_ALREADY_SET - already has a value, left untouched", results.filter((r) => r.status === "SKIP_ALREADY_SET"),
    (r) => `${r.employeeId} | ${r.dbLegalName} | ${r.reason}`);
  printGroup("VIT docs with no Excel row (informational)", dbNotInExcel.map((f) => ({ f })), ({ f }) => `${f.employeeId} | ${f.legalName ?? f.name ?? ""} | ${f.department ?? ""} | ${f.designation ?? ""}`);
  const warned = results.filter((r) => r.warnings.length && r.docId);
  printGroup("Records where dept/designation still differ after normalising abbreviations - eyeball these", warned,
    (r) => `${r.employeeId} | ${r.dbLegalName} | ${r.status} | ${r.warnings.join(" ; ")}`);
  const nameVariants = results.filter((r) => r.docId && r.nameScore != null && r.nameScore < 1);
  printGroup("Matched by ID but name is not identical (score < 1.0) - spelling/initials variants, eyeball these", nameVariants,
    (r) => `${r.employeeId} | score ${r.nameScore} | db: ${r.dbLegalName} / ${r.dbName} | excel: ${r.excelLegalName} / ${r.excelPanName} | ${r.status}`);
  if (LIST_READY) printGroup("EXACT LIST OF RECORDS THAT WOULD BE CHANGED", ready,
    (r) => `${r.employeeId.padEnd(11)} | ${(r.dbLegalName || r.dbName).slice(0, 34).padEnd(34)} | ${r.dbDept.slice(0, 26).padEnd(26)} | ${r.dbDesignation.slice(0, 22).padEnd(22)} | ${r.excelCategory.padEnd(14)} -> ${r.newEmployeeCategory}`);
  console.log(`\nFull per-record report (every row, all fields): ${csvPath}`);

  if (!APPLY) {
    console.log(`\nDRY RUN ONLY - nothing was written. To apply: --apply --expect ${ready.length}`);
    return;
  }

  // ─── apply ────────────────────────────────────────────────────────────────
  if (EXPECT == null || Number(EXPECT) !== ready.length) {
    throw new Error(`Refusing to write: --expect must equal the fresh plan size (${ready.length}); got ${EXPECT ?? "nothing"}. Re-review the dry run.`);
  }
  if (!ready.length) { console.log("Nothing to change."); return; }

  const snapPath = path.join(OUT_DIR, `snapshot-before-write-${stamp}.json`);
  fs.writeFileSync(snapPath, JSON.stringify({
    generatedAt: new Date().toISOString(), collegeId: COLLEGE_ID, collegeName, excelFile: XLSX_PATH,
    note: "Pre-write state of every record this run will change. The only field written is employeeCategory; previousEmployeeCategory was empty/missing. Rollback = delete employeeCategory on these docs.",
    records: ready.map((r) => {
      const f = dbDocs.find((d) => d.doc.id === r.docId);
      return { docPath: f.doc.ref.path, docId: r.docId, employeeId: r.employeeId, legalName: f.legalName ?? null, name: f.name ?? null,
        department: f.department ?? null, designation: f.designation ?? null, previousEmployeeCategory: f.employeeCategory ?? null,
        updateTimeBefore: f.doc.updateTime.toDate().toISOString(), excelCategory: r.excelCategory, newEmployeeCategory: r.newEmployeeCategory };
    }),
  }, null, 2));
  console.log(`\nSnapshot written: ${snapPath}`);

  const targets = ready.map((r) => ({ r, snap: dbDocs.find((d) => d.doc.id === r.docId).doc }));
  let written = 0; const skipped = [];
  const CHUNK = 100;
  for (let i = 0; i < targets.length; i += CHUNK) {
    const chunk = targets.slice(i, i + CHUNK);
    try {
      const batch = db.batch();
      for (const { r, snap } of chunk) batch.update(snap.ref, { employeeCategory: r.newEmployeeCategory }, { lastUpdateTime: snap.updateTime });
      await batch.commit();
      written += chunk.length;
    } catch {
      // Atomic batch failed (most likely one doc edited since read) - retry doc-by-doc so only that doc is skipped.
      for (const { r, snap } of chunk) {
        try { await snap.ref.update({ employeeCategory: r.newEmployeeCategory }, { lastUpdateTime: snap.updateTime }); written++; }
        catch (e) { skipped.push({ employeeId: r.employeeId, error: String(e.message ?? e).slice(0, 120) }); }
      }
    }
  }

  // Verify by re-reading.
  let verified = 0;
  for (const { r, snap } of targets) { const now = await snap.ref.get(); if (now.data().employeeCategory === r.newEmployeeCategory) verified++; }
  console.log(`\nAPPLIED: wrote ${written}/${ready.length}; verified ${verified}/${ready.length} by re-read; skipped ${skipped.length}`);
  skipped.forEach((s) => console.log(`  SKIPPED ${s.employeeId}: ${s.error}`));
}

run().then(() => process.exit(0)).catch((e) => { console.error("\nERROR:", e.message ?? e); process.exit(1); });
