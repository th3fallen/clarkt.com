import data from './resume.json';

export interface Profile {
  network: string;
  username: string;
  url: string;
}

export interface Basics {
  name: string;
  label: string;
  image?: string;
  email?: string;
  phone?: string;
  url?: string;
  summary?: string;
  location?: { city?: string; region?: string; countryCode?: string };
  profiles?: Profile[];
}

export interface Work {
  name: string;
  position: string;
  location?: string;
  url?: string;
  startDate: string;
  endDate?: string;
  summary?: string;
  highlights?: string[];
  /**
   * Employer-level context rather than role-level — an acquisition, a rename.
   * Set it on any one role at that employer; the whole group renders it once.
   */
  note?: string;
}

export interface Education {
  institution: string;
  area?: string;
  studyType?: string;
  location?: string;
  startDate: string;
  endDate?: string;
}

export interface Award {
  title: string;
  date?: string;
  awarder?: string;
  summary?: string;
}

export interface Skill {
  name: string;
  keywords?: string[];
}

export interface Resume {
  basics: Basics;
  work: Work[];
  education: Education[];
  awards: Award[];
  skills: Skill[];
}

export const resume = data as Resume;

/**
 * Accepts a full ISO date, a `YYYY-MM`, or a bare `YYYY` and renders the
 * coarsest sensible label. LinkedIn exports only ever give us month
 * precision, so days are never shown.
 */
export function formatDate(value: string | undefined): string {
  if (!value) return 'Present';

  const [year, month] = value.split('-');
  if (!month) return year ?? 'Present';

  const date = new Date(Number(year), Number(month) - 1, 1);
  return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

export function formatRange(startDate: string, endDate?: string): string {
  return `${formatDate(startDate)} — ${formatDate(endDate)}`;
}

export function isCurrent(entry: Work): boolean {
  return !entry.endDate;
}

/** Total years of professional experience, counted from the earliest start date. */
export function yearsOfExperience(work: Work[]): number {
  const years = work
    .map((entry) => Number(entry.startDate.slice(0, 4)))
    .filter((year) => Number.isFinite(year));

  if (years.length === 0) return 0;
  return new Date().getFullYear() - Math.min(...years);
}

/**
 * Collapses consecutive roles at the same employer into one group so a long
 * tenure reads as one company with a promotion history rather than as N
 * unrelated jobs. Non-consecutive stints at the same place stay separate,
 * which is what you want when someone boomerangs.
 */
export function groupByEmployer(
  work: Work[],
): { name: string; url?: string; note?: string; range: string; roles: Work[] }[] {
  const groups: { name: string; url?: string; note?: string; range: string; roles: Work[] }[] = [];

  for (const entry of work) {
    const last = groups.at(-1);
    if (last && last.name === entry.name) {
      last.roles.push(entry);
      last.url ??= entry.url;
      last.note ??= entry.note;
    } else {
      groups.push({
        name: entry.name,
        url: entry.url,
        note: entry.note,
        range: '',
        roles: [entry],
      });
    }
  }

  // Span the whole tenure: earliest start (the last role listed) to the latest
  // end (the first). Shown next to the employer so a long tenure reads at a
  // glance without adding up the individual roles.
  for (const group of groups) {
    const first = group.roles[0]!;
    const last = group.roles.at(-1)!;
    group.range = formatRange(last.startDate, first.endDate);
  }

  return groups;
}
