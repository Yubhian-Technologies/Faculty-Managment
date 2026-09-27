import { chromium } from "@playwright/test";
import { writeFileSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const docsDir = resolve(__dirname, "../docs");
mkdirSync(docsDir, { recursive: true });

function getStudentTimetableHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Student Section Timetable - B.Tech II ECE-A</title>
  <style>
    @page {
      size: A4 landscape;
      margin: 10mm 12mm;
    }
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
      color: #000000;
      background: #ffffff;
      font-size: 11px;
      line-height: 1.3;
    }
    .container {
      width: 100%;
      max-width: 273mm;
      margin: 0 auto;
    }
    
    /* Institutional Header */
    .header-box {
      border: 2px solid #000;
      padding: 8px 12px;
      text-align: center;
      margin-bottom: 8px;
    }
    .inst-name {
      font-size: 16pt;
      font-weight: 900;
      letter-spacing: 0.5px;
      text-transform: uppercase;
      margin-bottom: 2px;
    }
    .inst-sub {
      font-size: 9pt;
      font-weight: 600;
      color: #333;
      margin-bottom: 4px;
    }
    .dept-name {
      font-size: 12pt;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.3px;
      border-top: 1px solid #000;
      border-bottom: 1px solid #000;
      padding: 3px 0;
      margin: 4px 0;
    }
    .academic-info {
      font-size: 10pt;
      font-weight: 700;
      display: flex;
      justify-content: space-between;
      padding-top: 2px;
    }

    /* Meta Info Bar */
    .meta-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 8px;
      border: 1.5px solid #000;
    }
    .meta-table td {
      border: 1px solid #000;
      padding: 4px 8px;
      font-size: 9pt;
    }
    .meta-label {
      font-weight: 800;
      text-transform: uppercase;
      font-size: 8pt;
    }
    .meta-value {
      font-weight: 700;
    }

    /* Timetable Matrix Grid (1:1 Box Ratio) */
    .grid-table {
      width: 100%;
      border-collapse: collapse;
      border: 2px solid #000;
      table-layout: fixed;
      margin-bottom: 8px;
    }
    .grid-table th, .grid-table td {
      border: 1px solid #000;
      text-align: center;
      vertical-align: middle;
    }
    .grid-table th {
      background: #f0f0f0;
      font-weight: 800;
      font-size: 9pt;
      padding: 5px 2px;
    }
    .time-slot {
      font-size: 7.5pt;
      font-weight: 600;
      margin-top: 2px;
      display: block;
    }
    .day-col {
      width: 9%;
      background: #f0f0f0;
      font-weight: 800;
      font-size: 9.5pt;
      text-transform: uppercase;
    }
    .period-col {
      width: 11.5%;
      height: 18.5mm; /* Balanced 1:1 box ratio with ~30mm cell width */
    }
    .break-col {
      width: 4.5%;
      background: #fafafa;
      font-weight: 800;
      font-size: 8pt;
      letter-spacing: 2px;
      writing-mode: vertical-rl;
      text-orientation: mixed;
      text-transform: uppercase;
      padding: 4px 0;
    }
    
    /* Cell Content */
    .cell-box {
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      height: 100%;
      padding: 2px 3px;
    }
    .subj-code {
      font-size: 9.5pt;
      font-weight: 900;
      letter-spacing: 0.3px;
      line-height: 1.15;
    }
    .fac-code {
      font-size: 8pt;
      font-weight: 700;
      margin-top: 2px;
    }
    .room-tag {
      font-size: 7.5pt;
      font-weight: 600;
      margin-top: 1px;
    }
    .lab-merged {
      background: #fdfdfd;
    }
    .free-cell {
      color: #777;
      font-weight: 700;
      font-size: 10pt;
    }

    /* Subject & Faculty Legend Table */
    .legend-box {
      border: 1.5px solid #000;
      margin-bottom: 12px;
    }
    .legend-title {
      background: #000;
      color: #fff;
      font-weight: 800;
      font-size: 8.5pt;
      padding: 3px 8px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .legend-table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
    }
    .legend-table th, .legend-table td {
      border: 1px solid #000;
      padding: 3px 6px;
      font-size: 8pt;
    }
    .legend-table th {
      background: #f0f0f0;
      font-weight: 800;
      text-align: left;
    }
    .legend-table td.center {
      text-align: center;
    }

    /* Signatures */
    .sig-section {
      display: flex;
      justify-content: space-between;
      margin-top: 24px;
      padding: 0 15px;
    }
    .sig-block {
      text-align: center;
      width: 28%;
    }
    .sig-line {
      border-top: 1.5px solid #000;
      margin-bottom: 4px;
    }
    .sig-title {
      font-size: 9pt;
      font-weight: 800;
      text-transform: uppercase;
    }
  </style>
</head>
<body>
  <div class="container">
    <!-- Header -->
    <div class="header-box">
      <div class="inst-name">Yubhian Engineering College</div>
      <div class="inst-sub">Approved by AICTE, Affiliated to State University · Accredited by NAAC</div>
      <div class="dept-name">Department of Electronics & Communication Engineering</div>
      <div class="academic-info">
        <span><strong>CLASS TIME TABLE</strong></span>
        <span>ACADEMIC YEAR: <strong>2026 – 2027</strong></span>
        <span>SEMESTER: <strong>I (ODD)</strong></span>
        <span>REGULATION: <strong>R23</strong></span>
      </div>
    </div>

    <!-- Meta Details -->
    <table class="meta-table">
      <tr>
        <td style="width: 25%;"><span class="meta-label">Class & Section:</span> <span class="meta-value">B.Tech II Year &ndash; ECE-A</span></td>
        <td style="width: 25%;"><span class="meta-label">Class Room:</span> <span class="meta-value">LH-204 (Block B)</span></td>
        <td style="width: 30%;"><span class="meta-label">Class Incharge:</span> <span class="meta-value">Mrs. Kavitha Bandaru</span></td>
        <td style="width: 20%;"><span class="meta-label">w.e.f:</span> <span class="meta-value">01-07-2026</span></td>
      </tr>
    </table>

    <!-- 1:1 Sized Master Timetable Grid -->
    <table class="grid-table">
      <thead>
        <tr>
          <th class="day-col">Day / Period</th>
          <th class="period-col">I<span class="time-slot">09:00 - 09:50</span></th>
          <th class="period-col">II<span class="time-slot">09:50 - 10:40</span></th>
          <th class="period-col">III<span class="time-slot">10:40 - 11:30</span></th>
          <th class="period-col">IV<span class="time-slot">11:30 - 12:20</span></th>
          <th class="break-col" rowspan="7">LUNCH BREAK (12:20 - 01:10)</th>
          <th class="period-col">V<span class="time-slot">01:10 - 02:00</span></th>
          <th class="period-col">VI<span class="time-slot">02:00 - 02:50</span></th>
          <th class="period-col">VII<span class="time-slot">02:50 - 03:40</span></th>
        </tr>
      </thead>
      <tbody>
        <!-- Monday -->
        <tr>
          <td class="day-col">MON</td>
          <td><div class="cell-box"><span class="subj-code">ADSA</span><span class="fac-code">[PKM]</span></div></td>
          <td><div class="cell-box"><span class="subj-code">SS</span><span class="fac-code">[AKV]</span></div></td>
          <td><div class="cell-box"><span class="subj-code">M-III</span><span class="fac-code">[SRR]</span></div></td>
          <td><div class="cell-box"><span class="subj-code">DSD</span><span class="fac-code">[MKT]</span></div></td>
          <td colspan="3" class="lab-merged">
            <div class="cell-box">
              <span class="subj-code">ADSA LAB (R23-063)</span>
              <span class="fac-code"><strong>Batch 1:</strong> PKM &nbsp;|&nbsp; <strong>Batch 2:</strong> KB</span>
              <span class="room-tag">Advanced Computing Lab</span>
            </div>
          </td>
        </tr>
        <!-- Tuesday -->
        <tr>
          <td class="day-col">TUE</td>
          <td><div class="cell-box"><span class="subj-code">DSD</span><span class="fac-code">[MKT]</span></div></td>
          <td><div class="cell-box"><span class="subj-code">AC</span><span class="fac-code">[KB]</span></div></td>
          <td><div class="cell-box"><span class="subj-code">ADSA</span><span class="fac-code">[PKM]</span></div></td>
          <td><div class="cell-box"><span class="subj-code">M-III</span><span class="fac-code">[SRR]</span></div></td>
          <td><div class="cell-box"><span class="subj-code">SS</span><span class="fac-code">[AKV]</span></div></td>
          <td><div class="cell-box"><span class="subj-code">AC</span><span class="fac-code">[KB]</span></div></td>
          <td><div class="cell-box"><span class="subj-code">LIBRARY</span><span class="fac-code">[KB]</span></div></td>
        </tr>
        <!-- Wednesday -->
        <tr>
          <td class="day-col">WED</td>
          <td colspan="3" class="lab-merged">
            <div class="cell-box">
              <span class="subj-code">ANALOG & DIGITAL COMMUNICATIONS LAB (R23-066)</span>
              <span class="fac-code"><strong>Batch 1:</strong> MKT &nbsp;|&nbsp; <strong>Batch 2:</strong> AKV</span>
              <span class="room-tag">Communications Lab - Room 102</span>
            </div>
          </td>
          <td><div class="cell-box"><span class="subj-code">SS</span><span class="fac-code">[AKV]</span></div></td>
          <td><div class="cell-box"><span class="subj-code">ADSA</span><span class="fac-code">[PKM]</span></div></td>
          <td><div class="cell-box"><span class="subj-code">AC</span><span class="fac-code">[KB]</span></div></td>
          <td><div class="cell-box"><span class="subj-code">M-III</span><span class="fac-code">[SRR]</span></div></td>
        </tr>
        <!-- Thursday -->
        <tr>
          <td class="day-col">THU</td>
          <td><div class="cell-box"><span class="subj-code">AC</span><span class="fac-code">[KB]</span></div></td>
          <td><div class="cell-box"><span class="subj-code">DSD</span><span class="fac-code">[MKT]</span></div></td>
          <td><div class="cell-box"><span class="subj-code">ADSA</span><span class="fac-code">[PKM]</span></div></td>
          <td><div class="cell-box"><span class="subj-code">SS</span><span class="fac-code">[AKV]</span></div></td>
          <td><div class="cell-box"><span class="subj-code">M-III (TUT)</span><span class="fac-code">[SRR]</span></div></td>
          <td><div class="cell-box"><span class="subj-code">DSD</span><span class="fac-code">[MKT]</span></div></td>
          <td><div class="cell-box"><span class="subj-code">COUNSELING</span><span class="fac-code">[PKM]</span></div></td>
        </tr>
        <!-- Friday -->
        <tr>
          <td class="day-col">FRI</td>
          <td><div class="cell-box"><span class="subj-code">M-III</span><span class="fac-code">[SRR]</span></div></td>
          <td><div class="cell-box"><span class="subj-code">SS</span><span class="fac-code">[AKV]</span></div></td>
          <td><div class="cell-box"><span class="subj-code">AC</span><span class="fac-code">[KB]</span></div></td>
          <td><div class="cell-box"><span class="subj-code">DSD</span><span class="fac-code">[MKT]</span></div></td>
          <td><div class="cell-box"><span class="subj-code">ADSA</span><span class="fac-code">[PKM]</span></div></td>
          <td><div class="cell-box"><span class="subj-code">SEMINAR</span><span class="fac-code">[MKT]</span></div></td>
          <td><div class="cell-box"><span class="subj-code">SPORTS</span><span class="fac-code">[PD]</span></div></td>
        </tr>
        <!-- Saturday -->
        <tr>
          <td class="day-col">SAT</td>
          <td><div class="cell-box"><span class="subj-code">DSD</span><span class="fac-code">[MKT]</span></div></td>
          <td><div class="cell-box"><span class="subj-code">ADSA (TUT)</span><span class="fac-code">[PKM]</span></div></td>
          <td><div class="cell-box"><span class="subj-code">SS (TUT)</span><span class="fac-code">[AKV]</span></div></td>
          <td><div class="cell-box"><span class="subj-code">AC (TUT)</span><span class="fac-code">[KB]</span></div></td>
          <td colspan="3"><div class="cell-box"><span class="subj-code">TECHNICAL CLUB / CODING ACTIVITY</span><span class="fac-code">[ALL FACULTY]</span></div></td>
        </tr>
      </tbody>
    </table>

    <!-- Subject & Faculty Allocation Legend -->
    <div class="legend-box">
      <div class="legend-title">Subject Allocation & Faculty Roster</div>
      <table class="legend-table">
        <thead>
          <tr>
            <th style="width: 5%;" class="center">S.No</th>
            <th style="width: 10%;">Sub Code</th>
            <th style="width: 40%;">Name of the Subject</th>
            <th style="width: 8%;" class="center">Short</th>
            <th style="width: 25%;">Name of the Faculty Member</th>
            <th style="width: 6%;" class="center">Code</th>
            <th style="width: 6%;" class="center">L-T-P-C</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td class="center">1</td>
            <td><strong>R23-062</strong></td>
            <td><strong>Advanced Data Structures & Algorithm Analysis</strong></td>
            <td class="center"><strong>ADSA</strong></td>
            <td>Mr. Praveen Kumar Marada</td>
            <td class="center"><strong>PKM</strong></td>
            <td class="center">3-0-0-3</td>
          </tr>
          <tr>
            <td class="center">2</td>
            <td><strong>R23-063</strong></td>
            <td><strong>Advanced Data Structures & Algorithm Analysis Lab</strong></td>
            <td class="center"><strong>ADSA LAB</strong></td>
            <td>Mr. Praveen Kumar Marada / Mrs. K. Bandaru</td>
            <td class="center"><strong>PKM/KB</strong></td>
            <td class="center">0-0-3-1.5</td>
          </tr>
          <tr>
            <td class="center">3</td>
            <td><strong>R23-066</strong></td>
            <td><strong>Analog and Digital Communications Lab</strong></td>
            <td class="center"><strong>ADC LAB</strong></td>
            <td>Mr. Mohan Krishna Tummala / Mr. A. K. Vempati</td>
            <td class="center"><strong>MKT/AKV</strong></td>
            <td class="center">0-0-3-1.5</td>
          </tr>
          <tr>
            <td class="center">4</td>
            <td><strong>EC201</strong></td>
            <td><strong>Signals and Systems</strong></td>
            <td class="center"><strong>SS</strong></td>
            <td>Mr. Anil Kumar Vempati</td>
            <td class="center"><strong>AKV</strong></td>
            <td class="center">3-1-0-3</td>
          </tr>
          <tr>
            <td class="center">5</td>
            <td><strong>EC202</strong></td>
            <td><strong>Analog Circuits</strong></td>
            <td class="center"><strong>AC</strong></td>
            <td>Mrs. Kavitha Bandaru</td>
            <td class="center"><strong>KB</strong></td>
            <td class="center">3-1-0-3</td>
          </tr>
          <tr>
            <td class="center">6</td>
            <td><strong>EC203</strong></td>
            <td><strong>Digital System Design</strong></td>
            <td class="center"><strong>DSD</strong></td>
            <td>Mr. Mohan Krishna Tummala</td>
            <td class="center"><strong>MKT</strong></td>
            <td class="center">3-0-0-3</td>
          </tr>
          <tr>
            <td class="center">7</td>
            <td><strong>BS201</strong></td>
            <td><strong>Mathematics - III</strong></td>
            <td class="center"><strong>M-III</strong></td>
            <td>Dr. S. Rama Rao</td>
            <td class="center"><strong>SRR</strong></td>
            <td class="center">3-1-0-3</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Signatures -->
    <div class="sig-section">
      <div class="sig-block">
        <div class="sig-line"></div>
        <div class="sig-title">Time Table Incharge</div>
      </div>
      <div class="sig-block">
        <div class="sig-line"></div>
        <div class="sig-title">Head of Department (HOD)</div>
      </div>
      <div class="sig-block">
        <div class="sig-line"></div>
        <div class="sig-title">Principal</div>
      </div>
    </div>
  </div>
</body>
</html>`;
}

function getFacultyTimetableHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Faculty Timetable - Mr. Praveen Kumar Marada [PKM]</title>
  <style>
    @page {
      size: A4 landscape;
      margin: 10mm 12mm;
    }
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
      color: #000000;
      background: #ffffff;
      font-size: 11px;
      line-height: 1.3;
    }
    .container {
      width: 100%;
      max-width: 273mm;
      margin: 0 auto;
    }
    
    /* Institutional Header */
    .header-box {
      border: 2px solid #000;
      padding: 8px 12px;
      text-align: center;
      margin-bottom: 8px;
    }
    .inst-name {
      font-size: 16pt;
      font-weight: 900;
      letter-spacing: 0.5px;
      text-transform: uppercase;
      margin-bottom: 2px;
    }
    .inst-sub {
      font-size: 9pt;
      font-weight: 600;
      color: #333;
      margin-bottom: 4px;
    }
    .dept-name {
      font-size: 12pt;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.3px;
      border-top: 1px solid #000;
      border-bottom: 1px solid #000;
      padding: 3px 0;
      margin: 4px 0;
    }
    .academic-info {
      font-size: 10pt;
      font-weight: 700;
      display: flex;
      justify-content: space-between;
      padding-top: 2px;
    }

    /* Meta Info Bar */
    .meta-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 8px;
      border: 1.5px solid #000;
    }
    .meta-table td {
      border: 1px solid #000;
      padding: 4px 8px;
      font-size: 9pt;
    }
    .meta-label {
      font-weight: 800;
      text-transform: uppercase;
      font-size: 8pt;
    }
    .meta-value {
      font-weight: 700;
    }

    /* Timetable Matrix Grid (1:1 Box Ratio) */
    .grid-table {
      width: 100%;
      border-collapse: collapse;
      border: 2px solid #000;
      table-layout: fixed;
      margin-bottom: 8px;
    }
    .grid-table th, .grid-table td {
      border: 1px solid #000;
      text-align: center;
      vertical-align: middle;
    }
    .grid-table th {
      background: #f0f0f0;
      font-weight: 800;
      font-size: 9pt;
      padding: 5px 2px;
    }
    .time-slot {
      font-size: 7.5pt;
      font-weight: 600;
      margin-top: 2px;
      display: block;
    }
    .day-col {
      width: 9%;
      background: #f0f0f0;
      font-weight: 800;
      font-size: 9.5pt;
      text-transform: uppercase;
    }
    .period-col {
      width: 11.5%;
      height: 18.5mm; /* Balanced 1:1 box ratio */
    }
    .break-col {
      width: 4.5%;
      background: #fafafa;
      font-weight: 800;
      font-size: 8pt;
      letter-spacing: 2px;
      writing-mode: vertical-rl;
      text-orientation: mixed;
      text-transform: uppercase;
      padding: 4px 0;
    }
    
    /* Cell Content */
    .cell-box {
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      height: 100%;
      padding: 2px 3px;
    }
    .class-tag {
      font-size: 9pt;
      font-weight: 900;
      letter-spacing: 0.3px;
      line-height: 1.15;
    }
    .subj-tag {
      font-size: 8.5pt;
      font-weight: 800;
      margin-top: 2px;
    }
    .room-tag {
      font-size: 7.5pt;
      font-weight: 600;
      margin-top: 1px;
    }
    .free-cell {
      color: #999;
      font-weight: 700;
      font-size: 10pt;
    }

    /* Workload Summary Table */
    .legend-box {
      border: 1.5px solid #000;
      margin-bottom: 12px;
    }
    .legend-title {
      background: #000;
      color: #fff;
      font-weight: 800;
      font-size: 8.5pt;
      padding: 3px 8px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .legend-table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
    }
    .legend-table th, .legend-table td {
      border: 1px solid #000;
      padding: 3px 6px;
      font-size: 8pt;
    }
    .legend-table th {
      background: #f0f0f0;
      font-weight: 800;
      text-align: left;
    }
    .legend-table td.center {
      text-align: center;
    }

    /* Signatures */
    .sig-section {
      display: flex;
      justify-content: space-between;
      margin-top: 24px;
      padding: 0 15px;
    }
    .sig-block {
      text-align: center;
      width: 28%;
    }
    .sig-line {
      border-top: 1.5px solid #000;
      margin-bottom: 4px;
    }
    .sig-title {
      font-size: 9pt;
      font-weight: 800;
      text-transform: uppercase;
    }
  </style>
</head>
<body>
  <div class="container">
    <!-- Header -->
    <div class="header-box">
      <div class="inst-name">Yubhian Engineering College</div>
      <div class="inst-sub">Approved by AICTE, Affiliated to State University · Accredited by NAAC</div>
      <div class="dept-name">Department of Electronics & Communication Engineering</div>
      <div class="academic-info">
        <span><strong>INDIVIDUAL FACULTY TIME TABLE</strong></span>
        <span>ACADEMIC YEAR: <strong>2026 – 2027</strong></span>
        <span>SEMESTER: <strong>I (ODD)</strong></span>
        <span>SHORT CODE: <strong>[PKM]</strong></span>
      </div>
    </div>

    <!-- Faculty Details -->
    <table class="meta-table">
      <tr>
        <td style="width: 32%;"><span class="meta-label">Faculty Name:</span> <span class="meta-value">Mr. Praveen Kumar Marada</span></td>
        <td style="width: 23%;"><span class="meta-label">Designation:</span> <span class="meta-value">Asst. Professor</span></td>
        <td style="width: 25%;"><span class="meta-label">Department:</span> <span class="meta-value">ECE</span></td>
        <td style="width: 20%;"><span class="meta-label">Total Load:</span> <span class="meta-value">17 Hours / Week</span></td>
      </tr>
    </table>

    <!-- 1:1 Sized Faculty Timetable Grid -->
    <table class="grid-table">
      <thead>
        <tr>
          <th class="day-col">Day / Period</th>
          <th class="period-col">I<span class="time-slot">09:00 - 09:50</span></th>
          <th class="period-col">II<span class="time-slot">09:50 - 10:40</span></th>
          <th class="period-col">III<span class="time-slot">10:40 - 11:30</span></th>
          <th class="period-col">IV<span class="time-slot">11:30 - 12:20</span></th>
          <th class="break-col" rowspan="7">LUNCH BREAK (12:20 - 01:10)</th>
          <th class="period-col">V<span class="time-slot">01:10 - 02:00</span></th>
          <th class="period-col">VI<span class="time-slot">02:00 - 02:50</span></th>
          <th class="period-col">VII<span class="time-slot">02:50 - 03:40</span></th>
        </tr>
      </thead>
      <tbody>
        <!-- Monday -->
        <tr>
          <td class="day-col">MON</td>
          <td><div class="cell-box"><span class="class-tag">B.TECH II ECE-A</span><span class="subj-tag">ADSA</span><span class="room-tag">LH-204</span></div></td>
          <td><span class="free-cell">&mdash;</span></td>
          <td><div class="cell-box"><span class="class-tag">B.TECH III CSE-B</span><span class="subj-tag">CD (CS602)</span><span class="room-tag">LH-301</span></div></td>
          <td><span class="free-cell">&mdash;</span></td>
          <td colspan="3">
            <div class="cell-box">
              <span class="class-tag">B.TECH II ECE-A</span>
              <span class="subj-tag">ADSA LAB (R23-063) &ndash; Batch 1</span>
              <span class="room-tag">Computing Lab 1</span>
            </div>
          </td>
        </tr>
        <!-- Tuesday -->
        <tr>
          <td class="day-col">TUE</td>
          <td><span class="free-cell">&mdash;</span></td>
          <td><div class="cell-box"><span class="class-tag">B.TECH III CSE-B</span><span class="subj-tag">CD (CS602)</span><span class="room-tag">LH-301</span></div></td>
          <td><div class="cell-box"><span class="class-tag">B.TECH II ECE-A</span><span class="subj-tag">ADSA</span><span class="room-tag">LH-204</span></div></td>
          <td><span class="free-cell">&mdash;</span></td>
          <td><span class="free-cell">&mdash;</span></td>
          <td><div class="cell-box"><span class="class-tag">B.TECH III CSE-A</span><span class="subj-tag">COMPILER LAB</span><span class="room-tag">Lab 3</span></div></td>
          <td><div class="cell-box"><span class="class-tag">B.TECH III CSE-A</span><span class="subj-tag">COMPILER LAB</span><span class="room-tag">Lab 3</span></div></td>
        </tr>
        <!-- Wednesday -->
        <tr>
          <td class="day-col">WED</td>
          <td><span class="free-cell">&mdash;</span></td>
          <td><span class="free-cell">&mdash;</span></td>
          <td><div class="cell-box"><span class="class-tag">B.TECH III CSE-B</span><span class="subj-tag">CD (CS602)</span><span class="room-tag">LH-301</span></div></td>
          <td><span class="free-cell">&mdash;</span></td>
          <td><div class="cell-box"><span class="class-tag">B.TECH II ECE-A</span><span class="subj-tag">ADSA</span><span class="room-tag">LH-204</span></div></td>
          <td><span class="free-cell">&mdash;</span></td>
          <td><span class="free-cell">&mdash;</span></td>
        </tr>
        <!-- Thursday -->
        <tr>
          <td class="day-col">THU</td>
          <td><span class="free-cell">&mdash;</span></td>
          <td><span class="free-cell">&mdash;</span></td>
          <td><div class="cell-box"><span class="class-tag">B.TECH II ECE-A</span><span class="subj-tag">ADSA</span><span class="room-tag">LH-204</span></div></td>
          <td><div class="cell-box"><span class="class-tag">B.TECH III CSE-B</span><span class="subj-tag">CD (CS602)</span><span class="room-tag">LH-301</span></div></td>
          <td><span class="free-cell">&mdash;</span></td>
          <td><span class="free-cell">&mdash;</span></td>
          <td><div class="cell-box"><span class="class-tag">B.TECH II ECE-A</span><span class="subj-tag">COUNSELING</span><span class="room-tag">Dept</span></div></td>
        </tr>
        <!-- Friday -->
        <tr>
          <td class="day-col">FRI</td>
          <td><span class="free-cell">&mdash;</span></td>
          <td><div class="cell-box"><span class="class-tag">B.TECH III CSE-B</span><span class="subj-tag">CD (CS602)</span><span class="room-tag">LH-301</span></div></td>
          <td><span class="free-cell">&mdash;</span></td>
          <td><span class="free-cell">&mdash;</span></td>
          <td><div class="cell-box"><span class="class-tag">B.TECH II ECE-A</span><span class="subj-tag">ADSA</span><span class="room-tag">LH-204</span></div></td>
          <td><span class="free-cell">&mdash;</span></td>
          <td><span class="free-cell">&mdash;</span></td>
        </tr>
        <!-- Saturday -->
        <tr>
          <td class="day-col">SAT</td>
          <td><span class="free-cell">&mdash;</span></td>
          <td><div class="cell-box"><span class="class-tag">B.TECH II ECE-A</span><span class="subj-tag">ADSA (TUT)</span><span class="room-tag">LH-204</span></div></td>
          <td><span class="free-cell">&mdash;</span></td>
          <td><span class="free-cell">&mdash;</span></td>
          <td colspan="3"><div class="cell-box"><span class="class-tag">DEPARTMENT</span><span class="subj-tag">CODING CLUB & RESEARCH</span><span class="room-tag">Lab 1</span></div></td>
        </tr>
      </tbody>
    </table>

    <!-- Faculty Workload Details -->
    <div class="legend-box">
      <div class="legend-title">Teaching Workload & Subject Details</div>
      <table class="legend-table">
        <thead>
          <tr>
            <th style="width: 5%;" class="center">S.No</th>
            <th style="width: 12%;">Course & Section</th>
            <th style="width: 10%;">Sub Code</th>
            <th style="width: 35%;">Subject Name</th>
            <th style="width: 8%;" class="center">Short Code</th>
            <th style="width: 10%;" class="center">Type</th>
            <th style="width: 10%;" class="center">Hours / Week</th>
            <th style="width: 10%;" class="center">Room / Lab</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td class="center">1</td>
            <td><strong>B.Tech II ECE-A</strong></td>
            <td><strong>R23-062</strong></td>
            <td><strong>Advanced Data Structures & Algorithm Analysis</strong></td>
            <td class="center"><strong>ADSA</strong></td>
            <td class="center">Theory</td>
            <td class="center">5</td>
            <td class="center">LH-204</td>
          </tr>
          <tr>
            <td class="center">2</td>
            <td><strong>B.Tech II ECE-A</strong></td>
            <td><strong>R23-063</strong></td>
            <td><strong>ADSA Lab (Batch 1)</strong></td>
            <td class="center"><strong>ADSA LAB</strong></td>
            <td class="center">Practical</td>
            <td class="center">3</td>
            <td class="center">Comp Lab 1</td>
          </tr>
          <tr>
            <td class="center">3</td>
            <td><strong>B.Tech III CSE-B</strong></td>
            <td><strong>CS602</strong></td>
            <td><strong>Compiler Design</strong></td>
            <td class="center"><strong>CD</strong></td>
            <td class="center">Theory</td>
            <td class="center">5</td>
            <td class="center">LH-301</td>
          </tr>
          <tr>
            <td class="center">4</td>
            <td><strong>B.Tech III CSE-A</strong></td>
            <td><strong>CS606</strong></td>
            <td><strong>Compiler Design Lab</strong></td>
            <td class="center"><strong>CD LAB</strong></td>
            <td class="center">Practical</td>
            <td class="center">2</td>
            <td class="center">Lab 3</td>
          </tr>
          <tr>
            <td class="center">5</td>
            <td><strong>B.Tech II ECE-A</strong></td>
            <td><strong>MENTOR</strong></td>
            <td><strong>Student Counseling & Mentoring</strong></td>
            <td class="center"><strong>COUNS</strong></td>
            <td class="center">Mentoring</td>
            <td class="center">2</td>
            <td class="center">Dept Room</td>
          </tr>
          <tr style="background: #f9f9f9; font-weight: 800;">
            <td colspan="6" style="text-align: right; padding-right: 12px;">TOTAL TEACHING WORKLOAD:</td>
            <td class="center"><strong>17 Hours</strong></td>
            <td></td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Signatures -->
    <div class="sig-section">
      <div class="sig-block">
        <div class="sig-line"></div>
        <div class="sig-title">Faculty Member (PKM)</div>
      </div>
      <div class="sig-block">
        <div class="sig-line"></div>
        <div class="sig-title">Time Table Incharge</div>
      </div>
      <div class="sig-block">
        <div class="sig-line"></div>
        <div class="sig-title">Head of Department (HOD)</div>
      </div>
    </div>
  </div>
</body>
</html>`;
}

async function run() {
  console.log("Launching headless browser...");
  const browser = await chromium.launch();
  const page = await browser.newPage();

  // 1. Generate Student Timetable HTML & PDF
  const studentHtml = getStudentTimetableHtml();
  const studentHtmlPath = resolve(docsDir, "SAMPLE_STUDENT_TIMETABLE.html");
  const studentPdfPath = resolve(docsDir, "SAMPLE_STUDENT_TIMETABLE.pdf");
  writeFileSync(studentHtmlPath, studentHtml, "utf8");

  await page.setContent(studentHtml, { waitUntil: "networkidle" });
  await page.pdf({
    path: studentPdfPath,
    format: "A4",
    landscape: true,
    printBackground: true,
    margin: { top: "8mm", right: "10mm", bottom: "8mm", left: "10mm" },
  });
  console.log(`Generated: ${studentPdfPath}`);

  // 2. Generate Faculty Timetable HTML & PDF
  const facultyHtml = getFacultyTimetableHtml();
  const facultyHtmlPath = resolve(docsDir, "SAMPLE_FACULTY_TIMETABLE.html");
  const facultyPdfPath = resolve(docsDir, "SAMPLE_FACULTY_TIMETABLE.pdf");
  writeFileSync(facultyHtmlPath, facultyHtml, "utf8");

  await page.setContent(facultyHtml, { waitUntil: "networkidle" });
  await page.pdf({
    path: facultyPdfPath,
    format: "A4",
    landscape: true,
    printBackground: true,
    margin: { top: "8mm", right: "10mm", bottom: "8mm", left: "10mm" },
  });
  console.log(`Generated: ${facultyPdfPath}`);

  await browser.close();
  console.log("All sample PDFs successfully generated in docs/!");
}

run().catch((err) => {
  console.error("Error generating PDFs:", err);
  process.exit(1);
});
