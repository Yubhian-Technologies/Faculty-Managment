// Client-safe limits shared by the Curriculum pages and the services that enforce them.

/** Each saved subject costs three writes (subject + code lock + name lock); one transaction allows 500. */
export const MASTER_IMPORT_MAX_ROWS = 150;

/** Codes accepted by one Assign-by-code request. */
export const ASSIGN_MAX_CODES = 100;
