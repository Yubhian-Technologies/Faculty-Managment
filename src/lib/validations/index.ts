import { z } from "zod";

// ─── Auth ─────────────────────────────────────────────────────────────────────

export const loginSchema = z.object({
  email: z.string().email("Enter a valid email address"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

export type LoginFormData = z.infer<typeof loginSchema>;

// ─── User Management ──────────────────────────────────────────────────────────

export const createUserSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email("Enter a valid email address"),
  collegeEmail: z.string().email("Enter a valid email address").optional().or(z.literal("")),
  employeeId: z.string().optional(),
  role: z.enum([
    "SUPER_ADMIN",
    "PRINCIPAL",
    "VICE_PRINCIPAL",
    "HOD",
    "COLLEGE_OFFICE",
    "COLLEGE_STAFF",
    "PANEL_MEMBER",
    "ACCOUNTS",
    "STUDENT",
  ]),
  collegeId: z.string().min(1, "Select a college"),
  department: z.string().optional(),
  designation: z.string().optional(),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

export type CreateUserFormData = z.infer<typeof createUserSchema>;

// ─── Department ──────────────────────────────────────────────────────────────

export const departmentSchema = z.object({
  name: z.string().min(2, "Department name is required"),
  code: z.string().min(1, "Short code is required").max(10, "Max 10 characters").toUpperCase(),
  hodUid: z.string().optional(),
});

export type DepartmentFormData = z.infer<typeof departmentSchema>;

// ─── Salary Structure ──────────────────────────────────────────────────────────

export const salaryStructureSchema = z.object({
  name: z.string().min(2, "Name is required"),
  designation: z.string().min(1, "Designation is required"),
  employmentType: z.string().min(1, "Employment type is required"),
  basic: z.number().min(0, "Basic must be 0 or more"),
  hraPercent: z.number().min(0).max(100),
  daPercent: z.number().min(0).max(100),
  ta: z.number().min(0),
  medicalAllowance: z.number().min(0),
  otherAllowances: z.number().min(0),
  employeePfPercent: z.number().min(0).max(100),
  employerPfPercent: z.number().min(0).max(100),
  professionalTax: z.number().min(0),
  effectiveFrom: z.string().min(1, "Effective date is required"),
});

export type SalaryStructureFormData = z.infer<typeof salaryStructureSchema>;

// ─── College ─────────────────────────────────────────────────────────────────

export const createCollegeSchema = z.object({
  name: z.string().min(2, "College name is required"),
  locationId: z.string().min(1, "Location is required"),
  address: z.string().optional(),
  contactEmail: z.string().email("Enter a valid email").optional().or(z.literal("")),
  contactPhone: z.string().optional(),
});

export type CreateCollegeFormData = z.infer<typeof createCollegeSchema>;

// ─── Vacancy ─────────────────────────────────────────────────────────────────

export const vacancyRequestSchema = z.object({
  department: z.string().min(1, "Department is required"),
  position: z.string().min(1, "Position/designation is required"),
  requiredCount: z.number().int().min(1, "At least 1 vacancy required"),
  availableCount: z.number().int().min(0),
  justification: z.string().min(10, "Please provide a justification (min 10 chars)"),
});

export type VacancyRequestFormData = z.infer<typeof vacancyRequestSchema>;

export const principalVacancyResponseSchema = z.object({
  action: z.enum(["APPROVED", "REJECTED"]),
  reason: z.string().optional(),
});

export type PrincipalVacancyResponseData = z.infer<typeof principalVacancyResponseSchema>;

// ─── Candidate ────────────────────────────────────────────────────────────────

export const candidateSchema = z.object({
  name: z.string().min(2, "Name is required"),
  email: z.string().email("Enter a valid email"),
  phone: z
    .string()
    .regex(/^[6-9]\d{9}$/, "Enter a valid 10-digit Indian mobile number"),
  department: z.string().min(1, "Department is required"),
  position: z.string().min(1, "Position is required"),
  source: z.enum(["REFERRAL", "CAREERS_PAGE"]),
  vacancyId: z.string().optional(),
});

export type CandidateFormData = z.infer<typeof candidateSchema>;

export const publicApplicationSchema = z.object({
  name: z.string().min(2, "Name is required"),
  email: z.string().email("Enter a valid email"),
  phone: z
    .string()
    .regex(/^[6-9]\d{9}$/, "Enter a valid 10-digit Indian mobile number"),
  coverLetter: z
    .string()
    .max(1000, "Cover letter must be under 1000 characters")
    .optional(),
});

export type PublicApplicationFormData = z.infer<typeof publicApplicationSchema>;

// ─── Hiring Batch ─────────────────────────────────────────────────────────────

export const hiringBatchSchema = z.object({
  vacancyId: z.string().min(1, "Vacancy is required"),
  panelMemberUids: z
    .array(z.string())
    .min(4, "Select at least 4 panel members")
    .max(6, "Maximum 6 panel members allowed"),
  interviewDate: z.date({ error: "Interview date is required" }),
  candidateIds: z.array(z.string()).min(1, "Select at least one candidate"),
});

export type HiringBatchFormData = z.infer<typeof hiringBatchSchema>;

export const collegeOfficeSetupSchema = z.object({
  interviewVenue: z.string().min(2, "Venue is required"),
  requiredDocuments: z
    .array(z.string())
    .min(1, "Add at least one required document"),
});

export type CollegeOfficeSetupData = z.infer<typeof collegeOfficeSetupSchema>;

export const hodFinalSetupSchema = z.object({
  demoClassroom: z.string().min(1, "Demo classroom is required"),
  coordinatorName: z.string().min(2, "Coordinator name is required"),
});

export type HodFinalSetupData = z.infer<typeof hodFinalSetupSchema>;

// ─── Feedback ─────────────────────────────────────────────────────────────────

export const panelFeedbackSchema = z.object({
  ratings: z.object({
    subjectKnowledge: z.number().int().min(1).max(5),
    communication: z.number().int().min(1).max(5),
    teachingAptitude: z.number().int().min(1).max(5),
    personality: z.number().int().min(1).max(5),
    researchAptitude: z.number().int().min(1).max(5),
    overallImpression: z.number().int().min(1).max(5),
  }),
  subjectRecommendations: z.array(z.string()).optional(),
  strengths: z.string().optional(),
  weaknesses: z.string().optional(),
  recommendation: z.enum(["RECOMMENDED", "NOT_RECOMMENDED", "HOLD"]),
  comments: z.string().optional(),
});

export type PanelFeedbackFormData = z.infer<typeof panelFeedbackSchema>;

export const studentFeedbackSchema = z.object({
  ratings: z.object({
    clarity: z.number().int().min(1).max(5),
    engagement: z.number().int().min(1).max(5),
    knowledgeDepth: z.number().int().min(1).max(5),
    timeManagement: z.number().int().min(1).max(5),
    overallImpression: z.number().int().min(1).max(5),
  }),
  comments: z.string().max(500).optional(),
});

export type StudentFeedbackFormData = z.infer<typeof studentFeedbackSchema>;

export const hrFeedbackSchema = z.object({
  ratings: z.object({
    attitude: z.number().int().min(1).max(5),
    teamwork: z.number().int().min(1).max(5),
    adaptability: z.number().int().min(1).max(5),
    communication: z.number().int().min(1).max(5),
    overallFit: z.number().int().min(1).max(5),
  }),
  salaryExpectation: z.number().optional(),
  noticePeriod: z.string().optional(),
  recommendation: z.enum(["RECOMMENDED", "NOT_RECOMMENDED", "HOLD"]),
  comments: z.string().optional(),
});

export type HRFeedbackFormData = z.infer<typeof hrFeedbackSchema>;

// ─── Salary ───────────────────────────────────────────────────────────────────

export const salarySchema = z.object({
  monthly: z.number().min(1, "Monthly salary is required"),
  basic: z.number().min(0),
  hra: z.number().min(0),
  da: z.number().min(0),
  ta: z.number().min(0),
  medicalAllowance: z.number().min(0),
  otherAllowances: z.number().min(0),
  pf: z.number().min(0),
  professionalTax: z.number().min(0),
  tds: z.number().min(0),
});

export type SalaryFormData = z.infer<typeof salarySchema>;

// ─── Offer Letter ─────────────────────────────────────────────────────────────

export const offerLetterSchema = z.object({
  designation: z.string().min(1, "Designation is required"),
  department: z.string().min(1, "Department is required"),
  joiningDate: z.date({ error: "Joining date is required" }),
  subjects: z.array(z.string()).optional(),
});

export type OfferLetterFormData = z.infer<typeof offerLetterSchema>;
