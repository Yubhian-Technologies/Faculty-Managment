/**
 * Column definitions and template generators for Location Staff Bulk CSV/Excel Import.
 */

import type { LocationDepartment, LocationShift } from "@/types/locationStaff";

export interface LocationStaffCsvColumn {
  key: string;
  label: string;
  required: boolean;
  aliases: string[];
  description: string;
  sample: string;
}

export const LOCATION_STAFF_CSV_COLUMNS: LocationStaffCsvColumn[] = [
  {
    key: "name",
    label: "Staff Name",
    required: true,
    aliases: ["Name", "Full Name", "Employee Name", "staff_name", "staffName"],
    description: "Full legal name of the staff member",
    sample: "Ramesh Kumar",
  },
  {
    key: "contactNumber",
    label: "Contact Number",
    required: true,
    aliases: ["Phone", "Mobile", "Contact", "Phone Number", "mobile_number", "contact_number"],
    description: "10-digit mobile number",
    sample: "9876543210",
  },
  {
    key: "aadhaar",
    label: "Aadhaar Number",
    required: true,
    aliases: ["Aadhaar", "Aadhar", "Aadhar Number", "UID", "National ID", "aadhaar_number"],
    description: "12-digit national Aadhaar number",
    sample: "123456789012",
  },
  {
    key: "department",
    label: "Department",
    required: true,
    aliases: ["Dept", "Department Name", "location_department", "dept_name"],
    description: "Campus department name or code (e.g., Security, Housekeeping, Transport, Maintenance)",
    sample: "Security",
  },
  {
    key: "role",
    label: "Role",
    required: true,
    aliases: ["Designation", "Job Title", "Position", "Post", "job_role"],
    description: "Job designation (e.g., Security Guard, Supervisor, Driver, Electrician, Sweeper, Plumber)",
    sample: "Security Guard",
  },
  {
    key: "payeeVoucher",
    label: "Payee Voucher",
    required: true,
    aliases: ["Payee", "Payment Mode", "Payee Type", "Voucher", "payee_voucher"],
    description: "Payment or payroll mode (e.g. VOUCHER, CONTRACT, DAILY_WAGE, BANK_TRANSFER)",
    sample: "VOUCHER",
  },
  {
    key: "shift",
    label: "Shift Name",
    required: false,
    aliases: ["Shift", "Working Shift", "shift_name"],
    description: "Shift name (e.g., Morning Shift, General Shift, Night Shift)",
    sample: "Morning Shift",
  },
  {
    key: "fatherName",
    label: "Father Name",
    required: false,
    aliases: ["Father's Name", "Father", "parent_name"],
    description: "Father or parent name",
    sample: "Suresh Kumar",
  },
  {
    key: "address",
    label: "Address",
    required: false,
    aliases: ["Residential Address", "City", "Location"],
    description: "Residential address or village",
    sample: "Flat 101, Main Road, Bhimavaram",
  },
  {
    key: "spouseGuardianName",
    label: "Spouse Guardian Name",
    required: false,
    aliases: ["Spouse Name", "Guardian Name", "Nominee Name"],
    description: "Spouse or guardian's full name",
    sample: "Radha Kumari",
  },
  {
    key: "spouseGuardianPhone",
    label: "Spouse Guardian Phone",
    required: false,
    aliases: ["Spouse Phone", "Guardian Phone"],
    description: "10-digit phone number of spouse/guardian",
    sample: "9876543211",
  },
  {
    key: "spouseGuardianAadhaar",
    label: "Spouse Guardian Aadhaar",
    required: false,
    aliases: ["Spouse Aadhaar", "Guardian Aadhaar"],
    description: "12-digit Aadhaar of spouse/guardian",
    sample: "987654321098",
  },
  {
    key: "dateOfJoining",
    label: "Date of Joining",
    required: false,
    aliases: ["Joining Date", "DOJ", "Date Joined", "joining_date"],
    description: "Format: YYYY-MM-DD",
    sample: "2026-01-15",
  },
  {
    key: "status",
    label: "Status",
    required: false,
    aliases: ["Employment Status", "Active Status"],
    description: "ACTIVE or INACTIVE (defaults to ACTIVE)",
    sample: "ACTIVE",
  },
];

export function generateLocationStaffSampleRows(
  departments: LocationDepartment[] = [],
  shifts: LocationShift[] = []
): Record<string, string>[] {
  const d1 = departments[0]?.name || "Security";
  const d2 = departments[1]?.name || "Housekeeping";
  const d3 = departments[2]?.name || "Maintenance";

  const s1 = shifts[0]?.name || "General Shift";
  const s2 = shifts[1]?.name || "Morning Shift";

  return [
    {
      name: "Ramesh Kumar",
      contactNumber: "9876543210",
      aadhaar: "123456789012",
      department: d1,
      role: "Security Guard",
      payeeVoucher: "VOUCHER",
      shift: s1,
      fatherName: "Suresh Kumar",
      address: "Bhimavaram",
      spouseGuardianName: "Radha Kumari",
      spouseGuardianPhone: "9876543211",
      spouseGuardianAadhaar: "987654321098",
      dateOfJoining: "2026-01-15",
      status: "ACTIVE",
    },
    {
      name: "Prakash Rao",
      contactNumber: "9876543220",
      aadhaar: "234567890123",
      department: d2,
      role: "Sweeper",
      payeeVoucher: "DAILY_WAGE",
      shift: s2,
      fatherName: "Venkat Rao",
      address: "Palakollu",
      spouseGuardianName: "",
      spouseGuardianPhone: "",
      spouseGuardianAadhaar: "",
      dateOfJoining: "2026-02-01",
      status: "ACTIVE",
    },
    {
      name: "Manoj Sharma",
      contactNumber: "9876543230",
      aadhaar: "345678901234",
      department: d3,
      role: "Electrician",
      payeeVoucher: "CONTRACT",
      shift: s1,
      fatherName: "Anand Sharma",
      address: "Tadepalligudem",
      spouseGuardianName: "Sunita Sharma",
      spouseGuardianPhone: "9876543231",
      spouseGuardianAadhaar: "",
      dateOfJoining: "2026-03-10",
      status: "ACTIVE",
    },
  ];
}

export function generateLocationStaffCsvTemplate(
  departments: LocationDepartment[] = [],
  shifts: LocationShift[] = []
): string {
  const headers = LOCATION_STAFF_CSV_COLUMNS.map((c) => c.label);
  const sampleRows = generateLocationStaffSampleRows(departments, shifts);

  const lines: string[] = [
    headers.join(","),
    ...sampleRows.map((row) =>
      LOCATION_STAFF_CSV_COLUMNS.map((col) => {
        const val = row[col.key] || "";
        return val.includes(",") ? `"${val}"` : val;
      }).join(",")
    ),
  ];

  return lines.join("\r\n");
}
