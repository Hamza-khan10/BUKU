/**
 * Refuse invisible characters in committed files ("Trojan Source",
 * CVE-2021-42574): bidirectional overrides can make code read differently
 * from how it runs, and zero-width characters hide inside names and strings.
 * Where code needs such a character it writes an escape (`\u200D`), never the
 * character itself.
 *
 *   tsx scripts/check-hidden-chars.ts            every tracked file (CI)
 *   tsx scripts/check-hidden-chars.ts a.ts b.md  just these (lint-staged)
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// Format (Cf: bidi controls, zero-width characters, the byte-order mark…), control
// characters other than tab/newline/carriage return, private-use code points, and
// the emoji variation selectors (invisible on their own).
// eslint-disable-next-line no-control-regex -- the point is to find control characters
const HIDDEN = /\p{Cf}|[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]|\p{Co}|\uFE0E|\uFE0F/gu;

const files = process.argv.length > 2 ? process.argv.slice(2) : tracked();
let found = 0;

for (const file of files) {
  let buf: Buffer;
  try {
    buf = readFileSync(file);
  } catch {
    continue; // deleted in this change
  }
  if (buf.includes(0)) continue; // binary (images, fonts)
  const lines = buf.toString('utf8').split('\n');
  lines.forEach((line, i) => {
    for (const m of line.matchAll(HIDDEN)) {
      const cp = m[0].codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0');
      console.error(
        `${file}:${i + 1}:${m.index + 1}  U+${cp} — write it as an escape (\\u${cp}) or remove it`,
      );
      found++;
    }
  });
}

if (found > 0) {
  console.error(`\n${found} hidden character(s) found.`);
  process.exit(1);
}
console.log(`No hidden characters in ${files.length} file(s).`);

function tracked(): string[] {
  return execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
}
