import type { Timestamp } from "firebase/firestore";

// colleges/{collegeId}/books/{bookId}
export interface Book {
  id: string;
  collegeId: string;
  title: string;
  author: string;
  isbn?: string;
  category?: string;
  publisher?: string;
  totalCopies: number;
  availableCopies: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export type BookLoanStatus = "ACTIVE" | "RETURNED" | "OVERDUE";

// colleges/{collegeId}/bookLoans/{loanId}
export interface BookLoan {
  id: string;
  collegeId: string;
  studentId: string; // students/{id} doc id
  studentUid: string; // denormalized auth uid - lets the student's own /me query filter directly
  studentName: string;
  studentRollNumber: string;
  bookId: string;
  bookTitle: string; // denormalized for list views, same convention as facultyName elsewhere
  borrowedAt: Timestamp;
  dueAt: Timestamp;
  returnedAt?: Timestamp;
  status: BookLoanStatus;
  fineAmount?: number;
  finePaid?: boolean;
  renewalCount?: number;
  issuedBy: string; // uid
  issuedByName: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export type BookReservationStatus = "WAITING" | "NOTIFIED" | "CANCELLED" | "FULFILLED";

// colleges/{collegeId}/bookReservations/{reservationId}
export interface BookReservation {
  id: string;
  collegeId: string;
  studentId: string;
  studentUid: string;
  studentName: string;
  bookId: string;
  bookTitle: string;
  queuedAt: Timestamp;
  status: BookReservationStatus;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
