#!/usr/bin/env node
/**
 * Incremental guard for the repository's legacy svelte-check debt.
 *
 * `npm run check` used to fail on thousands of pre-existing diagnostics, so no
 * new regression could be distinguished from the old noise. `check:strict`
 * remains the full report. This wrapper records the known-error fingerprint
 * set and fails only when a diagnostic is not in that baseline.
 */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const baselinePath = resolve(root, 'scripts/svelte-check-baseline.json');
const write = process.argv.includes('--write-baseline');
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const run = spawnSync(npx, ['svelte-check', '--tsconfig', './tsconfig.json', '--output', 'machine'], {
  cwd: root,
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
});
const output = `${run.stdout ?? ''}\n${run.stderr ?? ''}`;
const errors = [];
const pattern = /ERROR "([^"]+)" \d+:\d+ "((?:\\.|[^"\\])*)"\r?/g;
for (const match of output.matchAll(pattern)) {
  const file = isAbsolute(match[1]) ? relative(root, match[1]) : match[1];
  const message = match[2];
  const fp = createHash('sha256').update(`${file}\n${message}`).digest('hex').slice(0, 32);
  errors.push({ file, message, fp });
}

if (run.status !== 0 && errors.length === 0) {
  console.error('svelte-check failed without parseable diagnostics');
  console.error(output.slice(-4000));
  process.exit(1);
}

const counts = new Map();
for (const error of errors) counts.set(error.fp, (counts.get(error.fp) ?? 0) + 1);
const baseline = write || !existsSync(baselinePath)
  ? { version: 1, generatedAt: new Date().toISOString(), errors: Object.fromEntries([...counts].sort()) }
  : JSON.parse(readFileSync(baselinePath, 'utf8'));

if (write) {
  writeFileSync(baselinePath, `${JSON.stringify(baseline, null, '\t')}\n`);
  console.log(`svelte-check baseline updated: ${errors.length} legacy diagnostics`);
  process.exit(0);
}

const allowed = baseline.errors ?? {};
const unexpected = [...counts].filter(([fp, count]) => count > (allowed[fp] ?? 0));
const totalAllowed = Object.values(allowed).reduce((sum, count) => sum + count, 0);
if (unexpected.length > 0) {
  console.error(`svelte-check: ${unexpected.length} new/repeated diagnostic(s) beyond the legacy baseline`);
  for (const [fp, count] of unexpected.slice(0, 20)) {
    const sample = errors.find((error) => error.fp === fp);
    console.error(`  ${sample?.file ?? fp}: ${count} occurrence(s) — ${sample?.message?.split('\n')[0] ?? ''}`);
  }
  process.exit(1);
}
console.log(`svelte-check baseline: ${errors.length} legacy diagnostics, 0 new (allowed ${totalAllowed})`);
