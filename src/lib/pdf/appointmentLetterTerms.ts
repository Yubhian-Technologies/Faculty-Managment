// Default appointment-order clause set, extracted from the college's standard
// paper "Appointment Order" format so the Principal doesn't retype it for
// every candidate — one clause per line, pre-filled into the editable Terms &
// Conditions field on /principal/appointment-letters and injected into the
// PDF/email via getAppointmentLetterHTML. The compensation clause (clause 4) is
// auto-filled from the Principal-approved negotiated salary when available;
// there's no structured Basic/D.A./H.R.A. breakdown on the candidate record, so
// the consolidated figure is filled and the break-up left to the Institution's
// rules. When no salary is passed, the blanks are left for manual entry.
export function getDefaultAppointmentTerms({
  collegeName,
  collegeAddress,
  collegePhone,
  annualSalary,
}: {
  collegeName: string;
  collegeAddress?: string;
  collegePhone?: string;
  annualSalary?: number;
}): string {
  const principalAddress = [collegeName, collegeAddress].filter(Boolean).join(", ");
  const payClause =
    annualSalary != null && annualSalary > 0
      ? `You will draw a consolidated salary of Rs. ${annualSalary.toLocaleString("en-IN")}/- per annum, as approved by the Management. In addition, you are eligible for D.A., H.R.A. and other allowances as per the rules of the Institution.`
      : "You will draw a Basic Pay of Rs. ______ in the scale of pay ______. In addition, you are eligible for D.A., H.R.A. and other allowances of Rs. ______.";
  return [
    "The appointment is subject to verification of your original certificates of qualification and experience. You have to deposit the original certificates with the Principal at the time of joining.",
    "The appointment is on regular basis and you have to face an interview of the Regular Staff Selection Committee of the affiliating University, to which the College is affiliated, for the purpose of regularization of the appointment.",
    "You will be on probation for a period of two years.",
    payClause,
    "You will be entitled for salary increase and/or revised D.A., if any, only after the satisfactory completion of the probationary period.",
    "Your job responsibilities are as per the rules framed by AICTE / Management from time to time.",
    "You will abide by the Staff service, conduct, leave and T.A. Rules as adopted by the Governing Body and amended from time to time.",
    "You have to sign a contract that you would work in our organization for at least three years after the satisfactory completion of the probation period.",
    "You are not permitted to undertake any tuition or coaching or any other assignment including part time or work in an advisory capacity, or be interested even indirectly in any other business, during your employment. You are also prohibited from taking part in politics.",
    "Your services are transferable to any Institution under our Management.",
    "You are expected to maintain utmost secrecy with regard to the affairs of the Institution and shall not divulge any information prejudicial to the interests of the Institution.",
    "The judgment of the Management in respect of your efficiency and performance in teaching and other duties shall be absolute and the decision of the Management shall be binding on you.",
    "In the event of your leaving or resigning from the services of the Institute, or your services are terminated by the Institution, termination will be effected by issuing one month's notice or payment of one month's gross salary in lieu of such notice on either side. Staff members are not permitted to leave during the course of a semester. However, if you give notice intimating your intention to leave, the Institute may at its option relieve you at any time thereafter, even before the expiry of such notice, without any obligation or liability on the Institute.",
    "In the event of a University/UGC/AICTE/NBA/NAAC inspection, you will be relieved of your duties only after the completion of the inspection process, under any circumstances.",
    `You are requested to report to duty to the Principal of the Institute at the following: PRINCIPAL, ${principalAddress}${collegePhone ? ` — Ph: ${collegePhone}` : ""}.`,
    "The above terms and conditions are based on the Management's policies, procedures and other rules and regulations currently applicable and are subject to amendment from time to time.",
    "This appointment is made based on the proficiency in technical/professional skills you have declared in your application. If, at a later date, any of your statements or particulars furnished are found to be false or misleading, you shall be considered to have committed a breach of contract and the Institute shall have the right to terminate your services forthwith.",
    "This letter is issued in duplicate; you have to return one copy after signing, acknowledging receipt of this letter and confirming strict adherence to the above terms and conditions.",
  ].join("\n");
}
