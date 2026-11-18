export interface ActingUser {
  uid: string;
  name: string;
  collegeId: string;
  role: string;
  /** A College Admin login: may act on any pending step / clearance on the approver's behalf (a stalled request). */
  onBehalfAll?: boolean;
}

export class CertificationError extends Error {
  constructor(public code: string, message: string, public status: number) {
    super(message);
    this.name = "CertificationError";
  }
}
