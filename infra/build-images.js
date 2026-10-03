'use strict';

// infra/build-images.js — Dynamically builds Docker images for all problem packs.
//
// Scans packages/problems/*/meta.json to discover problem slugs.
// For each slug with matching Dockerfiles in infra/docker/:
//   - infra/docker/session-runner-<slug>.Dockerfile -> heisenbug-session-runner-<slug>:latest
//   - infra/docker/grader-runner-<slug>.Dockerfile -> heisenbug-grader-runner-<slug>:latest
//
// Runs docker build with { ...process.env } (respects DOCKER_HOST if explicitly set by operator).

const { execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');

const execFileAsync = promisify(execFile);

const MONOREPO_ROOT = path.resolve(__dirname, '..');
const PROBLEMS_DIR  = path.join(MONOREPO_ROOT, 'packages', 'problems');
const DOCKER_DIR    = path.join(MONOREPO_ROOT, 'infra', 'docker');

function discoverProblems() {
  const problems = [];
  if (!fs.existsSync(PROBLEMS_DIR)) return problems;

  const entries = fs.readdirSync(PROBLEMS_DIR, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const slug = entry.name;
    const metaPath = path.join(PROBLEMS_DIR, slug, 'meta.json');
    if (!fs.existsSync(metaPath)) continue;

    const sessionDockerfile = path.join(DOCKER_DIR, `session-runner-${slug}.Dockerfile`);
    const graderDockerfile  = path.join(DOCKER_DIR, `grader-runner-${slug}.Dockerfile`);

    if (fs.existsSync(sessionDockerfile) && fs.existsSync(graderDockerfile)) {
      problems.push({
        slug,
        sessionImage: `heisenbug-session-runner-${slug}:latest`,
        sessionDockerfile: path.relative(MONOREPO_ROOT, sessionDockerfile),
        graderImage: `heisenbug-grader-runner-${slug}:latest`,
        graderDockerfile: path.relative(MONOREPO_ROOT, graderDockerfile),
      });
    }
  }

  return problems;
}

async function main() {
  console.log('Discovering problem packs for Docker image builds...\n');

  const problems = discoverProblems();
  if (problems.length === 0) {
    console.log('No problem packs with matching Dockerfiles found in infra/docker/.');
    return;
  }

  console.log(`Found ${problems.length} problem pack(s): ${problems.map(p => p.slug).join(', ')}\n`);

  for (const p of problems) {
    const targets = [
      { tag: p.sessionImage, dockerfile: p.sessionDockerfile },
      { tag: p.graderImage, dockerfile: p.graderDockerfile },
    ];

    for (const { tag, dockerfile } of targets) {
      console.log(`\x1b[34m→\x1b[0m Building ${tag}`);
      console.log(`  Dockerfile: ${dockerfile}`);
      const t0 = Date.now();

      try {
        const { stdout, stderr } = await execFileAsync('docker', [
          'build', '-f', dockerfile, '-t', tag, '.',
        ], {
          cwd: MONOREPO_ROOT,
          env: { ...process.env },
          timeout: 300_000,
          maxBuffer: 50 * 1024 * 1024,
        });

        const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
        console.log(`  \x1b[32m✓\x1b[0m Built in ${elapsed}s`);

        const combined = (stdout + stderr).trim().split('\n');
        const isolationLine = combined.filter(l => l.includes('ISOLATION') || l.includes('Mount point')).pop();
        if (isolationLine) console.log(`  ${isolationLine.trim()}`);
      } catch (err) {
        const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
        console.error(`  \x1b[31m✗\x1b[0m FAILED after ${elapsed}s`);
        const msg = (err.stderr || err.stdout || err.message || String(err)).slice(0, 1500);
        console.error(msg);
        process.exit(1);
      }
    }
  }

  console.log('\n\x1b[32m✓\x1b[0m All discovered Docker images built successfully.');
}

main().catch(err => {
  console.error('\x1b[31mFatal:\x1b[0m', err.message);
  process.exit(1);
});
