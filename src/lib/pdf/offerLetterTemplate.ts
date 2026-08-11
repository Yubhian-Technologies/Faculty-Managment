export interface OfferLetterData {
  candidateName: string;
  candidateAddress?: string;
  designation: string;
  department: string;
  collegeName: string;
  collegeAddress?: string;
  interviewDate?: string;
  joiningDate: string;
  letterDate: string;
  termsAndConditions?: string;
}

export function getOfferLetterHTML({
  candidateName,
  candidateAddress,
  designation,
  department,
  collegeName,
  collegeAddress,
  interviewDate,
  joiningDate,
  letterDate,
  termsAndConditions,
}: OfferLetterData): string {
  const collegeFull = collegeAddress ? `${collegeName}, ${collegeAddress}` : collegeName;
  const interviewClause = interviewDate
    ? `With reference to your application and discussion during the interview held on ${interviewDate}, we`
    : "With reference to your application and discussion during the interview, we";

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  body { font-family: "Times New Roman", serif; margin: 0; padding: 0; color: #000; }
  .page { width: 210mm; min-height: 297mm; padding: 20mm 25mm; box-sizing: border-box; }
  .date { text-align: right; margin-bottom: 24px; font-size: 14px; }
  p { font-size: 14px; line-height: 1.8; margin: 12px 0; }
  .signature { margin-top: 32px; }
  .to-block { margin-top: 40px; }
  .copies { margin-top: 32px; font-size: 14px; }
</style>
</head>
<body>
<div class="page">
  <p class="date">Dt. ${letterDate}</p>

  <p>Dear Sir/Madam,</p>

  <p>
    ${interviewClause} are pleased to appoint you as <strong>${designation}</strong> in the department of <strong>${department}</strong> of ${collegeFull} on the terms and conditions you have agreed during the interview.
  </p>

  <p>Appointment letter will be issued at the time of reporting to duty.</p>

  ${
    termsAndConditions?.trim()
      ? `<p>Your appointment is subject to the following terms and conditions:</p>
  <ol style="font-size:14px;line-height:1.8;">
    ${termsAndConditions.trim().split("\n").map((line) => line.trim()).filter(Boolean).map((line) => `<li>${line}</li>`).join("")}
  </ol>`
      : ""
  }

  <p>You are requested to join on or before <strong>${joiningDate}</strong>.</p>

  <p>You need to submit all your original certificates at the time of joining our Organization.</p>

  <p>You are welcome to our organization and wish you will have a good career with us.</p>

  <p>You are requested to acknowledge the receipt of this offer letter and intimate the proposed date of joining.</p>

  <div class="signature">
    <p>Yours faithfully,</p>
    <p style="margin-top:40px;">For ${collegeName}</p>
  </div>

  <div class="to-block">
    <p style="margin:0;">To</p>
    <p style="margin:0;">${candidateName},</p>
    ${candidateAddress ? candidateAddress.split(",").map((line) => `<p style="margin:0;">${line.trim()}</p>`).join("") : ""}
  </div>

  <div class="copies">
    <p>Copies to:&nbsp;&nbsp;1) The Principal, ${collegeName}</p>
    <p style="margin-left:24px;">2) Accounts &amp; Finance Department, ${collegeName}</p>
  </div>
</div>
</body>
</html>`;
}

export interface AppointmentLetterData {
  candidateName: string;
  candidateAddress?: string;
  designation: string;
  department: string;
  collegeName: string;
  collegeAddress?: string;
  joiningDate: string;
  letterDate: string;
  ctcAnnual?: number;
  termsAndConditions?: string;
}

export function getAppointmentLetterHTML({
  candidateName,
  candidateAddress,
  designation,
  department,
  collegeName,
  collegeAddress,
  joiningDate,
  letterDate,
  ctcAnnual,
  termsAndConditions,
}: AppointmentLetterData): string {
  const collegeFull = collegeAddress ? `${collegeName}, ${collegeAddress}` : collegeName;

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  body { font-family: "Times New Roman", serif; margin: 0; padding: 0; color: #000; }
  .page { width: 210mm; min-height: 297mm; padding: 20mm 25mm; box-sizing: border-box; }
  .date { margin-bottom: 24px; font-size: 14px; }
  .to-block { margin-bottom: 24px; }
  .to-block p { margin: 0; font-size: 14px; line-height: 1.6; }
  .title { text-align: center; font-size: 16px; font-weight: bold; text-decoration: underline; margin: 24px 0; letter-spacing: 1px; }
  p { font-size: 14px; line-height: 1.8; margin: 12px 0; }
  ol { font-size: 14px; line-height: 1.8; padding-left: 20px; }
  ol li { margin-bottom: 8px; }
  .signature { margin-top: 40px; }
</style>
</head>
<body>
<div class="page">
  <p class="date">Dt. ${letterDate}</p>

  <div class="to-block">
    <p>To</p>
    <p>${candidateName},</p>
    ${candidateAddress ? candidateAddress.split(",").map((line) => `<p>${line.trim()}</p>`).join("") : ""}
  </div>

  <div class="title">APPOINTMENT ORDER</div>

  <p>
    With reference to your application and the personal interview, you are appointed as <strong>${designation}</strong> in the Department of <strong>${department}</strong>, ${collegeFull}.
  </p>

  ${ctcAnnual != null && ctcAnnual > 0 ? `<p>Your consolidated CTC is <strong>Rs. ${ctcAnnual.toLocaleString("en-IN")}/- per annum</strong>, with the date of joining on or before <strong>${joiningDate}</strong>.</p>` : ""}

  ${
    termsAndConditions?.trim()
      ? `<p>The appointment is subject to the following Terms and Conditions.</p>
  <ol>
    ${termsAndConditions.trim().split("\n").map((line) => line.trim()).filter(Boolean).map((line) => `<li>${line}</li>`).join("")}
  </ol>`
      : ""
  }

  <p>You are requested to report to duty on or before <strong>${joiningDate}</strong>.</p>

  <p>We welcome you to our institution and wish you a prosperous career with us.</p>

  <div class="signature">
    <p>PRINCIPAL</p>
    <p>${collegeName}</p>
  </div>
</div>
</body>
</html>`;
}
