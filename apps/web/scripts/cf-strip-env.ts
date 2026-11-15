/**
 * Runs after every Cloudflare build (D-135). OpenNext copies the values of every .env file it finds
 * (the app's and the monorepo root's: .env, .env.local, .env.production…) into the Worker
 * (.open-next/cloudflare/next-env.mjs). On a developer's machine those are the stack's own
 * secrets. The website on Cloudflare takes its settings only from the Worker's variables and
 * secrets (wrangler.jsonc, `wrangler secret put`), so that file is emptied here, and then the
 * whole build is searched for any value from any local .env file. If one is found, this fails and
 * names the variable (never its value), and nothing is deployed.
 *
 * `--preview` (a local preview that never leaves this machine): the file is still emptied, and
 * what's found is only reported. Deploys are always strict, so the live site is built in a clean
 * checkout (Cloudflare's Git builds), where there are no .env files at all.
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const preview = process.argv.includes('--preview');

const app = resolve(fileURLToPath(new URL('..', import.meta.url)));
const root = resolve(app, '../..');
const out = join(app, '.open-next');
const envFile = join(out, 'cloudflare', 'next-env.mjs');

if (!existsSync(envFile)) {
  console.error(
    'cf-strip-env: no Cloudflare build found (.open-next). Run `opennextjs-cloudflare build` first.',
  );
  process.exit(1);
}
writeFileSync(
  envFile,
  '// Emptied by scripts/cf-strip-env.mjs: settings come from the Worker, never from .env files.\n' +
    'export const production = {};\nexport const development = {};\nexport const test = {};\n',
);

/** Every value in the local .env files that could be a secret (long enough to matter). */
function localValues(): Map<string, string> {
  const values = new Map<string, string>();
  for (const dir of [root, app]) {
    for (const name of readdirSync(dir)) {
      if (!/^\.env(\..+)?$/.test(name) || name.endsWith('.example')) continue;
      const path = join(dir, name);
      if (!statSync(path).isFile()) continue;
      for (const line of readFileSync(path, 'utf8').split('\n')) {
        const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
        if (!match) continue;
        const value = (match[2] ?? '').replace(/^(['"])(.*)\1$/, '$2').trim();
        // Short values (ports, true/false, localhost) can't be told apart from ordinary code.
        if (value.length >= 16) values.set(value, match[1] ?? '');
      }
    }
  }
  return values;
}

function* files(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* files(path);
    else if (entry.isFile() && statSync(path).size < 50 * 1024 * 1024) yield path;
  }
}

const secrets = localValues();
const found = new Set<string>();
if (secrets.size > 0) {
  for (const path of files(out)) {
    const text = readFileSync(path, 'latin1');
    for (const [value, name] of secrets)
      if (text.includes(value)) found.add(`${name} (in ${path.slice(out.length + 1)})`);
  }
}
if (found.size > 0) {
  console.error(
    preview
      ? 'cf-strip-env: this local build carries values from .env files (fine for a preview here, never for a deploy):'
      : 'cf-strip-env: values from local .env files are inside the Cloudflare build. Not deploying.',
  );
  for (const what of found) console.error(`  - ${what}`);
  if (!preview) {
    console.error("Build in a clean checkout (Cloudflare's Git builds), or remove those values first.");
    process.exit(1);
  }
}
console.log(`cf-strip-env: build is clean (${secrets.size} local values checked, next-env emptied).`);
