/**
 * READ-ONLY. For every HOD / Principal / Vice Principal login of the named colleges, reports whether the person also has a
 * faculty record (linked by userUid) and whether the LOGIN document holds profile details the faculty record does not.
 * That is exactly what a person would lose sight of if their role "My Profile" page (which reads the login document) were
 * replaced by the faculty profile (which reads the faculty record). It never writes to Firestore.
 *
 *   node scripts/audit-role-profile-duplicates.mjs --colleges=<id>,<id>
 */
import "dotenv/config";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const colleges = (arg("colleges") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
if (!colleges.length) { console.error("usage: --colleges=<id>,<id>"); process.exit(1); }

if (!getApps().length) {
  initializeApp({ credential: cert({
    projectId: process.env.FIREBASE_ADMIN_PROJECT_ID, clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/^["']|["']$/g, "").replace(/\\n/g, "\n"),
  }) });
}
const db = getFirestore();

// how many non-blank values a value holds (rows of empty strings hold none)
const leaves = (v) => {
  if (v === null || v === undefined) return 0;
  if (typeof v === "string") return v.trim() ? 1 : 0;
  if (typeof v?.toDate === "function") return 1;
  if (Array.isArray(v)) return v.reduce((n, x) => n + leaves(x), 0);
  if (typeof v === "object") return Object.values(v).reduce((n, x) => n + leaves(x), 0);
  return 1;
};
const FLAT = ["gender", "dateOfBirth", "legalName", "nameAsPerAadhar", "nameAsPerPan", "fatherName", "motherName", "religion", "caste", "subCaste",
  "aadharNo", "panNo", "passportNo", "differentlyAbled", "differentlyAbledDetails", "bankAccountNumber", "ifscCode", "bankName", "bankBranch",
  "bankOtherDetails", "emergencyContactName", "emergencyContactRelation", "emergencyContactMobileNo", "ratificationStatus",
  "ratificationProceedingsNumber", "ratificationDate", "ratifications", "maritalStatus", "spouseName", "numberOfChildren", "temporaryAddress",
  "permanentAddressSameAsTemporary", "permanentAddress", "bloodGroup", "motherTongue", "languagesKnown", "height", "weightKg", "pfNumber",
  "uanNumber", "esiNumber", "highestQualification", "specialization", "apaarFacultyId", "aicteFacultyId"]; // = detailsOnlyInLogin() in lib/faculty/ownProfile.ts

const ROLES = ["HOD", "PRINCIPAL", "VICE_PRINCIPAL", "DEPARTMENT_OFFICE", "COLLEGE_ADMIN", "DIRECTOR"];
let total = 0, withRecord = 0, withoutRecord = 0, atRisk = 0;
for (const c of colleges) {
  const col = db.collection("colleges").doc(c);
  const facultyByUid = new Map();
  for (const d of (await col.collection("facultyMembers").get()).docs) { const u = d.data().userUid; if (u) facultyByUid.set(u, d.data()); }
  const users = (await col.collection("users").get()).docs;
  console.log(`\ncollege ${c}: ${users.length} logins`);
  for (const u of users) {
    const data = u.data();
    const roles = new Set([data.role, ...(Array.isArray(data.seatRoles) ? data.seatRoles : [])].filter(Boolean));
    if (![...roles].some((r) => ROLES.includes(r))) continue;
    total++;
    const fac = facultyByUid.get(u.id);
    const ap = data.academicProfile && typeof data.academicProfile === "object" ? data.academicProfile : {};
    const loginKeys = Object.keys(ap).filter((k) => leaves(ap[k]) > 0);
    const flatKeys = FLAT.filter((k) => leaves(data[k]) > 0);
    if (!fac) {
      withoutRecord++;
      console.log(`  ${u.id.slice(0, 8)} role=${data.role} seats=[${[...roles].join(",")}] NO faculty record -> keeps its own profile page. login holds ${loginKeys.length} academicProfile keys, ${flatKeys.length} personal fields`);
      continue;
    }
    withRecord++;
    const fap = fac.academicProfile && typeof fac.academicProfile === "object" ? fac.academicProfile : {};
    const onlyAp = loginKeys.filter((k) => leaves(fap[k]) === 0);
    const onlyFlat = flatKeys.filter((k) => leaves(fac[k]) === 0);
    if (onlyAp.length || onlyFlat.length) {
      atRisk++;
      console.log(`  ${u.id.slice(0, 8)} role=${data.role} HAS faculty record, but the LOGIN holds details the record lacks: academicProfile [${onlyAp.join(",")}] personal [${onlyFlat.join(",")}]`);
    } else {
      console.log(`  ${u.id.slice(0, 8)} role=${data.role} has faculty record; login holds nothing the record lacks`);
    }
  }
}
console.log(`\nSUMMARY: ${total} HOD/Principal/VP logins | with faculty record: ${withRecord} | without: ${withoutRecord} | with details ONLY in the login: ${atRisk}`);
