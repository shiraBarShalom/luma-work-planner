// Dev-only consistency checks (run: npm run check):
//  1. sw.js SHELL precache list == shipped runtime files (no missing, no stale entries).
//  2. Every relative import resolves to an existing file.
//  3. No unused named imports (keeps modules free of dead references).
//  4. No innerHTML assignment outside the reviewed static-markup helpers.
//  5. No network URLs in runtime code.
import { readFile, readdir } from 'node:fs/promises';
import { join, relative, dirname, resolve } from 'node:path';

const root = resolve(dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const problems = [];

async function walk(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...await walk(p)); else out.push(p);
  }
  return out;
}
const rel = (p) => './' + relative(root, p).split('\\').join('/');

const sw = await readFile(join(root, 'sw.js'), 'utf8');
const shellBlock = sw.slice(sw.indexOf('const SHELL = ['), sw.indexOf('];', sw.indexOf('const SHELL = [')));
const shell = new Set([...shellBlock.matchAll(/'(\.\/[^']*)'/g)].map((m) => m[1]));
const runtime = [
  ...(await walk(join(root, 'js'))), ...(await walk(join(root, 'css'))), ...(await walk(join(root, 'fonts'))).filter((f) => f.endsWith('.woff2')),
  ...(await walk(join(root, 'icons'))), ...(await walk(join(root, 'assets'))),
].map(rel);
for (const f of ['./', './index.html', './manifest.webmanifest']) if (!shell.has(f)) problems.push(`sw.js SHELL missing ${f}`);
for (const f of runtime) if (!shell.has(f)) problems.push(`sw.js SHELL missing ${f}`);
for (const f of shell) if (!['./', './index.html', './manifest.webmanifest'].includes(f) && !runtime.includes(f)) problems.push(`sw.js SHELL lists non-existent ${f}`);

for (const file of (await walk(join(root, 'js'))).filter((f) => f.endsWith('.js'))) {
  const src = await readFile(file, 'utf8');
  for (const m of src.matchAll(/import\s+(?:[\s\S]*?)\s+from\s+'(\.[^']+)'/g)) {
    try { await readFile(join(dirname(file), m[1])); } catch { problems.push(`${rel(file)}: unresolved import ${m[1]}`); }
  }
  for (const m of src.matchAll(/import\(\s*'(\.[^']+)'\s*\)/g)) {
    try { await readFile(join(dirname(file), m[1])); } catch { problems.push(`${rel(file)}: unresolved dynamic import ${m[1]}`); }
  }
  const body = src.replace(/^import[\s\S]*?;\s*$/gm, '');
  for (const m of src.matchAll(/^import\s*\{([^}]*)\}\s*from/gm)) {
    for (const part of m[1].split(',').map((x) => x.trim()).filter(Boolean)) {
      const local = part.split(/\s+as\s+/).pop().trim();
      if (!new RegExp(`\\b${local.replace(/\$/g, '\\$')}\\b`).test(body)) problems.push(`${rel(file)}: unused import ${local}`);
    }
  }
  for (const m of src.matchAll(/^import\s+\*\s+as\s+(\w+)/gm)) if (!new RegExp(`\\b${m[1]}\\.`).test(body)) problems.push(`${rel(file)}: unused namespace ${m[1]}`);
  if (/\.innerHTML\s*=/.test(src) && !/js\/ui\.js$/.test(file.split('\\').join('/'))) problems.push(`${rel(file)}: innerHTML assignment`);
  if (/https?:\/\/(?!localhost|127\.0\.0\.1)/.test(src.replace(/\/\/.*$/gm, ''))) problems.push(`${rel(file)}: network URL in runtime code`);
}

if (problems.length) { console.error(problems.join('\n')); console.error(`\n${problems.length} problem(s)`); process.exit(1); }
console.log(`shell check OK: ${shell.size} precached files, imports resolved, no unused imports`);
