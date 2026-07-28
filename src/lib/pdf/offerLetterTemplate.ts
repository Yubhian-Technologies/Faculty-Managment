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

export interface AppointmentLetterData {
  candidateName: string;
  candidateAddress?: string;
  designation: string;
  department: string;
  collegeName: string;
  collegeAddress?: string;
  letterDate: string;
  basicPay?: string;
  payScale?: string;
  daPercent?: string;
  hraPercent?: string;
  otherAllowances?: string;
  affiliatedUniversity?: string;
  reportingAddress?: string;
  collegePhone?: string;
  societyAbbr?: string;
  societyHqCity?: string;
}

export function getAppointmentLetterHTML({
  candidateName,
  candidateAddress,
  designation,
  department,
  collegeName,
  collegeAddress,
  letterDate,
  basicPay,
  payScale,
  daPercent = "80",
  hraPercent = "10",
  otherAllowances,
  affiliatedUniversity = "J.N.T. University, Kakinada",
  reportingAddress,
  collegePhone,
  societyAbbr = "SVES",
  societyHqCity = "Hyderabad",
}: AppointmentLetterData): string {
  const addrLines = (candidateAddress ?? "")
    .split("\n")
    .filter(Boolean)
    .map((l) => `<p style="margin:2px 0;">${l}</p>`)
    .join("");

  const salaryClause = basicPay
    ? `You will draw a Basic Pay of Rs.${basicPay}/- in the scale of pay ${payScale ?? ""}${payScale ? " " : ""}In addition, you are eligible for D.A. (${daPercent}%) and H.R.A. (${hraPercent}%)${otherAllowances ? ` and others Rs. ${otherAllowances}/-` : ""}.`
    : `Your salary and allowances will be as per the rules of the institution and as agreed during the interview.`;

  const collegeNameUpper = collegeName.toUpperCase();
  const reportAddr = reportingAddress ?? (collegeAddress ?? "");

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  body { font-family: "Times New Roman", serif; margin: 0; padding: 0; color: #000; font-size: 13.5px; }
  .page { width: 210mm; min-height: 297mm; padding: 18mm 28mm 18mm 28mm; box-sizing: border-box; }
  p { line-height: 1.7; margin: 7px 0; }
  .heading { text-align: center; font-weight: bold; text-decoration: underline; font-size: 15px; margin: 18px 0 14px; letter-spacing: 0.5px; }
  .term { margin: 9px 0; padding-left: 0; display: flex; gap: 8px; }
  .term-num { min-width: 24px; font-weight: normal; }
  .page-break { page-break-after: always; }
  .page2-header { text-align: center; font-size: 13px; margin-bottom: 12px; }
  .copies p { margin: 3px 0; }
</style>
</head>
<body>

<!-- PAGE 1 -->
<div class="page">
  <p style="text-align:right;">Dt.${letterDate}</p>

  <p style="margin-top:14px;">To</p>
  <p><strong>${candidateName},</strong></p>
  ${addrLines}

  <p class="heading">APPOINTMENT ORDER</p>

  <p>With reference to your application and the personal interview, you are appointed as <strong>${designation}</strong> in the Department of <strong>${department}</strong>, ${collegeName}${collegeAddress ? `, ${collegeAddress}` : ""}.</p>

  <p>The appointment is subject to the following Terms and Conditions.</p>

  <div class="term"><span class="term-num">1.</span><span>The appointment is subject to verification of your original certificates of qualification and experience. You have to deposit the original certificates with the Principal at the time of joining.</span></div>

  <div class="term"><span class="term-num">2.</span><span>The appointment is on regular basis and you have to face an interview of Regular Staff Selection Committee of the ${affiliatedUniversity}, to which the College is affiliated for the purpose of regularization of the appointment.</span></div>

  <div class="term"><span class="term-num">3.</span><span>You will be on probation for a period of two years.</span></div>

  <div class="term"><span class="term-num">4.</span><span>${salaryClause}</span></div>

  <div class="term"><span class="term-num">5.</span><span>You will be entitled for salary increase and (or) revised D.A. if any, only after the satisfactory completion of probationary period.</span></div>

  <div class="term"><span class="term-num">6.</span><span>Your job responsibilities are as per the rules framed by AICTE / Management from time to time.</span></div>

  <div class="term"><span class="term-num">7.</span><span>You will abide by the Staff service, conduct, leave and T.A. Rules as adopted by the Governing Body and amended from time to time.</span></div>

  <div class="term"><span class="term-num">8.</span><span>You have to sign a contract that you would work in our organization for at least three years after the satisfactory completion of probation period.</span></div>

  <div class="term"><span class="term-num">9.</span><span>You are not permitted to undertake any tuition or coaching or any other assignment including part time or work on advisory capacity or be interested even indirectly in any other business during your employment. You are also prohibited from taking part in politics.</span></div>

  <div class="term"><span class="term-num">10.</span><span>Your services are transferable to any Institution, under our Management, located in Hyderabad and Bhimavaram.</span></div>

  <div class="term"><span class="term-num">11.</span><span>You are expected to maintain utmost secrecy with regard to the affairs of the Institution and shall not divulge any information prejudicial to the interests of the Institution.</span></div>

  <div class="term"><span class="term-num">12.</span><span>The judgment of the Management in respect of your efficiency and performance in teaching and other duties shall be absolute and the decision of the Management shall be binding on you.</span></div>

  <p style="text-align:right; margin-top:16px;">Contd…Page 2</p>
</div>

<!-- PAGE 2 -->
<div class="page">
  <p class="page2-header">//2//</p>

  <div class="term"><span class="term-num">13.</span><span>In the event of your leaving or resigning from the services of the Institute or your services are terminated by the Institution, termination will be effected by issuing one month's notice or payment of one month's gross salary in lieu of such notice on either side. Staff members are not permitted to leave during the course of semester.<br><br>However, if you give any notice intimating your intention to leave the service, the Institute may as its option relieve you from service at any time thereafter and even before the expiry of such notice period given by you without any obligations or liability on the Institute.</span></div>

  <div class="term"><span class="term-num">14.</span><span>In the event of University/UGC/AICTE/NBA/NAAC inspection etc. The faculty will be relieved of from duties only after the completion of inspection process under any circumstances.</span></div>

  <div class="term"><span class="term-num">15.</span><span>You are requested to report to duty to the Principal of the Institute at the following:<br><br>
  <strong>PRINCIPAL</strong><br>
  <strong>${collegeNameUpper}</strong><br>
  ${reportAddr}${collegePhone ? `<br>Ph: ${collegePhone}` : ""}</span></div>

  <div class="term"><span class="term-num">16.</span><span>The above terms and conditions are based on Society policies, procedures and other rules and regulations currently applicable and are subject to amendments from time to time.</span></div>

  <div class="term"><span class="term-num">17.</span><span>This offer is made based on your proficiency on Technical / Professional skills you have declared in the application. In case, at a later date, any of your statements / particulars furnished are found to be false or misleading you shall be considered to have committed breach of contract and the Institute shall have the right to terminate your services forthwith.</span></div>

  <div class="term"><span class="term-num">18.</span><span>This letter is issued in duplicate and you have to return one copy after signing acknowledging the receipt of this letter and confirming strict adherence to the above terms and conditions.</span></div>

  <p style="margin-top:18px;">We welcome you to our institution and wish that you will have a prosperous career with us.</p>

  <div style="margin-top:40px;">
    <p style="margin:0;"><strong>PRINCIPAL</strong></p>
    <p style="margin:4px 0 0;"><strong>${collegeNameUpper}</strong></p>
  </div>

  <div class="copies" style="margin-top:28px;">
    <p>Copies to:&nbsp;&nbsp;&nbsp;1) The Chairman, ${societyAbbr}, ${societyHqCity}</p>
    <p style="margin-left:78px;">2) The Vice-Chairman, ${societyAbbr}, ${societyHqCity}</p>
    <p style="margin-left:78px;">3) The Secretary, ${societyAbbr}, ${societyHqCity}</p>
    <p style="margin-left:78px;">4) AGM (Finance and Accounts.), ${societyAbbr}, Bhimavaram</p>
  </div>
</div>

</body>
</html>`;
}
