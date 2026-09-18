import type { ConsultancyCategory, ConsultancyClientType, ConsultancyDeliverable } from "@/types";

export const CONSULTANCY_CLIENT_TYPE_LABELS: Record<ConsultancyClientType, string> = {
  INDUSTRY: "Industry",
  GOVERNMENT: "Government",
  ACADEMIC_INSTITUTION: "Academic Institution",
  NGO: "NGO",
  STARTUP: "Startup",
  MSME: "MSME",
};

export const CONSULTANCY_CATEGORY_LABELS: Record<ConsultancyCategory, string> = {
  TECHNICAL: "Technical",
  TESTING: "Testing",
  TRAINING: "Training",
  DESIGN: "Design",
  SOFTWARE_DEVELOPMENT: "Software Development",
};

export const CONSULTANCY_DELIVERABLE_LABELS: Record<ConsultancyDeliverable, string> = {
  REPORTS: "Reports",
  SOFTWARE: "Software",
  PROTOTYPE: "Prototype",
  TESTING_REPORT: "Testing Report",
  DESIGN: "Design",
  TRAINING: "Training",
  OTHERS: "Others",
};

export const CONSULTANCY_CLIENT_TYPES = Object.keys(CONSULTANCY_CLIENT_TYPE_LABELS) as ConsultancyClientType[];
export const CONSULTANCY_CATEGORIES = Object.keys(CONSULTANCY_CATEGORY_LABELS) as ConsultancyCategory[];
export const CONSULTANCY_DELIVERABLES = Object.keys(CONSULTANCY_DELIVERABLE_LABELS) as ConsultancyDeliverable[];
