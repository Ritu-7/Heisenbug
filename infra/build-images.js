#!/usr/bin/env node
/**
 * build-images.js — Builds all 4 Heisenbug Docker images.
 *
 * Polls until a Docker named pipe accepts connections before building.
 * This handles the Windows Docker Desktop named-pipe ephemerality issue.
 *
 * Run from monorepo root: node infra/build-images.js
 */
'use strict';

const { execFile, execFileSync } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);

const IMAGES = [
  {
    tag: 'heisenbug-session-runner-be-idempotency-001:latest',
    dockerfile: 'infra/docker/session-runner-be-idempotency-001.Dockerfile',
  },
  {
    tag: 'heisenbug-grader-runner-be-idempotency-001:latest',
    dockerfile: 'infra/docker/grader-runner-be-idempotency-001.Dockerfile',
  },
  {
    tag: 'heisenbug-session-runner-be-race-002:latest',
    dockerfile: 'infra/docker/session-runner-be-race-002.Dockerfile',
  },
  {
    tag: 'heisenbug-grader-runner-be-race-002:latest',
    dockerfile: 'infra/docker/grader-runner-be-race-002.Dockerfile',
  },
];

const PIPE_CANDIDATES = [
  'npipe:////./pipe/dockerDesktopLinuxEngine',
  'npipe:////./pipe/docker_engine',
  'npipe:////./pipe/dockerDesktopEngine',
];
const TIMEOUT_MS = 120_000;
const POLL_MS    = 3_000;

async function probe(host) {
  try {
    await execFileAsync('docker', ['ps', '--format', '{{.ID}}'], {
      env: { ...process.env, DOCKER_HOST: host },
      timeout: 4000,
    });
    return true;
  } catch { return false; }
}

async function waitForDocker() {
  // Try waking the WSL backend first
  try {
    execFileSync('wsl', ['-d', 'docker-desktop', '-u', 'root', '--', 'echo', 'wsl-alive'], {
      timeout: 10000, stdio: ['ignore', 'ignore', 'ignore'],
    });
  } catch { /* ok */ }

  process.stderr.write('Waiting for Docker Desktop');
  const start = Date.now();
  while (Date.now() - start < TIMEOUT_MS) {
    for (const host of PIPE_CANDIDATES) {
      if (await probe(host)) {
        process.stderr.write(` ✓ (${host})\n`);
        return host;
      }
    }
    process.stderr.write('.');
    await new Promise(r => setTimeout(r, POLL_MS));
  }
  throw new Error('Docker Desktop did not become ready within 120s');
}

async function main() {
  console.log('Building all Heisenbug Docker images...\n');

  const dockerHost = await waitForDocker();
  const dockerEnv = { ...process.env, DOCKER_HOST: dockerHost };

  console.log();
  for (const { tag, dockerfile } of IMAGES) {
    console.log(`\x1b[34m→\x1b[0m ${tag}`);
    const t0 = Date.now();
    try {
      const { stdout, stderr } = await execFileAsync('docker', [
        'build', '-f', dockerfile, '-t', tag, '.',
      ], {
        cwd: process.cwd(),
        env: dockerEnv,
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

  console.log('\n\x1b[32m✓\x1b[0m All 4 images built successfully.');
}

main().catch(err => {
  console.error('\x1b[31mFatal:\x1b[0m', err.message);
  process.exit(1);
});
