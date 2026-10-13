export interface ActingUser {
  uid: string;
  name: string;
  collegeId: string;
  role: string;
}

export class CertificationError extends Error {
  constructor(public code: string, message: string, public status: number) {
    super(message);
    this.name = "CertificationError";
  }
}
