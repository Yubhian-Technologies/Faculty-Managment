import {
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  updateDoc,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  Timestamp,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import type {
  VacancyRequest,
  Candidate,
  CandidateApplication,
  HiringBatch,
  PanelFeedback,
  StudentFeedback,
  OfferLetter,
  AppointmentLetter,
  AuditLog,
  AppNotification,
  WorkflowStatus,
  AuditAction,
} from "@/types";

const PAGE_SIZE = 20;

// ─── Vacancy Requests ─────────────────────────────────────────────────────────

export async function createVacancyRequest(
  collegeId: string,
  data: Omit<VacancyRequest, "id" | "createdAt" | "updatedAt">
): Promise<string> {
  const ref = collection(db, "colleges", collegeId, "vacancyRequests");
  const docRef = await addDoc(ref, {
    ...data,
    collegeId,
    status: "PENDING",
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  });
  return docRef.id;
}

export async function getVacancyRequests(
  collegeId: string,
  filters?: { status?: WorkflowStatus; department?: string },
  lastDoc?: QueryDocumentSnapshot
): Promise<{ data: VacancyRequest[]; lastDoc: QueryDocumentSnapshot | null }> {
  const ref = collection(db, "colleges", collegeId, "vacancyRequests");
  let q = query(ref, orderBy("createdAt", "desc"), limit(PAGE_SIZE));
  if (filters?.status) q = query(q, where("status", "==", filters.status));
  if (filters?.department) q = query(q, where("department", "==", filters.department));
  if (lastDoc) q = query(q, startAfter(lastDoc));

  const snap = await getDocs(q);
  return {
    data: snap.docs.map((d) => ({ id: d.id, ...d.data() }) as VacancyRequest),
    lastDoc: snap.docs[snap.docs.length - 1] ?? null,
  };
}

export async function getVacancyById(
  collegeId: string,
  vacancyId: string
): Promise<VacancyRequest | null> {
  const ref = doc(db, "colleges", collegeId, "vacancyRequests", vacancyId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() } as VacancyRequest;
}

export async function updateVacancyStatus(
  collegeId: string,
  vacancyId: string,
  status: WorkflowStatus,
  principalResponse?: VacancyRequest["principalResponse"]
): Promise<void> {
  const ref = doc(db, "colleges", collegeId, "vacancyRequests", vacancyId);
  await updateDoc(ref, {
    status,
    ...(principalResponse && { principalResponse }),
    updatedAt: Timestamp.now(),
  });
}

// ─── Candidates ───────────────────────────────────────────────────────────────
// Candidate is a pure person record — created independently of any hiring
// request. See CandidateApplication below for the per-hiring-cycle join entity.

export async function createCandidate(
  collegeId: string,
  data: Omit<Candidate, "id" | "createdAt" | "updatedAt">
): Promise<string> {
  const ref = collection(db, "colleges", collegeId, "candidates");
  const docRef = await addDoc(ref, {
    ...data,
    collegeId,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  });
  return docRef.id;
}

export async function getCandidates(
  collegeId: string,
  lastDoc?: QueryDocumentSnapshot
): Promise<{ data: Candidate[]; lastDoc: QueryDocumentSnapshot | null }> {
  const ref = collection(db, "colleges", collegeId, "candidates");
  let q = query(ref, orderBy("createdAt", "desc"), limit(PAGE_SIZE));
  if (lastDoc) q = query(q, startAfter(lastDoc));

  const snap = await getDocs(q);
  return {
    data: snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Candidate),
    lastDoc: snap.docs[snap.docs.length - 1] ?? null,
  };
}

export async function getCandidateById(
  collegeId: string,
  candidateId: string
): Promise<Candidate | null> {
  const ref = doc(db, "colleges", collegeId, "candidates", candidateId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() } as Candidate;
}

export async function updateCandidate(
  collegeId: string,
  candidateId: string,
  data: Partial<Candidate>
): Promise<void> {
  const ref = doc(db, "colleges", collegeId, "candidates", candidateId);
  await updateDoc(ref, { ...data, updatedAt: Timestamp.now() });
}

// ─── Candidate Applications ───────────────────────────────────────────────────
// Join entity: a candidate attached to one hiring request (VacancyRequest).
// Owns all per-hiring-cycle state; a candidate may have several of these.

export async function createCandidateApplication(
  collegeId: string,
  data: Omit<CandidateApplication, "id" | "createdAt" | "updatedAt">
): Promise<string> {
  const ref = collection(db, "colleges", collegeId, "candidateApplications");
  const docRef = await addDoc(ref, {
    ...data,
    collegeId,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  });
  return docRef.id;
}

export async function getCandidateApplications(
  collegeId: string,
  filters?: {
    status?: string;
    department?: string;
    candidateId?: string;
    vacancyRequestId?: string;
    batchId?: string;
    isShortlisted?: boolean;
  },
  lastDoc?: QueryDocumentSnapshot
): Promise<{ data: CandidateApplication[]; lastDoc: QueryDocumentSnapshot | null }> {
  const ref = collection(db, "colleges", collegeId, "candidateApplications");
  let q = query(ref, orderBy("createdAt", "desc"), limit(PAGE_SIZE));
  if (filters?.status) q = query(q, where("status", "==", filters.status));
  if (filters?.department) q = query(q, where("department", "==", filters.department));
  if (filters?.candidateId) q = query(q, where("candidateId", "==", filters.candidateId));
  if (filters?.vacancyRequestId)
    q = query(q, where("vacancyRequestId", "==", filters.vacancyRequestId));
  if (filters?.batchId) q = query(q, where("batchId", "==", filters.batchId));
  if (filters?.isShortlisted !== undefined)
    q = query(q, where("isShortlisted", "==", filters.isShortlisted));
  if (lastDoc) q = query(q, startAfter(lastDoc));

  const snap = await getDocs(q);
  return {
    data: snap.docs.map((d) => ({ id: d.id, ...d.data() }) as CandidateApplication),
    lastDoc: snap.docs[snap.docs.length - 1] ?? null,
  };
}

export async function getCandidateApplicationById(
  collegeId: string,
  applicationId: string
): Promise<CandidateApplication | null> {
  const ref = doc(db, "colleges", collegeId, "candidateApplications", applicationId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() } as CandidateApplication;
}

export async function updateCandidateApplication(
  collegeId: string,
  applicationId: string,
  data: Partial<CandidateApplication>
): Promise<void> {
  const ref = doc(db, "colleges", collegeId, "candidateApplications", applicationId);
  await updateDoc(ref, { ...data, updatedAt: Timestamp.now() });
}

export async function markCandidateApplicationArrived(
  collegeId: string,
  applicationId: string
): Promise<void> {
  await updateCandidateApplication(collegeId, applicationId, {
    hasArrived: true,
    arrivedAt: Timestamp.now(),
    status: "ARRIVED",
  });
}

// ─── Hiring Batches ───────────────────────────────────────────────────────────

export async function createHiringBatch(
  collegeId: string,
  data: Omit<HiringBatch, "id" | "createdAt" | "updatedAt">
): Promise<string> {
  const ref = collection(db, "colleges", collegeId, "hiringBatches");
  const docRef = await addDoc(ref, {
    ...data,
    collegeId,
    status: "PENDING",
    setupComplete: false,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  });
  return docRef.id;
}

export async function getHiringBatches(
  collegeId: string,
  filters?: { status?: WorkflowStatus; hodUid?: string },
  lastDoc?: QueryDocumentSnapshot
): Promise<{ data: HiringBatch[]; lastDoc: QueryDocumentSnapshot | null }> {
  const ref = collection(db, "colleges", collegeId, "hiringBatches");
  let q = query(ref, orderBy("createdAt", "desc"), limit(PAGE_SIZE));
  if (filters?.status) q = query(q, where("status", "==", filters.status));
  if (filters?.hodUid) q = query(q, where("hodUid", "==", filters.hodUid));
  if (lastDoc) q = query(q, startAfter(lastDoc));

  const snap = await getDocs(q);
  return {
    data: snap.docs.map((d) => ({ id: d.id, ...d.data() }) as HiringBatch),
    lastDoc: snap.docs[snap.docs.length - 1] ?? null,
  };
}

export async function getBatchById(
  collegeId: string,
  batchId: string
): Promise<HiringBatch | null> {
  const ref = doc(db, "colleges", collegeId, "hiringBatches", batchId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() } as HiringBatch;
}

export async function updateHiringBatch(
  collegeId: string,
  batchId: string,
  data: Partial<HiringBatch>
): Promise<void> {
  const ref = doc(db, "colleges", collegeId, "hiringBatches", batchId);
  await updateDoc(ref, { ...data, updatedAt: Timestamp.now() });
}

export async function getPanelBatches(
  collegeId: string,
  panelUid: string
): Promise<HiringBatch[]> {
  const ref = collection(db, "colleges", collegeId, "hiringBatches");
  const q = query(
    ref,
    where("panelMemberUids", "array-contains", panelUid),
    where("status", "!=", "REJECTED"),
    orderBy("status"),
    orderBy("interviewDate", "desc")
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as HiringBatch);
}

// ─── Panel Feedback ───────────────────────────────────────────────────────────

export async function submitPanelFeedback(
  collegeId: string,
  batchId: string,
  data: Omit<PanelFeedback, "id" | "submittedAt">
): Promise<string> {
  const ref = collection(db, "colleges", collegeId, "hiringBatches", batchId, "panelFeedback");
  const docRef = await addDoc(ref, {
    ...data,
    collegeId,
    submittedAt: Timestamp.now(),
  });
  return docRef.id;
}

export async function getPanelFeedbackForCandidate(
  collegeId: string,
  batchId: string,
  candidateId: string
): Promise<PanelFeedback[]> {
  const ref = collection(db, "colleges", collegeId, "hiringBatches", batchId, "panelFeedback");
  const q = query(ref, where("candidateId", "==", candidateId));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as PanelFeedback);
}

// ─── Student Feedback ─────────────────────────────────────────────────────────

export async function submitStudentFeedback(
  collegeId: string,
  batchId: string,
  data: Omit<StudentFeedback, "id" | "submittedAt">
): Promise<string> {
  const ref = collection(db, "colleges", collegeId, "hiringBatches", batchId, "studentFeedback");
  const docRef = await addDoc(ref, {
    ...data,
    collegeId,
    submittedAt: Timestamp.now(),
  });
  return docRef.id;
}

// ─── Offer / Appointment Letters ─────────────────────────────────────────────

export async function createOfferLetter(
  collegeId: string,
  data: Omit<OfferLetter, "id" | "generatedAt">
): Promise<string> {
  const ref = collection(db, "colleges", collegeId, "offerLetters");
  const docRef = await addDoc(ref, {
    ...data,
    collegeId,
    generatedAt: Timestamp.now(),
  });
  return docRef.id;
}

export async function getOfferLetter(
  collegeId: string,
  candidateId: string
): Promise<OfferLetter | null> {
  const ref = collection(db, "colleges", collegeId, "offerLetters");
  const q = query(ref, where("candidateId", "==", candidateId));
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const d = snap.docs[0];
  return { id: d.id, ...d.data() } as OfferLetter;
}

export async function createAppointmentLetter(
  collegeId: string,
  data: Omit<AppointmentLetter, "id" | "generatedAt">
): Promise<string> {
  const ref = collection(db, "colleges", collegeId, "appointmentLetters");
  const docRef = await addDoc(ref, {
    ...data,
    collegeId,
    generatedAt: Timestamp.now(),
  });
  return docRef.id;
}

// ─── Notifications ────────────────────────────────────────────────────────────

export async function createNotification(
  collegeId: string,
  data: Omit<AppNotification, "id" | "createdAt">
): Promise<string> {
  const ref = collection(db, "colleges", collegeId, "notifications");
  const docRef = await addDoc(ref, {
    ...data,
    collegeId,
    read: false,
    createdAt: Timestamp.now(),
  });
  return docRef.id;
}

export async function markNotificationRead(
  collegeId: string,
  notificationId: string
): Promise<void> {
  const ref = doc(db, "colleges", collegeId, "notifications", notificationId);
  await updateDoc(ref, { read: true });
}

// ─── Audit Logs ───────────────────────────────────────────────────────────────

export async function createAuditLog(
  collegeId: string,
  data: Omit<AuditLog, "id" | "timestamp">
): Promise<void> {
  const ref = collection(db, "colleges", collegeId, "auditLogs");
  await addDoc(ref, {
    ...data,
    collegeId,
    timestamp: Timestamp.now(),
  });
}

export async function logAction(
  collegeId: string,
  action: AuditAction,
  performedBy: string,
  performedByName: string,
  details?: Record<string, unknown>
): Promise<void> {
  await createAuditLog(collegeId, {
    collegeId,
    action,
    performedBy,
    performedByName,
    details,
  });
}
