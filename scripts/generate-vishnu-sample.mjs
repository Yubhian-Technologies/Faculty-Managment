import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const docsDir = path.join(rootDir, "docs");

// Read original XLS (which is HTML)
const originalXlsPath = "c:\\Users\\gurun\\Downloads\\download (2).xls";
let originalHtml = "";
if (fs.existsSync(originalXlsPath)) {
  originalHtml = fs.readFileSync(originalXlsPath, "utf8");
  fs.copyFileSync(originalXlsPath, path.join(docsDir, "SAMPLE_VISHNU_TIMETABLE.xls"));
}

// Create clean, pixel-perfect printable HTML matching the screenshot
const cleanPrintHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>TIME TABLE - VISHNU INSTITUTE OF TECHNOLOGY</title>
  <style>
    @page {
      size: A4 portrait;
      margin: 8mm 10mm 8mm 10mm;
    }
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    body {
      font-family: Arial, Helvetica, sans-serif;
      color: #000000;
      background: #ffffff;
      font-size: 11px;
      line-height: 1.25;
      padding: 12px 10px;
    }
    .reportMainHeading {
      font-size: 13.5px;
      font-weight: bold;
      color: #000;
      letter-spacing: 0.3px;
    }
    .reportHeading1 {
      font-size: 11px;
      font-weight: bold;
      color: #000;
    }
    .cellBorder {
      border: 1px solid #000000;
      padding: 4px 2px;
      text-align: center;
      vertical-align: middle;
      font-size: 10px;
    }
    th.cellBorder {
      font-weight: bold;
      font-size: 9.5px;
      line-height: 1.25;
      background-color: #ffffff;
    }
    table {
      border-collapse: collapse;
      margin: 0 auto;
      width: 100%;
    }
    .timetable-grid td {
      height: 31px;
      font-weight: 500;
      font-size: 9.5px;
    }
    .break-cell {
      background-color: #ffffff;
    }
    .allocation-table td {
      padding: 3.5px 6px;
      font-size: 10.5px;
    }
    .allocation-table th {
      padding: 5px 6px;
      font-weight: bold;
      font-size: 10.5px;
      background-color: #ffffff;
    }
    .page-footer {
      margin-top: 15px;
      display: flex;
      justify-content: space-between;
      font-size: 8.5px;
      color: #333333;
    }
  </style>
</head>
<body>

  <!-- Header Section with Logo and College Info -->
  <table style="width: 100%; margin-bottom: 6px;" cellspacing="0" cellpadding="2">
    <tbody>
      <tr>
        <td style="width: 115px; vertical-align: middle; text-align: center;">
          <!-- High-res Vishnu Universal Learning Logo -->
          <svg width="100" height="95" viewBox="0 0 120 110" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M25 20 L55 80 L70 50 L45 20 Z" fill="#E65100"/>
            <path d="M45 20 L70 50 L95 20 L70 20 Z" fill="#2E7D32"/>
            <path d="M55 80 L70 50 L85 80 Z" fill="#1565C0"/>
            <text x="60" y="96" font-family="Arial, sans-serif" font-size="10" font-weight="900" text-anchor="middle" fill="#222">VISHNU</text>
            <text x="60" y="105" font-family="Arial, sans-serif" font-size="6.5" font-weight="700" letter-spacing="0.5" text-anchor="middle" fill="#666">UNIVERSAL LEARNING</text>
          </svg>
        </td>
        <td style="vertical-align: middle; text-align: center;">
          <table width="100%" cellspacing="0" cellpadding="1">
            <tbody>
              <tr><td class="reportMainHeading" align="center">VISHNU INSTITUTE OF TECHNOLOGY  ( Code: PA  )</td></tr>
              <tr><td class="reportHeading1" align="center">Approved By AICTE., Affiliated to JNTUK, KAKINADA</td></tr>
              <tr><td class="reportHeading1" align="center">VISHNUPUR,BHIMAVARAM</td></tr>
              <tr><td class="reportHeading1" align="center">Tel : 08816251333</td></tr>
              <tr><td style="height: 6px;"></td></tr>
              <tr><td class="reportHeading1" align="center" style="font-size: 13px; letter-spacing: 1px;">TIME TABLE</td></tr>
            </tbody>
          </table>
        </td>
      </tr>
    </tbody>
  </table>

  <!-- Main Timetable Grid -->
  <table class="timetable-grid" width="100%" cellpadding="2" cellspacing="0">
    <thead>
      <tr style="background-color: #ffffff;">
        <th style="width:7.5%" class="cellBorder">Day of<br>week</th>
        <th style="width:9.5%" class="cellBorder">Period 1<br>09:00 AM<br>09:50 AM</th>
        <th style="width:9.5%" class="cellBorder">Period 2<br>09:50 AM<br>10:40 AM</th>
        <th style="width:7.5%" class="cellBorder">10:40 AM<br>11:00 AM</th>
        <th style="width:9.5%" class="cellBorder">Period 3<br>11:00 AM<br>11:50 AM</th>
        <th style="width:9.5%" class="cellBorder">Period 4<br>11:50 AM<br>12:40 PM</th>
        <th style="width:8.5%" class="cellBorder">12:40 PM<br>01:40 PM</th>
        <th style="width:9.5%" class="cellBorder">Period 5<br>01:40 PM<br>02:30 PM</th>
        <th style="width:9.5%" class="cellBorder">Period 6<br>02:30 PM<br>03:20 PM</th>
        <th style="width:9.5%" class="cellBorder">Period 7<br>03:20 PM<br>04:10 PM</th>
        <th style="width:10%" class="cellBorder">Period 8<br>04:10 PM<br>05:00 PM</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td class="cellBorder">Mon</td>
        <td class="cellBorder">DWDM</td>
        <td class="cellBorder">FLAT</td>
        <td class="cellBorder break-cell">&nbsp;</td>
        <td class="cellBorder">CN</td>
        <td class="cellBorder">O.E-ED&amp;VC</td>
        <td class="cellBorder break-cell">&nbsp;</td>
        <td class="cellBorder">FLUTTERLAB</td>
        <td class="cellBorder">FLUTTERLAB</td>
        <td class="cellBorder">FLUTTERLAB</td>
        <td class="cellBorder">CRT</td>
      </tr>
      <tr>
        <td class="cellBorder">Tue</td>
        <td class="cellBorder">FLAT</td>
        <td class="cellBorder">FSD  II</td>
        <td class="cellBorder break-cell">&nbsp;</td>
        <td class="cellBorder">FSD  II</td>
        <td class="cellBorder">FSD  II</td>
        <td class="cellBorder break-cell">&nbsp;</td>
        <td class="cellBorder">FLAT</td>
        <td class="cellBorder">FSD  II</td>
        <td class="cellBorder">O.E-ED&amp;VC</td>
        <td class="cellBorder">CRT</td>
      </tr>
      <tr>
        <td class="cellBorder">Wed</td>
        <td class="cellBorder">P.E - I</td>
        <td class="cellBorder">P.E - I</td>
        <td class="cellBorder break-cell">&nbsp;</td>
        <td class="cellBorder">DWDM</td>
        <td class="cellBorder">FLAT</td>
        <td class="cellBorder break-cell">&nbsp;</td>
        <td class="cellBorder">O.E-ED&amp;VC</td>
        <td class="cellBorder">CN</td>
        <td class="cellBorder">Seminar</td>
        <td class="cellBorder">CRT</td>
      </tr>
      <tr>
        <td class="cellBorder">Thu</td>
        <td class="cellBorder">CN</td>
        <td class="cellBorder">DM LAB</td>
        <td class="cellBorder break-cell">&nbsp;</td>
        <td class="cellBorder">DM LAB</td>
        <td class="cellBorder">DM LAB</td>
        <td class="cellBorder break-cell">&nbsp;</td>
        <td class="cellBorder">FLAT</td>
        <td class="cellBorder">O.E-ED&amp;VC</td>
        <td class="cellBorder">DWDM</td>
        <td class="cellBorder">CRT</td>
      </tr>
      <tr>
        <td class="cellBorder">Fri</td>
        <td class="cellBorder">DWDM</td>
        <td class="cellBorder">CN LAB</td>
        <td class="cellBorder break-cell">&nbsp;</td>
        <td class="cellBorder">CN LAB</td>
        <td class="cellBorder">CN LAB</td>
        <td class="cellBorder break-cell">&nbsp;</td>
        <td class="cellBorder">CN</td>
        <td class="cellBorder">FLAT</td>
        <td class="cellBorder">CRT</td>
        <td class="cellBorder">CRT</td>
      </tr>
      <tr>
        <td class="cellBorder">Sat</td>
        <td class="cellBorder">O.E-ED&amp;VC</td>
        <td class="cellBorder">DWDM</td>
        <td class="cellBorder break-cell">&nbsp;</td>
        <td class="cellBorder">CN</td>
        <td class="cellBorder">DWDM</td>
        <td class="cellBorder break-cell">&nbsp;</td>
        <td class="cellBorder">P.E - I</td>
        <td class="cellBorder">P.E - I</td>
        <td class="cellBorder">CN</td>
        <td class="cellBorder">--</td>
      </tr>
    </tbody>
  </table>

  <!-- Allocation of Subjects Title -->
  <div align="center" class="reportMainHeading" style="margin: 14px 0 6px 0; font-size: 13px;">Allocation of Subjects</div>

  <!-- Allocation of Subjects Table -->
  <table class="allocation-table" width="100%" cellspacing="0" cellpadding="2">
    <thead>
      <tr style="background-color: #ffffff;">
        <th align="left" style="width:14%" class="cellBorder">Subject Code</th>
        <th align="left" style="width:36%" class="cellBorder">Subject</th>
        <th align="left" style="width:36%" class="cellBorder">Name of Faculty</th>
        <th align="left" style="width:14%" class="cellBorder">Faculty Initials</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td align="left" class="cellBorder">DWDM</td>
        <td align="left" class="cellBorder">Data Warehousing And Data Mining</td>
        <td align="left" class="cellBorder">MRS. R. HEMALATHA</td>
        <td align="left" class="cellBorder">&nbsp;</td>
      </tr>
      <tr>
        <td align="left" class="cellBorder">CN</td>
        <td align="left" class="cellBorder">Computer Networks</td>
        <td align="left" class="cellBorder">MR. S. MAHABOOB HUSSAIN</td>
        <td align="left" class="cellBorder">&nbsp;</td>
      </tr>
      <tr>
        <td align="left" class="cellBorder">FLAT</td>
        <td align="left" class="cellBorder">Formal Languages And Automata Theory</td>
        <td align="left" class="cellBorder">MR. D. JOHN SUBUDDHI</td>
        <td align="left" class="cellBorder">&nbsp;</td>
      </tr>
      <tr>
        <td align="left" class="cellBorder">P.E - I</td>
        <td align="left" class="cellBorder">Professional Elective - I</td>
        <td align="left" class="cellBorder">MR. B. CH S N L S SAI BABA</td>
        <td align="left" class="cellBorder">&nbsp;</td>
      </tr>
      <tr>
        <td align="left" class="cellBorder">O.E-ED&amp;VC</td>
        <td align="left" class="cellBorder">Open Elective - ED &amp; VC</td>
        <td align="left" class="cellBorder">MRS. B. PREETHI</td>
        <td align="left" class="cellBorder">&nbsp;</td>
      </tr>
      <tr>
        <td align="left" class="cellBorder">DM LAB</td>
        <td align="left" class="cellBorder">Data Mining Lab</td>
        <td align="left" class="cellBorder">MRS. R. HEMALATHA</td>
        <td align="left" class="cellBorder">&nbsp;</td>
      </tr>
      <tr>
        <td align="left" class="cellBorder">CN LAB</td>
        <td align="left" class="cellBorder">Computer Networks Lab</td>
        <td align="left" class="cellBorder">MR. S. MAHABOOB HUSSAIN</td>
        <td align="left" class="cellBorder">&nbsp;</td>
      </tr>
      <tr>
        <td align="left" class="cellBorder">FLUTTERLAB</td>
        <td align="left" class="cellBorder">User Interface Design Using Flutter</td>
        <td align="left" class="cellBorder">MRS. P. SHYAMALA MADHURI</td>
        <td align="left" class="cellBorder">&nbsp;</td>
      </tr>
      <tr>
        <td align="left" class="cellBorder">FSD  II</td>
        <td align="left" class="cellBorder">Full Stack Development  II</td>
        <td align="left" class="cellBorder">DR. J. S. S. JANARDHANA NAIDU</td>
        <td align="left" class="cellBorder">&nbsp;</td>
      </tr>
      <tr>
        <td align="left" class="cellBorder">CRT</td>
        <td align="left" class="cellBorder">Campus Recruitment Training</td>
        <td align="left" class="cellBorder">MRS. P. SHYAMALA MADHURI</td>
        <td align="left" class="cellBorder">&nbsp;</td>
      </tr>
      <tr>
        <td align="left" class="cellBorder">Seminar</td>
        <td align="left" class="cellBorder">Seminar</td>
        <td align="left" class="cellBorder">MRS. P. SHYAMALA MADHURI</td>
        <td align="left" class="cellBorder">&nbsp;</td>
      </tr>
    </tbody>
  </table>

  <!-- Institutional Page Footer -->
  <div class="page-footer">
    <span>https://vishnu.ac.in/printreport.aspx</span>
    <span>1/1</span>
  </div>

</body>
</html>
`;

async function main() {
  fs.writeFileSync(path.join(docsDir, "SAMPLE_VISHNU_TIMETABLE.html"), cleanPrintHtml);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setContent(cleanPrintHtml, { waitUntil: "networkidle" });
  await page.pdf({
    path: path.join(docsDir, "SAMPLE_VISHNU_TIMETABLE.pdf"),
    format: "A4",
    landscape: false,
    printBackground: true,
    margin: { top: "8mm", bottom: "8mm", left: "10mm", right: "10mm" },
  });
  await page.screenshot({
    path: path.join(docsDir, "SAMPLE_VISHNU_TIMETABLE.png"),
    fullPage: true,
  });
  await browser.close();
  console.log("Successfully generated SAMPLE_VISHNU_TIMETABLE files in docs!");
}

main().catch(console.error);
