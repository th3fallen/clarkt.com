#!/usr/bin/env node
/**
 * Merge a LinkedIn data export into src/data/resume.json.
 *
 * LinkedIn has no API that exposes your own work history — Sign In with
 * LinkedIn (OIDC) returns name, picture, email and nothing else. The only
 * sanctioned way to get positions out is the data export you request from
 * Settings → Data privacy → Get a copy of your data.
 *
 * Usage:
 *   node scripts/linkedin-import.mjs <export.zip | export-dir/> [--dry-run]
 *
 * The merge is deliberately conservative. LinkedIn is treated as the source of
 * truth for *which jobs exist and when*, and this file is the source of truth
 * for *how they read*. So we add new roles and correct dates, but never
 * overwrite a summary or highlights you have already edited by hand.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const RESUME_PATH = join(ROOT, 'src/data/resume.json');

const MONTHS = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

/* -------------------------------------------------------------------------- */
/* CSV                                                                         */
/* -------------------------------------------------------------------------- */

/**
 * RFC 4180 parser. LinkedIn wraps job descriptions in quotes and leaves the
 * newlines in, so a split-on-comma approach corrupts the file silently.
 */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  const source = text.replace(/^﻿/, '').replace(/\r\n/g, '\n');

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];

    if (inQuotes) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }

  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const [header, ...body] = rows.filter((entry) => entry.some((cell) => cell.trim() !== ''));
  if (!header) return [];

  const keys = header.map((key) => key.trim());
  return body.map((cells) =>
    Object.fromEntries(keys.map((key, index) => [key, (cells[index] ?? '').trim()])),
  );
}

/* -------------------------------------------------------------------------- */
/* Normalisation                                                               */
/* -------------------------------------------------------------------------- */

/** "Mar 2023" -> "2023-03"; "2023" -> "2023"; "" -> "" (meaning current). */
function normalizeDate(value) {
  if (!value) return '';

  const trimmed = value.trim();
  const yearOnly = trimmed.match(/^(\d{4})$/);
  if (yearOnly) return yearOnly[1];

  const monthYear = trimmed.match(/^([A-Za-z]{3})[a-z]*\s+(\d{4})$/);
  if (monthYear) {
    const month = MONTHS[monthYear[1].toLowerCase()];
    if (month) return `${monthYear[2]}-${month}`;
  }

  const iso = trimmed.match(/^(\d{4})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}`;

  console.warn(`  ! could not parse date "${value}" — left as-is`);
  return trimmed;
}

/**
 * LinkedIn descriptions are usually a paragraph followed by bullets typed as
 * "-" or "•". Split them so the site can render real list items.
 */
function splitDescription(description) {
  if (!description) return { summary: '', highlights: [] };

  const lines = description
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const summary = [];
  const highlights = [];

  for (const line of lines) {
    const bullet = line.match(/^[-•*·]\s*(.+)$/);
    if (bullet) {
      highlights.push(bullet[1].trim());
    } else if (highlights.length === 0) {
      summary.push(line);
    } else {
      // Continuation of the previous bullet after a hard wrap.
      highlights[highlights.length - 1] += ` ${line}`;
    }
  }

  return { summary: summary.join(' '), highlights };
}

/**
 * Two roles are the same job if the employer, the title, and the start *year*
 * match. Deliberately year-granular: hand-authored entries here are often just
 * "2023" while LinkedIn always exports "Jan 2023", and matching those strictly
 * would duplicate every role on the first import instead of updating it.
 */
function roleKey(entry) {
  const year = (entry.startDate ?? '').slice(0, 4);
  return [entry.name, entry.position, year].join('|').toLowerCase();
}

/** `2023-01` carries more information than `2023`; prefer it once we have it. */
function isMorePrecise(candidate, current) {
  return (candidate ?? '').length > (current ?? '').length;
}

/* -------------------------------------------------------------------------- */
/* Export loading                                                              */
/* -------------------------------------------------------------------------- */

function resolveExportDir(inputPath) {
  const target = resolve(process.cwd(), inputPath);

  if (!existsSync(target)) {
    throw new Error(`No such file or directory: ${target}`);
  }

  if (statSync(target).isDirectory()) return target;

  if (!target.toLowerCase().endsWith('.zip')) {
    throw new Error(`Expected a .zip or a directory, got: ${target}`);
  }

  const scratch = mkdtempSync(join(tmpdir(), 'linkedin-export-'));
  execFileSync('unzip', ['-o', '-q', target, '-d', scratch]);
  console.log(`  extracted archive to ${scratch}`);
  return scratch;
}

/** LinkedIn nests files inconsistently between exports, so search for them. */
function findCsv(dir, filename) {
  const stack = [dir];

  while (stack.length > 0) {
    const current = stack.pop();
    for (const dirent of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, dirent.name);
      if (dirent.isDirectory()) {
        stack.push(full);
      } else if (dirent.name.toLowerCase() === filename.toLowerCase()) {
        return full;
      }
    }
  }

  return null;
}

function readCsv(dir, filename) {
  const path = findCsv(dir, filename);
  if (!path) {
    console.warn(`  ! ${filename} not found in export — skipping`);
    return [];
  }
  return parseCsv(readFileSync(path, 'utf8'));
}

/* -------------------------------------------------------------------------- */
/* Merge                                                                       */
/* -------------------------------------------------------------------------- */

function mergeWork(existing, incoming) {
  const changes = [];
  const byKey = new Map(existing.map((entry) => [roleKey(entry), entry]));

  for (const candidate of incoming) {
    const match = byKey.get(roleKey(candidate));

    if (!match) {
      existing.push(candidate);
      byKey.set(roleKey(candidate), candidate);
      changes.push(`+ added   ${candidate.position} @ ${candidate.name} (${candidate.startDate})`);
      continue;
    }

    // Dates and location sync from LinkedIn. Prose stays hand-owned — imported
    // summaries read like job postings, and yours have been edited.
    const label = `${match.position} @ ${match.name}`;

    if (isMorePrecise(candidate.startDate, match.startDate)) {
      changes.push(`~ updated ${label}: startDate "${match.startDate}" -> "${candidate.startDate}"`);
      match.startDate = candidate.startDate;
    }

    const currentEnd = match.endDate ?? '';
    if (currentEnd !== candidate.endDate && isMorePrecise(candidate.endDate, currentEnd)) {
      changes.push(`~ updated ${label}: endDate "${currentEnd}" -> "${candidate.endDate}"`);
      match.endDate = candidate.endDate;
    } else if (currentEnd && !candidate.endDate) {
      changes.push(`~ updated ${label}: role is current again, cleared endDate`);
      match.endDate = '';
    } else if (!currentEnd && candidate.endDate) {
      changes.push(`~ updated ${label}: role ended, endDate -> "${candidate.endDate}"`);
      match.endDate = candidate.endDate;
    }

    if (candidate.location && !match.location) {
      match.location = candidate.location;
      changes.push(`~ updated ${label}: location -> "${candidate.location}"`);
    }
  }

  // Newest first; a role with no end date is current, so it sorts to the top.
  existing.sort((a, b) => {
    if (!a.endDate && b.endDate) return -1;
    if (a.endDate && !b.endDate) return 1;
    return (b.startDate ?? '').localeCompare(a.startDate ?? '');
  });

  return changes;
}

function mergeEducation(existing, incoming) {
  const changes = [];
  const seen = new Set(existing.map((entry) => entry.institution.toLowerCase()));

  for (const candidate of incoming) {
    if (seen.has(candidate.institution.toLowerCase())) continue;
    existing.push(candidate);
    changes.push(`+ added   ${candidate.institution}`);
  }

  return changes;
}

/* -------------------------------------------------------------------------- */
/* Main                                                                        */
/* -------------------------------------------------------------------------- */

function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const inputPath = args.find((arg) => !arg.startsWith('--'));

  if (!inputPath) {
    console.error(`
Usage: node scripts/linkedin-import.mjs <export.zip | export-dir/> [--dry-run]

Get your export from LinkedIn:
  Settings & Privacy -> Data privacy -> Get a copy of your data
  -> pick "Want something in particular?" and tick Positions, Education, Skills
  -> LinkedIn emails you a download link, usually within ~10 minutes.
`);
    process.exit(1);
  }

  console.log('reading export...');
  const dir = resolveExportDir(inputPath);

  const positions = readCsv(dir, 'Positions.csv').map((row) => {
    const { summary, highlights } = splitDescription(row.Description);
    return {
      name: row['Company Name'],
      position: row.Title,
      location: row.Location || undefined,
      startDate: normalizeDate(row['Started On']),
      endDate: normalizeDate(row['Finished On']),
      summary,
      highlights,
    };
  });

  const education = readCsv(dir, 'Education.csv').map((row) => ({
    institution: row['School Name'],
    area: row.Notes || undefined,
    studyType: row['Degree Name'] || undefined,
    startDate: normalizeDate(row['Start Date']),
    endDate: normalizeDate(row['End Date']),
  }));

  console.log(`  found ${positions.length} positions, ${education.length} education entries\n`);

  const resume = JSON.parse(readFileSync(RESUME_PATH, 'utf8'));
  const changes = [
    ...mergeWork(resume.work, positions),
    ...mergeEducation(resume.education, education),
  ];

  if (changes.length === 0) {
    console.log('resume.json is already up to date. Nothing to do.');
    return;
  }

  console.log(`${changes.length} change(s):`);
  for (const change of changes) console.log(`  ${change}`);

  if (dryRun) {
    console.log('\n--dry-run: nothing written.');
    return;
  }

  writeFileSync(RESUME_PATH, `${JSON.stringify(resume, null, 2)}\n`);
  console.log(`\nwrote ${RESUME_PATH}`);
  console.log('Review the diff — imported summaries are raw LinkedIn text and usually want an edit.');
}

try {
  main();
} catch (error) {
  console.error(`\nerror: ${error.message}`);
  process.exit(1);
}
