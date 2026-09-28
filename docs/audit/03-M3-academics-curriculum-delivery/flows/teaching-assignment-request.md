# Flow — M3-F3: Cross-Department Teaching Assignment Request

- **Flow ID:** M3-F3
- **Actors:** HOD (requester), target faculty, target dept HOD (approver)
- **Trigger:** assignment needs a faculty from another department
- **Preconditions:** subject/section in requester's dept; faculty exists in target dept
- **Main success scenario:**
  1. `POST /api/college/faculty-assignment-requests` → status PENDING (teaching.ts:208).
  2. Notify target faculty/HOD (notify callsites faculty-assignment-requests).
  3. Target accepts → status ALLOCATED → teaching assignment created (`teachingAssignments`).
  4. Decline → DECLINED (requester picks someone else).
- **Alternate/error:** duplicate pending request → 409 `[ASSUMPTION]`; unauthorized target → 403.
- **UI:** `/hod/assignment-requests`, `/college-staff/assignment-requests`, `/panel/assignment-requests`.
- **API:** `faculty-assignment-requests` + `[id]`.
- **DB:** `facultyAssignmentRequests`, `teachingAssignments`.
- **Permissions:** college member + dept scope on both sides.
- **State transitions:** PENDING→ALLOCATED|DECLINED.
- **Side effects:** notifications; audit `[UNVERIFIED]`.
- **Code evidence:** teaching.ts:208-253 (FacultyAssignmentRequest), notify referencedBy.
