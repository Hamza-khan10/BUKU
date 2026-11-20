/**
 * Lighthouse budgets (3.7h, D-142): the public pages, measured the way Google measures them (a
 * mid-range phone on a slow connection, simulated), against the plan's promise of fast pages
 * (WEB_PLAN §1.5) and the scores the site already earns. Run against a production build that is
 * being served, before launch (PRELAUNCH=true, as onbuku.com runs today):
 *
 *   node apps/web/scripts/lighthouse-budgets.ts [http://localhost:3000]
 *
 * Each page is measured three times and judged on its middle run (Lighthouse's own advice: one
 * run can be unlucky). A page fails on a score below its floor, a slow main picture or text
 * (LCP), anything jumping (CLS), or more JavaScript than its budget: sizes don't wobble between
 * runs the way timings do, so the budget catches a heavy import the day it lands.
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const base = (process.argv[2] ?? 'http://localhost:3000').replace(/\/$/, '');
const RUNS = 3;

/** The pages, each with the most JavaScript it may send (KiB, compressed), ~10% over today's. */
const PAGES: { path: string; jsKiB: number }[] = [
  { path: '/', jsKiB: 370 },
  { path: '/pricing', jsKiB: 325 },
  { path: '/categories', jsKiB: 335 },
  // Category pages carry their questions (an accordion) and guide.
  { path: '/c/barbershop', jsKiB: 365 },
  { path: '/early-access', jsKiB: 335 },
  { path: '/for-business', jsKiB: 325 },
  { path: '/contact', jsKiB: 315 },
];

/**
 * Lowest score allowed per category (0 to 100). Performance is measured on a simulated phone that
 * runs at the speed of whichever machine CI is given, and those differ: the same code scored 99 to
 * 100 on one and 92 to 97 on another. So CI holds it at 90, which a real slowdown still trips; the
 * plan's 95 is judged on onbuku.com itself. Sizes and the other scores don't depend on the machine.
 */
const FLOORS = { performance: 90, accessibility: 100, 'best-practices': 100, seo: 100 } as const;
const LCP_MS = 2500;
const CLS = 0.1;

type Report = {
  environment?: { benchmarkIndex?: number };
  categories: Record<keyof typeof FLOORS, { score: number | null }>;
  audits: Record<
    string,
    { numericValue?: number; details?: { items?: { resourceType?: string; transferSize?: number }[] } }
  >;
};

const lighthouse = join(import.meta.dirname, '..', 'node_modules', '.bin', 'lighthouse');
const chrome = chromium.executablePath();
const out = mkdtempSync(join(tmpdir(), 'lighthouse-'));

/**
 * One Lighthouse run. Lighthouse sometimes fails to record its own trace (NO_NAVSTART and the like,
 * "please run Lighthouse again"): that run is taken again, twice at most; a page that can't be
 * measured three times in a row fails.
 */
function measure(path: string, run: number): Report {
  const file = join(out, `${path.replaceAll('/', '_') || '_'}-${run}.json`);
  for (let attempt = 1; ; attempt++) {
    const result = spawnSync(
      lighthouse,
      [
        `${base}${path}`,
        '--quiet',
        '--output=json',
        `--output-path=${file}`,
        `--only-categories=${Object.keys(FLOORS).join(',')}`,
        '--chrome-flags=--headless=new --no-sandbox',
      ],
      // From the temporary folder: on WSL, Chrome's launcher takes itself for Windows and makes its
      // throwaway profile under a Windows-style name, relative to where it runs.
      { cwd: out, env: { ...process.env, CHROME_PATH: chrome }, stdio: ['ignore', 'ignore', 'inherit'] },
    );
    const report =
      result.status === 0
        ? (JSON.parse(readFileSync(file, 'utf8')) as Report & { runtimeError?: unknown })
        : null;
    if (report && !report.runtimeError) return report;
    if (attempt === 3) throw new Error(`Lighthouse couldn't measure ${path} (three tries)`);
    console.log(`Lighthouse didn't record ${path} (try ${attempt}); measuring it again`);
  }
}

const score = (r: Report, k: keyof typeof FLOORS) => Math.round((r.categories[k].score ?? 0) * 100);
const jsKiB = (r: Report) =>
  Math.round(
    (r.audits['network-requests']?.details?.items ?? [])
      .filter((i) => i.resourceType === 'Script')
      .reduce((n, i) => n + (i.transferSize ?? 0), 0) / 1024,
  );

const failures: string[] = [];
const rows: string[] = [];
for (const { path, jsKiB: budget } of PAGES) {
  const runs = Array.from({ length: RUNS }, (_, i) => measure(path, i));
  const mid = [...runs].sort((a, b) => score(a, 'performance') - score(b, 'performance'))[
    Math.floor(RUNS / 2)
  ]!;
  const lcp = mid.audits['largest-contentful-paint']?.numericValue ?? Infinity;
  const tbt = mid.audits['total-blocking-time']?.numericValue ?? Infinity;
  const cls = mid.audits['cumulative-layout-shift']?.numericValue ?? Infinity;
  const js = jsKiB(mid);
  for (const k of Object.keys(FLOORS) as (keyof typeof FLOORS)[]) {
    if (score(mid, k) < FLOORS[k]) failures.push(`${path}: ${k} ${score(mid, k)}, below ${FLOORS[k]}`);
  }
  if (lcp > LCP_MS) failures.push(`${path}: largest contentful paint ${Math.round(lcp)} ms, over ${LCP_MS}`);
  if (cls > CLS) failures.push(`${path}: layout shift ${cls.toFixed(3)}, over ${CLS}`);
  if (js > budget) failures.push(`${path}: ${js} KiB of JavaScript, over its ${budget} KiB budget`);
  rows.push(
    `| ${path} | ${score(mid, 'performance')} (${runs.map((r) => score(r, 'performance')).join(', ')}) | ` +
      `${score(mid, 'accessibility')} | ${score(mid, 'best-practices')} | ${score(mid, 'seo')} | ` +
      `${(lcp / 1000).toFixed(1)} s | ${Math.round(tbt)} ms | ${cls.toFixed(3)} | ${js} / ${budget} KiB | ` +
      `${Math.round(mid.environment?.benchmarkIndex ?? 0)} |`,
  );
  console.log(rows.at(-1));
}

const table = [
  '### Lighthouse budgets (phone, simulated; middle of three runs)',
  '',
  '| Page | Performance (runs) | Accessibility | Best practices | SEO | LCP | TBT | CLS | JavaScript | Machine speed |',
  '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ...rows,
  '',
  'Machine speed is Lighthouse’s benchmark index for this runner: lower means a slower machine, and',
  'slower simulated timings for the same code.',
  '',
].join('\n');
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, table);
for (const f of failures) console.log(`::error::${f}`);
process.exit(failures.length ? 1 : 0);
