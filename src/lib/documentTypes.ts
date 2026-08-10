// Shared checklist used by the HOD's "required documents" picker
// (hod/batches/[id]) and the candidate-form certificate uploader.
export const DOCUMENT_TYPE_GROUPS: { category: string; items: string[] }[] = [
  { category: "Identity Documents", items: [
    "Updated Resume / CV (2–5 copies)",
    "Passport-size Photographs (4–6 copies)",
    "Aadhaar Card",
    "PAN Card",
    "Passport / Voter ID (optional)",
  ] },
  { category: "Educational Certificates (Original + 2–3 Self-attested Copies)", items: [
    "10th Certificate & Marks Memo",
    "Intermediate (12th) Certificate & Marks Memo",
    "B.Tech Degree Certificate",
    "B.Tech Consolidated Marks Memo (CMM)",
    "M.Tech Degree Certificate",
    "M.Tech Consolidated Marks Memo",
    "Ph.D Certificate (if applicable)",
    "UGC/NET/SET Qualification Certificate",
  ] },
  { category: "Experience Documents", items: [
    "Appointment Letters",
    "Relieving Letters",
    "Experience Certificates",
    "Promotion Orders (if any)",
  ] },
  { category: "Current Salary Proof", items: [
    "Last 3 Salary Slips",
    "Latest Increment Letter",
    "Form 16 (optional)",
    "Bank Statement showing Salary",
  ] },
  { category: "Research Documents", items: [
    "List of Publications",
    "First Page / Full Copy of Important Research Papers",
    "Scopus/Web of Science Indexing Proof",
    "Google Scholar Profile Print",
    "Patent Certificates (if any)",
    "Books/Book Chapters (if any)",
  ] },
  { category: "Teaching Portfolio", items: [
    "Subjects Handled",
    "Lesson Plans",
    "PPTs",
    "Student Feedback (if available)",
    "Result Analysis",
    "Funded Projects",
    "Consultancy",
    "FDPs",
    "Workshops Conducted",
    "MOOCs/NPTEL Certifications",
  ] },
  { category: "Category Certificate", items: [
    "SC/ST/OBC-EWS Certificate (if applicable)",
    "PwD Certificate (if applicable)",
  ] },
];

// Maps each "Educational Certificates" document label to a prefilled
// AcademicQualification.degree value. When the HOD requires one of these,
// the candidate form renders a structured qualification card (degree,
// institution, year, percentage/CGPA + certificate upload) for it instead
// of a bare file upload, and prefills the degree tile from this table.
export const EDUCATION_DOCUMENT_TEMPLATES: Record<string, string> = {
  "10th Certificate & Marks Memo": "10th / SSC",
  "Intermediate (12th) Certificate & Marks Memo": "Intermediate / 12th",
  "B.Tech Degree Certificate": "B.Tech",
  "B.Tech Consolidated Marks Memo (CMM)": "B.Tech",
  "M.Tech Degree Certificate": "M.Tech",
  "M.Tech Consolidated Marks Memo": "M.Tech",
  "Ph.D Certificate (if applicable)": "Ph.D",
  "UGC/NET/SET Qualification Certificate": "UGC-NET/SET",
};
