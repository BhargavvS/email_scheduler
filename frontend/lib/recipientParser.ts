import Papa from 'papaparse';

export interface ParsedLeads {
  valid: string[];
  invalid: number;
  duplicatesRemoved: number;
  total: number;
  missingEmailColumn: boolean;
}

export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EMAIL_HEADERS = new Set(['email', 'email_address', 'email address', 'e-mail', 'mail']);

const MAX_FILE_BYTES = 10 * 1024 * 1024;

export interface FileReadResult {
  fileName: string;
  kind: 'csv' | 'txt';
  text: string | null;
  error: string | null;
}

export async function readLeadFile(file: File): Promise<FileReadResult> {
  const fileName = file.name;
  const kind = fileName.toLowerCase().endsWith('.csv') ? 'csv' : 'txt';

  if (file.size > MAX_FILE_BYTES) {
    return {
      fileName,
      kind,
      text: null,
      error: 'File is larger than 10 MB. Please upload a smaller file.',
    };
  }

  const text = await file.text();
  if (!text.trim()) {
    return { fileName, kind, text: null, error: 'The uploaded file is empty.' };
  }

  return { fileName, kind, text, error: null };
}

/**
 * Parse a CSV or plain-text lead list. CSV may have a header with an
 * email-ish column (email, Email, email_address, ...). Text files are split
 * on newlines/commas/semicolons. Emails are trimmed, lowercased, validated,
 * and deduped.
 */
export function parseLeadText(text: string, kind: 'csv' | 'txt'): ParsedLeads {
  if (kind === 'csv') return parseCsv(text);
  return normalizeEmails(text.split(/[\r\n,;]+/));
}

function parseCsv(text: string): ParsedLeads {
  const trimmed = text.trim();
  const result = Papa.parse<string[]>(trimmed, { skipEmptyLines: 'greedy' });
  const rows = result.data as unknown as string[][];
  if (rows.length === 0) return emptyResult();

  const headerRow = rows[0].map((c) => (c ?? '').trim().toLowerCase());
  const emailCol = headerRow.findIndex((h) => EMAIL_HEADERS.has(h));

  // Multi-column CSV without an email column -> explicit user-facing error.
  if (headerRow.length > 1 && emailCol < 0) {
    return {
      valid: [],
      invalid: 0,
      duplicatesRemoved: 0,
      total: rows.length - 1,
      missingEmailColumn: true,
    };
  }

  // Header row with a recognizable email column -> read that column.
  if (emailCol >= 0) {
    return normalizeEmails(rows.slice(1).map((r) => r[emailCol] ?? ''));
  }

  // Otherwise treat every cell as an email.
  return normalizeEmails(rows.flat());
}

function emptyResult(): ParsedLeads {
  return { valid: [], invalid: 0, duplicatesRemoved: 0, total: 0, missingEmailColumn: false };
}

export function normalizeEmails(input: string[]): ParsedLeads {
  const seen = new Set<string>();
  const valid: string[] = [];
  let invalid = 0;
  let nonEmpty = 0;

  for (const entry of input) {
    const email = (entry ?? '').trim().toLowerCase();
    if (!email) continue;
    nonEmpty += 1;
    if (!EMAIL_REGEX.test(email)) {
      invalid += 1;
      continue;
    }
    if (seen.has(email)) continue;
    seen.add(email);
    valid.push(email);
  }

  return {
    valid,
    invalid,
    duplicatesRemoved: nonEmpty - invalid - valid.length,
    total: input.length,
    missingEmailColumn: false,
  };
}