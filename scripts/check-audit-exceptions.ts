/**
 * An audit exception must not outlive its reason (SECURITY.md, "Audit exceptions"). For every
 * advisory the dependency audit ignores (pnpm-workspace.yaml, auditConfig.ignoreGhsas), ask GitHub
 * whether it is still withdrawn and whether a fixed version exists, and ask npm whether a release
 * beyond the vulnerable range is out. Exits 1 (so the daily "Audit exceptions" workflow fails and
 * GitHub emails the owner) as soon as anything means the exception should go:
 *
 *   node scripts/check-audit-exceptions.ts        (GITHUB_TOKEN optional, raises the rate limit)
 */
import { readFileSync } from 'node:fs';

interface Advisory {
  ghsa_id: string;
  summary: string;
  withdrawn_at: string | null;
  vulnerabilities: {
    package: { ecosystem: string; name: string };
    vulnerable_version_range: string | null;
    first_patched_version: string | { identifier: string } | null;
  }[];
}

const workspace = readFileSync(new URL('../pnpm-workspace.yaml', import.meta.url), 'utf8');
const section = workspace.slice(workspace.indexOf('auditConfig:'));
const ignored = workspace.includes('auditConfig:')
  ? [...section.matchAll(/^\s+-\s+(GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4})\s*$/gm)].map((m) => m[1]!)
  : [];

/** "4.0.7" > "4.0.6"; pre-releases and odd versions count as not newer. */
function newer(a: string, b: string): boolean {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  if (pa.length !== 3 || pb.length !== 3 || [...pa, ...pb].some(Number.isNaN)) return false;
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i]! > pb[i]!;
  return false;
}

/** The top of a range like "<= 4.0.7" or "< 4.1.0" (null when the range is shaped otherwise). */
function topOf(range: string | null): { version: string; inclusive: boolean } | null {
  const m = /<\s*(=)?\s*(\d+\.\d+\.\d+)\s*$/.exec(range ?? '');
  return m ? { version: m[2]!, inclusive: Boolean(m[1]) } : null;
}

async function json<T>(url: string, headers: Record<string, string> = {}): Promise<T> {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return (await res.json()) as T;
}

const problems: string[] = [];
const github = {
  accept: 'application/vnd.github+json',
  'x-github-api-version': '2022-11-28',
  ...(process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
};

for (const id of ignored) {
  const advisory = await json<Advisory>(`https://api.github.com/advisories/${id}`, github);
  const lines = [`${id}: ${advisory.summary}`];
  if (!advisory.withdrawn_at)
    problems.push(
      `${id} is no longer withdrawn: it is a live advisory again. Fix it and remove the exception.`,
    );
  else lines.push(`  withdrawn ${advisory.withdrawn_at}`);
  for (const v of advisory.vulnerabilities) {
    const patched =
      typeof v.first_patched_version === 'string'
        ? v.first_patched_version
        : v.first_patched_version?.identifier;
    if (patched)
      problems.push(
        `${id}: ${v.package.name} has a fixed version, ${patched}. Update to it and remove the exception.`,
      );
    if (v.package.ecosystem !== 'npm') continue;
    const latest = (await json<{ version: string }>(`https://registry.npmjs.org/${v.package.name}/latest`))
      .version;
    const top = topOf(v.vulnerable_version_range);
    lines.push(`  ${v.package.name}: vulnerable ${v.vulnerable_version_range ?? '?'}, latest ${latest}`);
    if (top && (top.inclusive ? newer(latest, top.version) : !newer(top.version, latest)))
      problems.push(
        `${id}: ${v.package.name} ${latest} is outside the vulnerable range (${v.vulnerable_version_range}). Update to it and remove the exception.`,
      );
  }
  console.log(lines.join('\n'));
}

if (ignored.length === 0) console.log('No audit exceptions.');
for (const p of problems) console.log(`::error::${p}`);
process.exit(problems.length > 0 ? 1 : 0);
