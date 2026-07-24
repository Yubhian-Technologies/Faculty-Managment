export function interviewInvitationEmail({
  candidateName,
  position,
  department,
  interviewDate,
  venue,
  documents,
  collegeName,
  contactEmail,
}: {
  candidateName: string;
  position: string;
  department: string;
  interviewDate: string;
  venue: string;
  documents: string[];
  collegeName: string;
  contactEmail: string;
}): string {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:Arial,sans-serif;background:#f8fafc;margin:0;padding:20px;">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
    <div style="background:#1d4ed8;padding:32px 24px;text-align:center;">
      <h1 style="color:#fff;margin:0;font-size:22px;">${collegeName}</h1>
      <p style="color:#bfdbfe;margin:8px 0 0;">Interview Invitation</p>
    </div>
    <div style="padding:32px 24px;">
      <p style="color:#0f172a;font-size:16px;">Dear <strong>${candidateName}</strong>,</p>
      <p style="color:#475569;">We are pleased to invite you for an interview for the position of <strong>${position}</strong> in the <strong>${department}</strong> department.</p>
      <div style="background:#f1f5f9;border-radius:8px;padding:20px;margin:24px 0;">
        <h3 style="color:#0f172a;margin:0 0 12px;font-size:15px;">Interview Details</h3>
        <table style="width:100%;border-collapse:collapse;">
          <tr><td style="padding:6px 0;color:#64748b;font-size:14px;width:130px;">Date &amp; Time</td><td style="padding:6px 0;color:#0f172a;font-size:14px;font-weight:600;">${interviewDate}</td></tr>
          <tr><td style="padding:6px 0;color:#64748b;font-size:14px;">Venue</td><td style="padding:6px 0;color:#0f172a;font-size:14px;font-weight:600;">${venue}</td></tr>
          <tr><td style="padding:6px 0;color:#64748b;font-size:14px;">Position</td><td style="padding:6px 0;color:#0f172a;font-size:14px;font-weight:600;">${position}</td></tr>
        </table>
      </div>
      ${
        documents.length > 0
          ? `<h3 style="color:#0f172a;font-size:15px;margin-bottom:12px;">Documents to Carry</h3>
        <ul style="color:#475569;padding-left:20px;margin:0;">
          ${documents.map((d) => `<li style="margin-bottom:6px;font-size:14px;">${d}</li>`).join("")}
        </ul>`
          : ""
      }
      <p style="color:#475569;margin-top:24px;font-size:14px;">Please arrive 15 minutes before your scheduled time. For any queries, contact us at <a href="mailto:${contactEmail}" style="color:#1d4ed8;">${contactEmail}</a></p>
      <p style="color:#475569;font-size:14px;">We look forward to meeting you!</p>
      <p style="color:#0f172a;font-weight:600;margin-bottom:0;">HR Department<br>${collegeName}</p>
    </div>
    <div style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:16px 24px;text-align:center;">
      <p style="color:#94a3b8;font-size:12px;margin:0;">This is an automated email. Please do not reply to this email.</p>
    </div>
  </div>
</body>
</html>`;
}

export function offerLetterEmail({
  candidateName,
  position,
  department,
  joiningDate,
  collegeName,
}: {
  candidateName: string;
  position: string;
  department: string;
  joiningDate: string;
  collegeName: string;
}): string {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;background:#f8fafc;margin:0;padding:20px;">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
    <div style="background:#059669;padding:32px 24px;text-align:center;">
      <h1 style="color:#fff;margin:0;font-size:22px;">${collegeName}</h1>
      <p style="color:#a7f3d0;margin:8px 0 0;">Offer of Employment</p>
    </div>
    <div style="padding:32px 24px;">
      <p style="color:#0f172a;font-size:16px;">Dear <strong>${candidateName}</strong>,</p>
      <p style="color:#475569;">We are delighted to offer you the position of <strong>${position}</strong> in the <strong>${department}</strong> department. Please find your offer letter attached.</p>
      <p style="color:#475569;font-size:14px;">Please confirm your acceptance by reporting on <strong>${joiningDate}</strong>. Bring all original documents on your joining date.</p>
      <p style="color:#0f172a;font-weight:600;">Congratulations and welcome to the team!<br><br>HR Department<br>${collegeName}</p>
    </div>
  </div>
</body>
</html>`;
}
