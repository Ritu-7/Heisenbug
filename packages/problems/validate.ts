#!/usr/bin/env ts-node
/**
 * packages/problems/validate.ts
 *
 * Validation pipeline for Heisenbug problem packs.
 * Runs 4 real Docker-based checks against a problem pack.
 *
 * Usage:
 *   npx ts-node validate.ts <slug>
 *   npx ts-node validate.ts be-idempotency-001
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import os from 'os';

const execFileAsync = promisify(execFile);

// ── Config ──────────────────────────────────────────────────────────────────

// Image names are derived from slug — must match what npm run docker:build produces.
// No hardcoded DOCKER_HOST — respect the operator's environment.
const sessionImageFor = (slug: string) => `heisenbug-session-runner-${slug}:latest`;
const graderImageFor  = (slug: string) => `heisenbug-grader-runner-${slug}:latest`;
const TIMEOUT_MS     = 120_000;
const CONSISTENCY_RUNS = 5;



// ── ANSI colors ──────────────────────────────────────────────────────────────

const G  = '\x1b[32m'; // green
const R  = '\x1b[31m'; // red
const Y  = '\x1b[33m'; // yellow
const B  = '\x1b[34m'; // blue
const CY = '\x1b[36m'; // cyan
const DM = '\x1b[2m';  // dim
const BD = '\x1b[1m';  // bold
const RS = '\x1b[0m';  // reset

function ok(msg: string)   { console.log(`    ${G}✓${RS} ${msg}`); }
function ng(msg: string)   { console.log(`    ${R}✗${RS} ${msg}`); }
function arrow(msg: string){ console.log(`    ${B}→${RS} ${msg}`); }
function hr(char = '─')    { console.log(`  ${DM}${''.padEnd(60, char)}${RS}`); }

// ── Types ────────────────────────────────────────────────────────────────────

interface VerdictCheck {
  id:      string;
  weight:  number;
  passed:  boolean;
  message?: string;
}

interface GraderResult {
  passed: boolean;
  score:  number;
  checks: VerdictCheck[];
}

// ── Grader core ──────────────────────────────────────────────────────────────

function parseJestJson(raw: string): GraderResult {
  const start = raw.indexOf('{');
  if (start === -1) {
    throw new Error(`Jest produced no JSON.\nRaw output (first 600):\n${raw.slice(0, 600)}`);
  }

  let jestData: {
    success: boolean;
    testResults: Array<{
      assertionResults?: Array<{
        title:           string;
        status:          string;
        failureMessages: string[];
      }>;
    }>;
  };

  try {
    jestData = JSON.parse(raw.slice(start));
  } catch (e) {
    throw new Error(
      `Failed to parse Jest JSON: ${(e as Error).message}\n` +
      `Slice: ${raw.slice(start, start + 400)}`
    );
  }

  const checks: VerdictCheck[] = [];
  let score = 0;

  for (const fileResult of jestData.testResults ?? []) {
    for (const t of fileResult.assertionResults ?? []) {
      const m = t.title.match(/^\[([A-Z]\d+):(\d+)\]/);
      if (!m) continue;

      const id     = m[1];
      const weight = parseInt(m[2], 10);
      const passed = t.status === 'passed';
      if (passed) score += weight;

      checks.push({
        id, weight, passed,
        message: passed
          ? undefined
          : (t.failureMessages[0] ?? 'Test failed').split('\n')[0].trim(),
      });
    }
  }

  return { passed: jestData.success, score, checks };
}

async function runInDocker(opts: {
  slug:            string;
  candidateCode:   string;
  hiddenTestsPath: string;
  visibleOnly?:    boolean;
}): Promise<GraderResult & { rawOutput: string }> {
  const { slug, candidateCode, hiddenTestsPath, visibleOnly = false } = opts;
  const image = visibleOnly ? sessionImageFor(slug) : graderImageFor(slug);

  // Write candidate code to a host temp file for volume-mounting
  const tmpFile = path.join(os.tmpdir(), `hb-validate-${Date.now()}.js`);
  fs.writeFileSync(tmpFile, candidateCode, 'utf-8');

  const jestCmd = visibleOnly
    ? `npx jest --testPathPattern='tests/visible' --json --no-coverage --forceExit 2>/dev/null`
    : `npx jest --json --no-coverage --forceExit 2>/dev/null`;

  const extraVolumes = visibleOnly
    ? []
    : ['-v', `${hiddenTestsPath}:/app/tests/hidden:ro`];

  const dockerArgs = [
    'run', '--rm',
    '--network', 'none',
    '--memory', '256m',
    '--cpus', '0.5',
    '-v', `${tmpFile}:/app/src/charge.js:ro`,
    ...extraVolumes,
    image,
    'sh', '-c', `cd /app && ${jestCmd}`,
  ];

  let stdout = '', stderr = '';
  try {
    const out = await execFileAsync('docker', dockerArgs, {
      timeout:   TIMEOUT_MS,
      env:       { ...process.env },
      maxBuffer: 10 * 1024 * 1024,
    });
    stdout = out.stdout;
    stderr = out.stderr;
  } catch (err: unknown) {
    // Jest exits with code 1 when tests fail — execFileAsync throws.
    // We still want to parse the JSON in stdout/stderr.
    const e = err as { stdout?: string; stderr?: string };
    stdout = e.stdout ?? '';
    stderr = e.stderr ?? '';
    if (!stdout && !stderr) throw err;
  } finally {
    try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
  }

  const raw = stdout || stderr;
  const result = parseJestJson(raw);
  return { ...result, rawOutput: raw };
}

function printChecks(checks: VerdictCheck[]) {
  for (const c of checks) {
    const tag    = c.passed ? `${G}PASS${RS}` : `${R}FAIL${RS}`;
    const detail = !c.passed && c.message ? `  ${DM}← ${c.message}${RS}` : '';
    arrow(`[${c.id}:${c.weight}pts] ${tag}${detail}`);
  }
}

// ── Check functions ──────────────────────────────────────────────────────────

async function check1_StarterFailsHidden(
  slug: string,
  starterCode: string,
  hiddenTestsPath: string,
): Promise<boolean> {
  console.log(`\n  ${BD}${B}CHECK 1${RS}  Starter code — hidden tests must genuinely fail`);
  hr();
  arrow('Running full suite (visible + hidden) against unmodified starter code...');

  const r = await runInDocker({ slug, candidateCode: starterCode, hiddenTestsPath });
  printChecks(r.checks);

  const hiddenFailed   = r.checks.filter(c => c.id.startsWith('H') && !c.passed);
  const hiddenTotal    = r.checks.filter(c => c.id.startsWith('H'));

  arrow(`Score on starter: ${r.score}/100`);

  if (hiddenFailed.length === 0) {
    ng(`FAIL — All hidden tests passed on starter code! Hidden suite is too weak.`);
    return false;
  }
  ok(`${hiddenFailed.length}/${hiddenTotal.length} hidden tests correctly FAIL on starter ✓`);
  ok(`Starter score: ${r.score}/100 — well below 100 ✓`);
  return true;
}

async function check2_ReferencePassesAll(
  slug: string,
  referenceCode: string,
  hiddenTestsPath: string,
): Promise<boolean> {
  console.log(`\n  ${BD}${B}CHECK 2${RS}  Reference solution — must score 100/100`);
  hr();
  arrow('Running full suite (visible + hidden) against reference solution...');

  const r = await runInDocker({ slug, candidateCode: referenceCode, hiddenTestsPath });
  printChecks(r.checks);

  arrow(`Reference score: ${r.score}/100`);

  if (r.score !== 100 || !r.passed) {
    const failed = r.checks.filter(c => !c.passed);
    ng(`FAIL — Reference solution scored ${r.score}/100, expected 100/100.`);
    for (const f of failed) ng(`  [${f.id}] ${f.message ?? '(no message)'}`);
    return false;
  }
  ok(`Reference solution scored 100/100 ✓`);
  return true;
}

async function check3_GraderConsistency(
  slug: string,
  referenceCode: string,
  hiddenTestsPath: string,
): Promise<boolean> {
  console.log(`\n  ${BD}${B}CHECK 3${RS}  Grader consistency — ${CONSISTENCY_RUNS} runs of reference solution`);
  hr();
  arrow(`Running grader ${CONSISTENCY_RUNS}× against reference solution...`);

  const scores: number[] = [];
  for (let i = 1; i <= CONSISTENCY_RUNS; i++) {
    const r = await runInDocker({ slug, candidateCode: referenceCode, hiddenTestsPath });
    scores.push(r.score);
    const scoreStr = r.score === 100 ? `${G}${r.score}${RS}` : `${R}${r.score}${RS}`;
    arrow(`Run ${i}/${CONSISTENCY_RUNS}: score=${scoreStr}/100`);
  }

  const min = Math.min(...scores);
  const max = Math.max(...scores);
  const allSame = scores.every(s => s === scores[0]);

  arrow(`Scores: [${scores.join(', ')}]  min=${min}  max=${max}`);

  if (!allSame) {
    ng(`FAIL — Scores vary across runs! [${scores.join(', ')}]`);
    ng(`Variance: ${max - min} pts — grader is not deterministic.`);
    return false;
  }
  ok(`All ${CONSISTENCY_RUNS} runs returned ${scores[0]}/100 — zero variance ✓`);
  return true;
}

async function check4_BadPatchRejected(
  slug: string,
  badPatchCode: string,
  hiddenTestsPath: string,
): Promise<boolean> {
  console.log(`\n  ${BD}${B}CHECK 4${RS}  Bad patch — must pass visible, fail at least one hidden`);
  hr();

  // Step A: visible-only run (what the candidate sees in the session runner)
  arrow('Running visible tests ONLY against bad patch...');
  const visR = await runInDocker({
    slug, candidateCode: badPatchCode, hiddenTestsPath, visibleOnly: true,
  });
  printChecks(visR.checks);
  const visAllPass = visR.checks.every(c => c.passed);
  arrow(`Visible-only score: ${visR.score}/${visR.checks.reduce((s,c) => s+c.weight, 0)}`);

  // Step B: full run (what the grader does on Submit)
  arrow('Running FULL suite (visible + hidden) against bad patch...');
  const fullR = await runInDocker({ slug, candidateCode: badPatchCode, hiddenTestsPath });
  printChecks(fullR.checks);
  const hiddenFailed = fullR.checks.filter(c => c.id.startsWith('H') && !c.passed);
  arrow(`Full score: ${fullR.score}/100`);

  if (!visAllPass) {
    ng(`FAIL — Bad patch did not pass all visible tests.`);
    ng(`       A convincing bad patch must fool the visible suite.`);
    return false;
  }

  if (hiddenFailed.length === 0) {
    ng(`FAIL — Bad patch passed ALL hidden tests — hidden suite does not catch this flaw!`);
    return false;
  }

  ok(`Visible tests: ${visR.checks.length}/${visR.checks.length} passed (bad patch looks convincing) ✓`);
  ok(`Hidden tests caught the flaw: ${hiddenFailed.map(c => c.id).join(', ')} failed ✓`);
  ok(`Bad-patch score: ${fullR.score}/100  vs  reference: 100/100  (delta: ${100 - fullR.score} pts) ✓`);
  return true;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const slug = process.argv[2];
  if (!slug) {
    console.error('Usage: npx ts-node validate.ts <slug>');
    process.exit(1);
  }

  const packDir        = path.join(__dirname, slug);
  const starterPath    = path.join(packDir, 'repo', 'src', 'charge.js');
  const referencePath  = path.join(packDir, 'solutions', 'reference.js');
  const hiddenDir      = path.join(packDir, 'tests', 'hidden');

  // Auto-discover the first .js file in bad_patches/
  const badPatchesDir = path.join(packDir, 'bad_patches');
  const badPatchFiles = fs.existsSync(badPatchesDir)
    ? fs.readdirSync(badPatchesDir).filter(f => f.endsWith('.js'))
    : [];
  const badPatchPath = badPatchFiles.length > 0
    ? path.join(badPatchesDir, badPatchFiles[0])
    : '';

  const sImg = sessionImageFor(slug);
  const gImg = graderImageFor(slug);

  for (const [label, p] of [
    ['Pack dir',          packDir],
    ['Starter code',      starterPath],
    ['Reference solution',referencePath],
    ['Bad patches dir',   badPatchesDir],
    ['Hidden tests dir',  hiddenDir],
  ] as [string, string][]) {
    if (!fs.existsSync(p)) {
      console.error(`${R}Missing:${RS} ${label} — ${p}`);
      process.exit(1);
    }
  }
  if (!badPatchPath) {
    console.error(`${R}Missing:${RS} Bad patch — no .js files found in ${badPatchesDir}`);
    process.exit(1);
  }

  const starterCode    = fs.readFileSync(starterPath, 'utf-8');
  const referenceCode  = fs.readFileSync(referencePath, 'utf-8');
  const badPatchCode   = fs.readFileSync(badPatchPath, 'utf-8');
  const hiddenTestsPath = hiddenDir;

  console.log(`\n${BD}${CY}╔══════════════════════════════════════════════════════════════╗${RS}`);
  console.log(`${BD}${CY}║  Heisenbug — Problem Pack Validation Pipeline                ║${RS}`);
  console.log(`${BD}${CY}╠══════════════════════════════════════════════════════════════╣${RS}`);
  console.log(`${BD}${CY}║  Problem: ${slug.padEnd(51)}║${RS}`);
  console.log(`${BD}${CY}║  Session image: ${sImg.padEnd(45)}║${RS}`);
  console.log(`${BD}${CY}║  Grader image:  ${gImg.padEnd(45)}║${RS}`);
  console.log(`${BD}${CY}║  Bad patch:     ${path.basename(badPatchPath).padEnd(45)}║${RS}`);
  console.log(`${BD}${CY}╚══════════════════════════════════════════════════════════════╝${RS}`);

  const results: Record<string, boolean> = {};

  // Run all 4 checks
  try { results.check1 = await check1_StarterFailsHidden(slug, starterCode, hiddenTestsPath); }
  catch (e) { ng(`Check 1 threw: ${(e as Error).message}`); results.check1 = false; }

  try { results.check2 = await check2_ReferencePassesAll(slug, referenceCode, hiddenTestsPath); }
  catch (e) { ng(`Check 2 threw: ${(e as Error).message}`); results.check2 = false; }

  try { results.check3 = await check3_GraderConsistency(slug, referenceCode, hiddenTestsPath); }
  catch (e) { ng(`Check 3 threw: ${(e as Error).message}`); results.check3 = false; }

  try { results.check4 = await check4_BadPatchRejected(slug, badPatchCode, hiddenTestsPath); }
  catch (e) { ng(`Check 4 threw: ${(e as Error).message}`); results.check4 = false; }

  // Summary
  const passed = Object.values(results).filter(Boolean).length;
  const total  = Object.keys(results).length;

  console.log(`\n  ${BD}${'═'.repeat(62)}${RS}`);
  console.log(`  ${BD}VALIDATION SUMMARY: ${passed}/${total} checks passed${RS}`);
  console.log(`  ${BD}${'═'.repeat(62)}${RS}\n`);

  for (const [name, result] of Object.entries(results)) {
    if (result) ok(`${name}: ${G}PASSED${RS}`);
    else        ng(`${name}: ${R}FAILED${RS}`);
  }

  if (passed < total) {
    console.log(`\n  ${R}${BD}✗  Validation FAILED — fix the checks above before publishing.${RS}\n`);
    process.exit(1);
  } else {
    console.log(`\n  ${G}${BD}✓  Validation PASSED — problem pack is ready for production.${RS}\n`);
    process.exit(0);
  }
}

main().catch(err => {
  console.error(`\n${R}Fatal:${RS}`, err);
  process.exit(1);
});
