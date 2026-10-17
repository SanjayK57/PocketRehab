import type { ReportData } from './reportData';
import { formatDate } from '@/lib/time/dates';

/**
 * Renders a report to a PDF entirely in the browser (jsPDF). The file is
 * downloaded locally; nothing is uploaded. Text uses the standard PDF
 * Helvetica font, so only Latin-1 characters are used in report strings.
 */

const INK: [number, number, number] = [29, 31, 34];
const MUTED: [number, number, number] = [95, 99, 104];
const ACCENT: [number, number, number] = [10, 110, 145];
const RULE: [number, number, number] = [214, 210, 200];

/** Replaces characters outside WinAnsi so jsPDF's built-in font renders them. */
export function pdfSafe(s: string): string {
  const replaced = s
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\u2192/g, '->')
    .replace(/\u2264/g, '<=')
    .replace(/\u2265/g, '>=');
  const allowed = (c: number) => c === 9 || c === 10 || c === 13 || (c >= 32 && c <= 126) || (c >= 160 && c <= 255) || c === 0x2013 || c === 0x2014 || c === 0x2022;
  return Array.from(replaced)
    .filter((ch) => allowed(ch.codePointAt(0) ?? 0))
    .join('');
}

export async function renderReportPdf(r: ReportData): Promise<Blob> {
  const [{ jsPDF }, { autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 48;
  let y = M;

  const ensure = (needed: number) => {
    if (y + needed > H - M) {
      doc.addPage();
      y = M;
    }
  };
  const lastY = () => (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y;

  const heading = (text: string) => {
    ensure(40);
    y += 10;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(...INK);
    doc.text(pdfSafe(text), M, y);
    y += 6;
    doc.setDrawColor(...RULE);
    doc.setLineWidth(0.75);
    doc.line(M, y, W - M, y);
    y += 14;
  };
  const para = (text: string, size = 10, color: [number, number, number] = INK) => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(size);
    doc.setTextColor(...color);
    const lines = doc.splitTextToSize(pdfSafe(text), W - 2 * M) as string[];
    for (const line of lines) {
      ensure(size + 4);
      doc.text(line, M, y);
      y += size + 4;
    }
  };
  const table = (head: string[], body: Array<Array<string | number>>) => {
    autoTable(doc, {
      startY: y,
      head: [head.map(pdfSafe)],
      body: body.map((row) => row.map((c) => pdfSafe(String(c)))),
      margin: { left: M, right: M },
      styles: { font: 'helvetica', fontSize: 8.5, cellPadding: 4, textColor: INK, lineColor: RULE, lineWidth: 0.5 },
      headStyles: { fillColor: [240, 237, 230], textColor: INK, fontStyle: 'bold' },
      theme: 'grid',
    });
    y = lastY() + 12;
  };

  // Title block
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.setTextColor(...INK);
  doc.text('PocketRehab progress report', M, y + 6);
  y += 26;
  para(`${r.name} - ${formatDate(r.from, { month: 'long', day: 'numeric', year: 'numeric' })} to ${formatDate(r.to, { month: 'long', day: 'numeric', year: 'numeric' })}`, 11, MUTED);
  para(`Generated ${new Date(r.generatedAt).toLocaleString()} from data stored on the user's device.`, 9, MUTED);
  if (r.isDemo) para('DEMO PROFILE: this report contains simulated sample data, not a real person\'s history.', 10, [160, 40, 90]);
  y += 4;
  doc.setFillColor(246, 244, 239);
  const disclaimerLines = doc.splitTextToSize(pdfSafe(r.disclaimer), W - 2 * M - 20) as string[];
  const boxH = disclaimerLines.length * 12 + 16;
  ensure(boxH + 8);
  doc.rect(M, y, W - 2 * M, boxH, 'F');
  doc.setFontSize(9);
  doc.setTextColor(...INK);
  disclaimerLines.forEach((line, i) => doc.text(line, M + 10, y + 16 + i * 12));
  y += boxH + 10;

  heading('Plan');
  if (r.plan) {
    para(`${r.plan.kind === 'demonstration' ? 'Demonstration plan (not a clinical prescription)' : 'Plan entered by the user from clinician instructions'} - version ${r.plan.version} - status: ${r.plan.status}`);
    para(`Approved by (as entered by the user): ${r.plan.authorizedBy || 'not recorded'}${r.plan.authorizationDate ? `, ${r.plan.authorizationDate}` : ''}`, 10, MUTED);
    if (r.plan.restrictions) para(`Recorded restrictions: ${r.plan.restrictions}`, 10, MUTED);
    if (r.exercises.length) table(['Exercise', 'Side', 'Prescribed', 'Target', 'Camera'], r.exercises.map((e) => [e.name, e.side, e.prescription, e.target, e.camera ? 'yes' : 'no']));
  } else {
    para('No plan recorded.', 10, MUTED);
  }

  heading('Adherence');
  const a = r.adherence;
  para(
    a.percent === null
      ? 'No scheduled sessions were due in this period, so adherence is not calculated.'
      : `${a.completed} of ${a.eligible} due sessions completed (${a.percent}%). Partially completed: ${a.partial}. Missed: ${a.missed}. Skipped: ${a.skipped}. Marked unavailable (excluded): ${a.unavailable}.`,
  );
  para('Adherence counts days on the user\'s schedule. Simulated demo sessions never count.', 9, MUTED);

  heading('Movement measurements (camera estimates)');
  if (r.measurements.length === 0) para('No reliable camera measurements in this period.', 10, MUTED);
  for (const m of r.measurements) {
    para(`${m.name}: ${m.sessions} reliable session${m.sessions === 1 ? '' : 's'}. First: ${m.first}. Latest: ${m.latest}.`);
    para(m.interpretation, 9, MUTED);
    if (m.stable) para(m.stable, 9, MUTED);
    y += 4;
  }

  if (r.sessions.length) {
    heading('Sessions');
    table(['Date', 'Exercise', 'Side', 'Mode', 'Status', 'Reps', 'Reliable', 'Peak', 'Range', 'Rep time', 'Tracking'], r.sessions.map((s) => [s.date, s.exercise, s.side, s.mode, s.status, s.reps, s.validReps ?? '-', s.peak, s.range, s.duration, s.quality]));
  }

  if (r.comparisons && r.comparisons.length) {
    heading('First vs latest comparison');
    for (const c of r.comparisons) {
      para(`${c.name}: ${c.a} vs ${c.b}${c.comparable ? '' : ' (NOT directly comparable)'}`);
      table(['Measure', c.a, c.b, 'Difference'], c.rows.map((row) => [row.label, fmtCell(row.a, row.unit), fmtCell(row.b, row.unit), row.diff === null ? '-' : `${row.diff > 0 ? '+' : ''}${row.diff}${row.unit ? ` ${row.unit}` : ''}`]));
      c.warnings.forEach((w) => para(`- ${w}`, 8.5, MUTED));
      y += 4;
    }
  }

  if (r.symptoms) {
    heading('Self-reported check-ins');
    if (r.symptoms.length === 0) para('No check-ins recorded in this period.', 10, MUTED);
    else table(['Date', 'When', 'Discomfort', 'Fatigue', 'Difficulty', 'Change', 'Flag'], r.symptoms.map((s) => [s.date, s.kind, s.pain, s.fatigue, s.difficulty, s.change, s.outcome]));
    para('Scores are self-reported (0-10) and are not objective measurements.', 9, MUTED);
  }

  if (r.quality) {
    heading('Measurement quality');
    para(`Camera sessions: ${r.quality.camera}. With enough reliable tracking: ${r.quality.reliable}. Not reliable enough to use: ${r.quality.uncertain}. Repetitions excluded for uncertain tracking: ${r.quality.excludedReps}.`);
    if (r.quality.commonIssues.length) para(`Most common tracking issues: ${r.quality.commonIssues.join(', ')}.`, 10, MUTED);
  }

  if (r.notes && r.notes.length) {
    heading('User notes');
    r.notes.forEach((n) => para(`- "${n}"`));
  }

  heading('Missing information and limitations');
  [...r.missing, ...r.limitations].forEach((l) => para(`- ${l}`, 9.5));

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text(`PocketRehab - not a medical diagnosis - page ${i} of ${pages}`, M, H - 24);
    doc.setTextColor(...ACCENT);
  }
  return doc.output('blob');
}

function fmtCell(v: number | null, unit: string): string {
  return v === null ? 'not available' : `${v}${unit ? ` ${unit}` : ''}`;
}
