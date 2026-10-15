// Client-safe limits shared by the Curriculum pages and the services that enforce them.

// Each saved subject costs three writes (subject + code lock + name lock).
// The commit itself is chunked (SubjectMasterService.importMany, 150 rows =
// 450 writes per chunk) so no single Firestore transaction is asked for more
// than its ~500-write ceiling even at this cap - each chunk is independently
// re-claimed and atomic, so a conflict partway through only ever applies to
// a whole chunk, never half a row.
export const MASTER_IMPORT_MAX_ROWS = 500;

/** Codes accepted by one Assign-by-code request. */
export const ASSIGN_MAX_CODES = 100;
