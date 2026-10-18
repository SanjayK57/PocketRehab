import { MEASUREMENT_KINDS, measurementSchema, type Measurement, type MeasurementKind } from '@/lib/validation/schemas';
import { newId } from '@/lib/storage/repositories';
import { EXERCISES } from '@/features/exercises/library';

/**
 * Turns a spreadsheet export (CSV) or a JSON file into measurement records,
 * row by row, so the user sees exactly what will be imported and what was
 * skipped and why before anything is saved. Only known columns are read; the
 * file's own keys are never merged into objects.
 */

export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 5000;

export interface ImportProblem {
  /** 1-based line in the CSV (header = 1) or 1-based item in a JSON list. */
  line: number;
  error: string;
}

export interface ImportPreview {
  format: 'csv' | 'json';
  valid: Measurement[];
  problems: ImportProblem[];
}

type Cells = Record<string, string | number | null | undefined>;

const COLUMNS: Record<keyof ParsedFields, string[]> = {
  date: ['date', 'when', 'day', 'timestamp', 'measured', 'measured on', 'date measured'],
  label: ['measure', 'measurement', 'label', 'what', 'name', 'test', 'movement'],
  value: ['value', 'reading', 'result', 'score', 'degrees', 'angle'],
  unit: ['unit', 'units'],
  kind: ['kind', 'type', 'category'],
  side: ['side'],
  source: ['source', 'measured by', 'by', 'device', 'tool'],
  note: ['note', 'notes', 'comment', 'comments'],
  exercise: ['exercise', 'exercise id'],
};

interface ParsedFields {
  date: string;
  label: string;
  value: string;
  unit: string;
  kind: string;
  side: string;
  source: string;
  note: string;
  exercise: string;
}

const KIND_WORDS: Array<[RegExp, MeasurementKind]> = [
  [/^(angle|rom|range|range of motion|degrees?|deg|°|goniometer)$/, 'angle'],
  [/^(pain|pain score|nrs|vas|\/10)$/, 'pain'],
  [/^(reps?|repetitions?|count)$/, 'reps'],
  [/^(hold|time|seconds?|secs?|s|duration)$/, 'hold'],
  [/^other$/, 'other'],
];

function kindFrom(word: string): MeasurementKind | null {
  const w = word.trim().toLowerCase();
  if (!w) return null;
  for (const [re, kind] of KIND_WORDS) if (re.test(w)) return kind;
  return null;
}

/** Date-only values become midday local time, so they stay on the same calendar day across time zones. */
export function parseWhen(text: string, now: number): number | null {
  const t = text.trim();
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?/.exec(t);
  // US clinics write month/day/year; that is what this format means here (stated in the import help).
  const us = iso ? null : /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  const parts = iso ? [iso[1], iso[2], iso[3], iso[4] ?? '12', iso[5] ?? '0'] : us ? [us[3], us[1], us[2], '12', '0'] : null;
  if (!parts) return null;
  const [y, mo, day, h, min] = parts.map(Number) as [number, number, number, number, number];
  const d = new Date(y, mo - 1, day, h, min);
  // new Date rolls 2026-02-31 into March; reject instead of guessing.
  if (d.getFullYear() !== y || d.getMonth() + 1 !== mo || d.getDate() !== day || h > 23 || min > 59) return null;
  const ms = d.getTime();
  if (ms < Date.UTC(1990, 0, 1) || ms > now + 86_400_000) return null;
  return ms;
}

/** An exercise named by id or by its name in the library; anything else is left unlinked. */
export function matchExercise(text: string): string | null {
  const t = text.trim().toLowerCase();
  if (!t) return null;
  return Object.values(EXERCISES).find((e) => e.id === t || e.name.toLowerCase() === t)?.id ?? null;
}

/** One row → a validated measurement, or the reason it can't be used. */
export function toMeasurement(f: ParsedFields, fallbackSource: string, now: number): Measurement | string {
  const label = f.label.trim();
  if (!label) return 'No measurement name.';
  const when = parseWhen(f.date, now);
  if (when === null) return f.date.trim() ? `Date “${f.date.trim().slice(0, 20)}” isn’t a date PocketRehab reads (use 2026-10-18 or 10/18/2026).` : 'No date.';
  const num = /^\s*([-+]?\d+(?:[.,]\d+)?)\s*(.*)$/.exec(f.value);
  if (!num?.[1]) return f.value.trim() ? `Value “${f.value.trim().slice(0, 20)}” isn’t a number.` : 'No value.';
  const value = Number(num[1].replace(',', '.'));
  const trailing = (num[2] ?? '').trim();
  const unitText = f.unit.trim() || trailing;
  const kind = kindFrom(f.kind) ?? kindFrom(unitText) ?? (/pain/i.test(label) ? 'pain' : /\b(rom|flexion|extension|abduction|angle)\b/i.test(label) ? 'angle' : 'other');
  const side = /^(l|left)$/i.test(f.side.trim()) ? 'left' : /^(r|right)$/i.test(f.side.trim()) ? 'right' : null;
  const candidate = {
    id: newId('m'),
    timestamp: when,
    kind,
    label: label.slice(0, 80),
    value,
    unit: kind === 'other' ? unitText.slice(0, 12) : MEASUREMENT_KINDS[kind].unit,
    side,
    exerciseId: matchExercise(f.exercise),
    source: 'import' as const,
    sourceLabel: (f.source.trim() || fallbackSource).slice(0, 80),
    note: f.note.trim().slice(0, 500),
    createdAt: now,
  };
  const r = measurementSchema.safeParse(candidate);
  if (r.success) return r.data;
  const { min, max } = MEASUREMENT_KINDS[kind];
  return r.error.issues.some((i) => i.path[0] === 'value') ? `${value} is outside ${min} to ${max} for ${kind === 'pain' ? 'a pain score' : kind === 'angle' ? 'an angle' : `“${kind}”`}.` : 'This row isn’t a valid reading.';
}

/** RFC 4180-style: quoted fields, doubled quotes, CRLF; delimiter guessed from the header. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^\uFEFF/, '');
  const firstLine = src.slice(0, src.search(/\r?\n|$/));
  const delim = [',', ';', '\t'].map((d) => [d, firstLine.split(d).length] as const).sort((a, b) => b[1] - a[1])[0]?.[0] ?? ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"' && field === '') quoted = true;
    else if (c === delim) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function pick(cells: Cells): ParsedFields {
  const lower = new Map<string, string>();
  for (const k of Object.keys(cells)) {
    const v = cells[k];
    lower.set(k.trim().toLowerCase(), v === null || v === undefined ? '' : String(v));
  }
  const get = (names: string[]) => names.map((n) => lower.get(n)).find((v) => v !== undefined) ?? '';
  return {
    date: get(COLUMNS.date),
    label: get(COLUMNS.label),
    value: get(COLUMNS.value),
    unit: get(COLUMNS.unit),
    kind: get(COLUMNS.kind),
    side: get(COLUMNS.side),
    source: get(COLUMNS.source),
    note: get(COLUMNS.note),
    exercise: get(COLUMNS.exercise),
  };
}

const sameReading = (a: Measurement, b: Measurement) => a.timestamp === b.timestamp && a.label.toLowerCase() === b.label.toLowerCase() && a.value === b.value;

export function parseMeasurementFile(text: string, fileName: string, existing: Measurement[] = [], now = Date.now()): ImportPreview {
  const source = fileName.replace(/\.[^.]+$/, '').slice(0, 80) || 'Imported file';
  const trimmed = text.replace(/^\uFEFF/, '').trimStart();
  let format: ImportPreview['format'];
  let items: Array<{ line: number; cells: Cells | null }>;
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    format = 'json';
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return { format, valid: [], problems: [{ line: 0, error: 'This file isn’t valid JSON.' }] };
    }
    const list = Array.isArray(parsed) ? parsed : parsed && typeof parsed === 'object' && Array.isArray((parsed as { measurements?: unknown }).measurements) ? (parsed as { measurements: unknown[] }).measurements : null;
    if (!list) return { format, valid: [], problems: [{ line: 0, error: 'Expected a list of readings, or an object with a “measurements” list.' }] };
    items = list.map((v, i) => ({ line: i + 1, cells: v && typeof v === 'object' && !Array.isArray(v) ? (v as Cells) : null }));
  } else {
    format = 'csv';
    const rows = parseCsv(trimmed).filter((r) => r.some((c) => c.trim() !== ''));
    const header = rows[0]?.map((h) => h.trim().toLowerCase()) ?? [];
    if (!header.some((h) => COLUMNS.value.includes(h)) || !header.some((h) => COLUMNS.label.includes(h))) {
      return { format, valid: [], problems: [{ line: 1, error: 'The first row must name the columns, including “measure” and “value” (download the template to see the layout).' }] };
    }
    items = rows.slice(1).map((r, i) => ({ line: i + 2, cells: Object.fromEntries(header.map((h, j) => [h, r[j] ?? ''])) }));
  }
  const problems: ImportProblem[] = [];
  if (items.length > MAX_IMPORT_ROWS) {
    problems.push({ line: 0, error: `Only the first ${MAX_IMPORT_ROWS} readings are read.` });
    items = items.slice(0, MAX_IMPORT_ROWS);
  }
  const valid: Measurement[] = [];
  for (const { line, cells } of items) {
    if (!cells) {
      problems.push({ line, error: 'Not a reading.' });
      continue;
    }
    const m = toMeasurement(pick(cells), source, now);
    if (typeof m === 'string') problems.push({ line, error: m });
    else if (existing.some((e) => sameReading(e, m)) || valid.some((v) => sameReading(v, m))) problems.push({ line, error: 'Already in your measurements.' });
    else valid.push(m);
  }
  return { format, valid, problems };
}

export const CSV_TEMPLATE = ['date,measure,value,unit,side,source,note', '2026-10-01,Knee flexion,95,deg,right,Clinic goniometer,After warm-up', '2026-10-01,Pain at rest,3,/10,,,', '2026-10-08,Knee flexion,104,deg,right,Clinic goniometer,'].join('\n');
