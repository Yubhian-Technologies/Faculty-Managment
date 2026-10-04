export const dynamic = "force-dynamic";

import { scopedLocationId } from "@/lib/location/scope";
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { Timestamp } from "firebase-admin/firestore";
import type { LocationStaffMember } from "@/types/locationStaff";

interface ImportStaffRow {
  name?: string;
  contactNumber?: string;
  aadhaar?: string;
  department?: string;
  role?: string;
  payeeVoucher?: string;
  shift?: string;
  fatherName?: string;
  address?: string;
  spouseGuardianName?: string;
  spouseGuardianPhone?: string;
  spouseGuardianAadhaar?: string;
  dateOfJoining?: string;
  status?: string;
}

// Helper for alphanumeric normalization of department and shift keys
function normalizeKey(input: string): string {
  return (input || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Known department synonyms and variations
const DEPT_ALIASES: Record<string, string> = {
  // Housekeeping
  housekeeping: "housekeeping",
  housekeep: "housekeeping",
  cleaning: "housekeeping",
  sanitation: "housekeeping",
  sweep: "housekeeping",
  sweeper: "housekeeping",

  // Administration
  administration: "administration",
  admin: "administration",
  adminoffice: "administration",
  office: "administration",
  administrative: "administration",

  // Catering / Dining / Kitchen
  cateringkitchen: "catering / kitchen",
  catering: "catering / kitchen",
  kitchen: "catering / kitchen",
  canteen: "catering / kitchen",
  diningmess: "dining / mess",
  dining: "dining / mess",
  mess: "dining / mess",

  // IT Support
  itsupport: "it support",
  it: "it support",
  informationtechnology: "it support",
  itdept: "it support",
  technicalsupport: "it support",

  // Security
  security: "security",
  sec: "security",
  guard: "security",
  guards: "security",

  // Transport
  transport: "transport",
  transportation: "transport",
  driver: "transport",
  drivers: "transport",
  bus: "transport",

  // Maintenance
  maintenance: "maintenance",
  repair: "maintenance",
  electrical: "electrical",
  civil: "civil",

  // Hostel
  hostelfacility: "hostel facility",
  hostel: "hostel facility",
};

// Standard short codes for known campus departments
const STANDARD_DEPT_CODES: Record<string, string> = {
  housekeeping: "HK",
  administration: "ADM",
  admin: "ADM",
  cateringkitchen: "CK",
  catering: "CAT",
  kitchen: "KIT",
  diningmess: "DN",
  mess: "DN",
  dining: "DN",
  canteen: "CNT",
  itsupport: "ITS",
  it: "IT",
  security: "SEC",
  transport: "TRN",
  maintenance: "MNT",
  hostelfacility: "HST",
  hostel: "HST",
  electrical: "ELE",
  civil: "CIV",
  gardening: "GRD",
  accounts: "ACC",
  finance: "FIN",
};

function generateDeptCode(deptName: string): string {
  const norm = normalizeKey(deptName);
  if (STANDARD_DEPT_CODES[norm]) return STANDARD_DEPT_CODES[norm];

  const clean = deptName.trim().toUpperCase();
  const words = clean.split(/[\s/&-]+/).filter(Boolean);
  if (words.length >= 2) {
    const acronym = words.map((w) => w[0]).join("");
    if (acronym.length >= 2 && acronym.length <= 4) return acronym;
  }
  const lettersOnly = clean.replace(/[^A-Z]/g, "");
  return lettersOnly.slice(0, 3) || "DEPT";
}

export async function POST(request: Request) {
  try {
    const session = await requireRole(
      "LOCATION_DEPT_HEAD",
      "LOCATION_STAFF_ADMIN",
      "ADMINISTRATION",
      "SUPER_ADMIN"
    );

    const body = (await request.json()) as {
      staff?: ImportStaffRow[];
      locationId?: string;
    };

    const db = getAdminDb();

    let locationId = scopedLocationId(session, body.locationId);
    // Only a Super Admin without a location of their own falls back to the first location.
    if (!locationId && session.role === "SUPER_ADMIN") {
      const firstLoc = await db.collection("locations").limit(1).get();
      if (!firstLoc.empty) {
        locationId = firstLoc.docs[0].id;
      }
    }
    if (!locationId) {
      return NextResponse.json({ error: "locationId is required" }, { status: 400 });
    }

    const items = body.staff;
    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: "No staff records provided for import" }, { status: 400 });
    }

    if (items.length > 500) {
      return NextResponse.json(
        { error: "Maximum 500 staff records can be imported in a single batch" },
        { status: 400 }
      );
    }

    // 1. Load active departments in this location
    const deptsSnap = await db
      .collection("locations")
      .doc(locationId)
      .collection("locationDepts")
      .get();

    const deptsMap = new Map<string, { id: string; name: string }>();
    const normalizedDeptsMap = new Map<string, { id: string; name: string }>();

    for (const d of deptsSnap.docs) {
      const data = d.data() as { name?: string; code?: string };
      const rawName = data.name?.trim() || "";
      const code = data.code?.trim() || "";
      const entry = { id: d.id, name: rawName };

      if (rawName) {
        deptsMap.set(rawName.toLowerCase(), entry);
        normalizedDeptsMap.set(normalizeKey(rawName), entry);
      }
      if (code) {
        deptsMap.set(code.toLowerCase(), entry);
        normalizedDeptsMap.set(normalizeKey(code), entry);
      }
      deptsMap.set(d.id.toLowerCase(), entry);
    }

    // 2. Load active shifts in this location
    const shiftsSnap = await db
      .collection("locations")
      .doc(locationId)
      .collection("shifts")
      .get();

    const shiftsMap = new Map<string, { id: string; name: string }>();
    const normalizedShiftsMap = new Map<string, { id: string; name: string }>();

    for (const s of shiftsSnap.docs) {
      const data = s.data() as { name?: string };
      const rawName = data.name?.trim() || "";
      const entry = { id: s.id, name: rawName };
      if (rawName) {
        shiftsMap.set(rawName.toLowerCase(), entry);
        normalizedShiftsMap.set(normalizeKey(rawName), entry);
      }
      shiftsMap.set(s.id.toLowerCase(), entry);
    }

    // 3. Pre-fetch existing Aadhaar numbers to catch duplicates
    const existingStaffSnap = await db
      .collection("locations")
      .doc(locationId)
      .collection("staff")
      .get();

    const existingAadhaars = new Set<string>();
    for (const doc of existingStaffSnap.docs) {
      const a = (doc.data() as { aadhaar?: string }).aadhaar?.trim();
      if (a) existingAadhaars.add(a);
    }

    const failed: { row: number; name: string; error: string }[] = [];
    const validPayloads: Omit<LocationStaffMember, "id">[] = [];
    const batchAadhaars = new Set<string>();
    const touchedDeptIds = new Set<string>();
    const newlyCreatedDeptNames: string[] = [];
    const now = Timestamp.now();

    // 4. Validate and resolve each row
    for (let i = 0; i < items.length; i++) {
      const rowNum = i + 1;
      const row = items[i];

      const name = row.name?.trim() || "";
      const contactNumber = row.contactNumber?.trim() || "";
      const aadhaar = row.aadhaar?.trim() || "";
      const rawDept = row.department?.trim() || "";
      const role = row.role?.trim() || "";
      const payeeVoucher = row.payeeVoucher?.trim() || "VOUCHER";
      const rawShift = row.shift?.trim() || "";
      const fatherName = row.fatherName?.trim() || "";
      const address = row.address?.trim() || "";
      const spouseGuardianName = row.spouseGuardianName?.trim() || "";
      const spouseGuardianPhone = row.spouseGuardianPhone?.trim() || "";
      const spouseGuardianAadhaar = row.spouseGuardianAadhaar?.trim() || "";
      const dateOfJoining = row.dateOfJoining?.trim() || new Date().toISOString().split("T")[0];
      const status = row.status?.trim().toUpperCase() === "INACTIVE" ? "INACTIVE" : "ACTIVE";

      // Required fields
      if (!name) {
        failed.push({ row: rowNum, name: name || "Unknown", error: "Staff Name is required" });
        continue;
      }
      if (!contactNumber || !/^\d{10}$/.test(contactNumber)) {
        failed.push({ row: rowNum, name, error: "Contact Number must be exactly 10 digits" });
        continue;
      }
      if (!aadhaar || !/^\d{12}$/.test(aadhaar)) {
        failed.push({ row: rowNum, name, error: "Aadhaar must be exactly 12 numeric digits" });
        continue;
      }
      if (!role) {
        failed.push({ row: rowNum, name, error: "Role/Designation is required" });
        continue;
      }

      // Check duplicates
      if (existingAadhaars.has(aadhaar)) {
        failed.push({ row: rowNum, name, error: `Aadhaar ${aadhaar} already registered on this campus` });
        continue;
      }
      if (batchAadhaars.has(aadhaar)) {
        failed.push({ row: rowNum, name, error: `Duplicate Aadhaar ${aadhaar} inside this import file` });
        continue;
      }

      // Department resolution (Exact -> Normalized -> Alias -> Auto-Create)
      let departmentId = "";
      let departmentName = "Unassigned";

      if (rawDept) {
        // 1. Direct lowercase match
        let resolvedDept = deptsMap.get(rawDept.toLowerCase());

        // 2. Normalized alphanumeric match
        if (!resolvedDept) {
          const normKey = normalizeKey(rawDept);
          resolvedDept = normalizedDeptsMap.get(normKey);
        }

        // 3. Known alias matching
        if (!resolvedDept) {
          const normKey = normalizeKey(rawDept);
          const alias = DEPT_ALIASES[normKey];
          if (alias) {
            resolvedDept = deptsMap.get(alias) || normalizedDeptsMap.get(normalizeKey(alias));
          }
        }

        // 4. Auto-create department on this campus if not yet registered
        if (!resolvedDept) {
          const cleanName = rawDept.trim();
          const code = generateDeptCode(cleanName);
          const newDeptRef = db
            .collection("locations")
            .doc(locationId)
            .collection("locationDepts")
            .doc();

          const newDeptData = {
            name: cleanName,
            code,
            description: "Auto-created during staff bulk import",
            locationId,
            headUid: null,
            headStaffId: null,
            headName: null,
            headEmail: null,
            headPhone: null,
            isActive: true,
            staffCount: 0,
            createdAt: now,
            updatedAt: now,
          };

          await newDeptRef.set(newDeptData);

          const newEntry = { id: newDeptRef.id, name: cleanName };
          deptsMap.set(rawDept.toLowerCase(), newEntry);
          deptsMap.set(cleanName.toLowerCase(), newEntry);
          if (code) deptsMap.set(code.toLowerCase(), newEntry);
          normalizedDeptsMap.set(normalizeKey(cleanName), newEntry);

          resolvedDept = newEntry;
          if (!newlyCreatedDeptNames.includes(cleanName)) {
            newlyCreatedDeptNames.push(cleanName);
          }
        }

        departmentId = resolvedDept.id;
        departmentName = resolvedDept.name;
      } else if (session.role === "LOCATION_DEPT_HEAD") {
        failed.push({ row: rowNum, name, error: "Department is required for Department Head import" });
        continue;
      }

      // Shift resolution (optional)
      let shiftId = "";
      let shiftName = "";
      if (rawShift) {
        const resolvedShift =
          shiftsMap.get(rawShift.toLowerCase()) || normalizedShiftsMap.get(normalizeKey(rawShift));
        if (resolvedShift) {
          shiftId = resolvedShift.id;
          shiftName = resolvedShift.name;
        }
      }

      // Optional phone/aadhaar validations
      if (spouseGuardianPhone && !/^\d{10}$/.test(spouseGuardianPhone)) {
        failed.push({ row: rowNum, name, error: "Spouse/Guardian Phone must be exactly 10 digits" });
        continue;
      }
      if (spouseGuardianAadhaar && !/^\d{12}$/.test(spouseGuardianAadhaar)) {
        failed.push({ row: rowNum, name, error: "Spouse/Guardian Aadhaar must be exactly 12 numeric digits" });
        continue;
      }

      batchAadhaars.add(aadhaar);
      if (departmentId) touchedDeptIds.add(departmentId);

      validPayloads.push({
        locationId,
        departmentId,
        departmentName,
        photoUrl: "",
        name,
        fatherName,
        contactNumber,
        aadhaar,
        spouseGuardianName,
        spouseGuardianPhone,
        spouseGuardianAadhaar,
        address,
        payeeVoucher,
        role,
        shiftId,
        shiftName,
        status,
        dateOfJoining,
        createdAt: now,
        updatedAt: now,
      });
    }

    // 5. Commit valid rows in chunked batches (400 per commit)
    const BATCH_SIZE = 400;
    let created = 0;

    for (let c = 0; c < validPayloads.length; c += BATCH_SIZE) {
      const chunk = validPayloads.slice(c, c + BATCH_SIZE);
      const batch = db.batch();

      for (const payload of chunk) {
        const ref = db.collection("locations").doc(locationId).collection("staff").doc();
        batch.set(ref, payload);
      }

      await batch.commit();
      created += chunk.length;
    }

    // 6. Update touched departments updatedAt and live staffCount
    if (touchedDeptIds.size > 0) {
      for (const dId of touchedDeptIds) {
        const staffCountSnap = await db
          .collection("locations")
          .doc(locationId)
          .collection("staff")
          .where("departmentId", "==", dId)
          .where("status", "==", "ACTIVE")
          .get()
          .catch(() => null);

        const count = staffCountSnap ? staffCountSnap.size : 0;
        const dRef = db.collection("locations").doc(locationId).collection("locationDepts").doc(dId);
        await dRef.set({ updatedAt: now, staffCount: count }, { merge: true }).catch(() => {});
      }
    }

    return NextResponse.json({
      created,
      failed,
      total: items.length,
      newDepartmentsCreated: newlyCreatedDeptNames,
    });
  } catch (err) {
    if (err instanceof Error && err.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[location/staff/bulk-import POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
