import type { APIRoute } from 'astro';
import { resume } from '../data/resume';

/**
 * Serves the resume as JSON Resume (jsonresume.org) so the same data the site
 * renders is machine-readable — for recruiters' tooling, other renderers, or
 * just to have one canonical copy at a stable URL.
 */
export const GET: APIRoute = () =>
  new Response(JSON.stringify(resume, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
