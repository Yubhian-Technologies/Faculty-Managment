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

export function getAppointmentLetterHTML({
  candidateName,
  designation,
  department,
  joiningDate,
  collegeName,
  collegeAddress,
  letterDate,
}: {
  candidateName: string;
  designation: string;
  department: string;
  joiningDate: string;
  collegeName: string;
  collegeAddress?: string;
  letterDate: string;
}): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  body { font-family: "Times New Roman", serif; margin: 0; padding: 0; }
  .page { width: 210mm; min-height: 297mm; padding: 20mm 25mm; box-sizing: border-box; }
  .header { text-align: center; border-bottom: 3px double #1d4ed8; padding-bottom: 16px; margin-bottom: 24px; }
  .college-name { font-size: 24px; font-weight: bold; color: #1d4ed8; margin: 0; }
  .title { text-align: center; font-size: 16px; font-weight: bold; text-decoration: underline; margin: 24px 0; letter-spacing: 1px; }
  p { font-size: 14px; line-height: 1.8; margin: 12px 0; }
  .signature { margin-top: 48px; display: flex; justify-content: flex-end; }
  .sig-block { text-align: center; }
  .sig-line { width: 150px; border-top: 1px solid #000; margin: 48px auto 8px; }
</style>
</head>
<body>
<div class="page">
  <div class="header">
    <p class="college-name">${collegeName}</p>
    ${collegeAddress ? `<p style="font-size:12px;color:#555;margin:4px 0 0">${collegeAddress}</p>` : ""}
  </div>

  <div class="title">APPOINTMENT LETTER</div>

  <p>Date: ${letterDate}</p>
  <p>To,<br><strong>${candidateName}</strong></p>

  <p>Dear ${candidateName},</p>

  <p>
    With reference to your interview held recently, we are pleased to appoint you as <strong>${designation}</strong> in the Department of <strong>${department}</strong> at ${collegeName} with effect from <strong>${joiningDate}</strong>.
  </p>

  <p>Your appointment is subject to the following conditions:</p>
  <ol style="font-size:14px;line-height:1.8;">
    <li>This appointment is on a probationary basis initially for a period of one year.</li>
    <li>Your service is liable to be terminated without any notice during the probationary period if your performance is not found satisfactory.</li>
    <li>You will be governed by the service rules and regulations of the institution as amended from time to time.</li>
    <li>You shall not take up any other employment, business, or assignment without the prior written permission of the management.</li>
  </ol>

  <p>
    Please report to the HR department on <strong>${joiningDate}</strong> with all original documents for verification.
  </p>

  <p>We welcome you to our institution and wish you a successful career here.</p>

  <div class="signature">
    <div class="sig-block">
      <div class="sig-line"></div>
      <p style="margin:0;"><strong>Principal</strong></p>
      <p style="margin:4px 0 0;font-size:12px;color:#555;">${collegeName}</p>
    </div>
  </div>
</div>
</body>
</html>`;
}
