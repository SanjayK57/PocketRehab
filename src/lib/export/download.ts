/** Triggers a local file download. Nothing is uploaded anywhere. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the browser a moment to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function downloadText(text: string, filename: string, type: string): void {
  downloadBlob(new Blob([text], { type }), filename);
}

export function downloadJson(value: unknown, filename: string): void {
  downloadText(JSON.stringify(value, null, 2), filename, 'application/json');
}

/** Reads a user-chosen file as JSON. Throws a readable error for invalid files. */
export async function readJsonFile(file: File): Promise<unknown> {
  if (file.size > 20 * 1024 * 1024) throw new Error('That file is too large to be a PocketRehab file.');
  const text = await file.text();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error('That file is not valid JSON.');
  }
}

export function fileStamp(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}
