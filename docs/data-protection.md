# Personal data: where it lives and who can see it

## Sensitive fields
| Data | Fields | Stored in | Source types |
|---|---|---|---|
| Aadhaar, PAN, passport | `aadharNo`, `panNo`, `passportNo` | `colleges/{id}/facultyMembers`, `supportingStaff`, `users`; candidate applications | `src/types/core.ts`, `supportingStaff.ts`, `recruitment.ts` |
| Bank | `bankAccountNumber` / `bankAccountNo`, `ifscCode` | same, plus `salaryRecords`, `locations/{id}/locationUsers` | `core.ts`, `supportingStaff.ts`, `locationStaff.ts` |
| Provident fund | `pfNumber`, `uanNumber` | `facultyMembers`, `supportingStaff` | `core.ts` |
| Face data | `faceEmbedding` (numeric descriptor), `faceRegisteredAt` | `facultyMembers`, `users`; attendance check-in evidence on `attendanceRecords` | face-registration and attendance routes |
| Uploaded identity documents | certificates, resumes, student documents | Cloud Storage under `colleges/{id}/...` and role-named folders | `storage.rules` |

All of it is stored in plain form in Firestore. Encryption at rest is Google's default. There is no field-level encryption.

## Who can read it
- **Browsers:** after the rules update in `firestore.rules`, browsers can read only the signed-in person's own profile (and a student's own record). Everything else goes through API routes using the Admin SDK.
- **API routes:** each route self-guards through `src/lib/auth/verifySession.ts` and scopes by department with `src/lib/departments/scope.ts`. Role projections for lists are in `src/lib/students/listProjection.ts`.
- **Face descriptors:** returned only by the attendance routes that need them for matching; never send them to a list view.

## Masking
`src/lib/privacy/mask.ts` provides `maskTail`, `maskAadhaar` and `maskSensitiveIds`. Use them in any list, summary or export for a role that doesn't need the full number. The stored value is never changed.

## To do next (not yet done)
1. Run `maskSensitiveIds` in list/export routes for roles other than HR/Principal, one route at a time, with a test each.
2. Decide a retention period for face descriptors of people who have left, and a deletion job.
3. Consider field-level encryption for Aadhaar and bank numbers.
4. Log reads of full Aadhaar/PAN/bank values to the audit log.
