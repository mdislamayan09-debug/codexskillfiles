#!/usr/bin/env node
// Runs every browser playtest (and the capture scripts that check things),
// two at a time, and prints one line per script. Each script's own output
// goes to artifacts/playtest/logs/<name>.log.
//
// Usage: node scripts/playtest-all.mjs [--url http://127.0.0.1:5188] [--jobs 2]
//          [--only caves,sky] [--gpu | --swiftshader] [--quality low]
//
// Tip: point it at a production build (`npm run build`, then
// `npm run preview` and --url http://127.0.0.1:4188). The dev server reloads
// the page whenever a source file is saved, which breaks a running test; a
// build does not, so the game can be edited while the suite runs.
import { spawn } from 'node:child_process';
import { createWriteStream, mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const jobs = Number(arg('jobs', '2'));
const only = arg('only', '');
const pass = ['--url', arg('url', 'http://127.0.0.1:5188'), '--quality', arg('quality', 'low')];
if (args.includes('--gpu')) pass.push('--gpu');
if (args.includes('--swiftshader')) pass.push('--swiftshader');

// Longest first, so the slow ones are not left running alone at the end.
const SCRIPTS = [
  'playtest-wardens',
  'playtest-archery',
  'playtest-story',
  'playtest-warden',
  'playtest-sidestories',
  'playtest-survival',
  'playtest-building',
  'capture-stillheart',
  'playtest-caves',
  'playtest-sunwells',
  'playtest-sky',
  'playtest-creatures',
  'playtest-combat',
  'playtest',
  'capture-landmarks',
  'playtest-curiosities',
  'capture-title',
];
const wanted = SCRIPTS.filter((s) => !only || only.split(',').some((o) => s === o || s === `playtest-${o}` || s === `capture-${o}`));
mkdirSync('artifacts/playtest/logs', { recursive: true });

const results = [];
const run = (name) =>
  new Promise((resolve) => {
    const started = Date.now();
    const log = createWriteStream(`artifacts/playtest/logs/${name}.log`);
    const child = spawn(process.execPath, [`scripts/${name}.mjs`, ...pass], { stdio: ['ignore', 'pipe', 'pipe'] });
    let tail = '';
    const take = (chunk) => {
      log.write(chunk);
      tail = (tail + chunk.toString()).slice(-4000);
    };
    child.stdout.on('data', take);
    child.stderr.on('data', take);
    child.on('close', (code) => {
      log.end();
      const seconds = Math.round((Date.now() - started) / 1000);
      const score = tail.match(/(\d+)\/(\d+) (?:checks )?passed/);
      const failures = tail.split('\n').filter((l) => l.startsWith('FAIL')).map((l) => l.slice(5, 90));
      const r = { name, ok: code === 0, score: score ? `${score[1]}/${score[2]}` : '-', seconds, failures };
      results.push(r);
      console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${name.padEnd(22)} ${r.score.padStart(6)}  ${String(seconds).padStart(4)}s${r.failures.length ? `  ${r.failures.join(' | ')}` : ''}`);
      resolve();
    });
  });

const queue = [...wanted];
const started = Date.now();
await Promise.all(
  Array.from({ length: Math.max(1, jobs) }, async () => {
    while (queue.length) await run(queue.shift());
  }),
);
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} scripts passed in ${Math.round((Date.now() - started) / 60000)} min`);
process.exit(failed.length ? 1 : 0);
