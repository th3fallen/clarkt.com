# clarkt.com

Personal resume site. Astro, static output, no client framework.

The whole page is one 39 KB HTML file with the CSS inlined — the only other
requests are the headshot and the webfont.

## Develop

```bash
npm install
npm run dev      # http://localhost:4321
npm run build    # -> dist/
npm run preview  # serve dist/ locally
npm run check    # astro + typescript diagnostics
```

## Editing content

Everything on the page comes from **`src/data/resume.json`**. No content lives in
markup. To update a job title, add a role, or change the summary, edit that file
and rebuild — you should never need to open a component to change what the site
says.

The file follows the [JSON Resume](https://jsonresume.org) schema, so the same
data is portable to other renderers, and it is served as-is at
[`/resume.json`](https://clarkt.com/resume.json).

Dates accept either `YYYY` or `YYYY-MM`. An **empty `endDate` means "current"** —
that's what puts the role first and lights up the green dot.

## Syncing from LinkedIn

LinkedIn has no API that returns your own work history. Sign In with LinkedIn
(OIDC) returns `name`, `picture`, `email` and nothing else; positions live behind
partner-only programs. So there is no way to make this site update itself from
LinkedIn without violating their terms via a scraper.

What works instead is their data export:

1. LinkedIn → **Settings & Privacy → Data privacy → Get a copy of your data**
2. Choose "Want something in particular?" and tick **Positions**, **Education**,
   **Skills**
3. LinkedIn emails a download link, usually within ~10 minutes
4. Run the importer:

```bash
npm run import:linkedin -- ~/Downloads/Basic_LinkedInDataExport.zip --dry-run
```

Drop `--dry-run` to write. It accepts either the `.zip` or an unzipped directory.

The merge is deliberately conservative:

| What | Behavior |
| --- | --- |
| New role on LinkedIn | Added |
| Role that ended | `endDate` updated |
| Date precision (`2023` → `2023-01`) | Upgraded |
| Missing location | Filled in |
| `summary` / `highlights` | **Never overwritten** |

That last row is the point. LinkedIn descriptions read like job postings; the
copy in `resume.json` has been edited. The importer treats LinkedIn as the source
of truth for *which jobs exist and when*, and this repo as the source of truth
for *how they read*.

Every run prints what it changed. Review the diff before committing.

## Design notes

- **Theme** — light and dark, following the system by default, overridable with
  the titlebar toggle and remembered in `localStorage`. The palette is defined
  once as custom properties in `src/styles/global.css`.
- **No JS framework.** The only scripts are the theme toggle and the pre-paint
  theme application (~700 bytes total, inlined).
- **Print** — `Cmd+P` produces a clean one-column document. Chrome, animations,
  and the footer are dropped; tag pills flatten to comma-separated lists.
- **Structured data** — `Person` JSON-LD in the `<head>`, plus a sitemap.

## Deploy

Static output in `dist/`. The domain is already on Cloudflare DNS, so Cloudflare
Pages is the least-friction target:

- Build command: `npm run build`
- Output directory: `dist`
- Node version: 22

Any static host works — there is no server-side runtime.
