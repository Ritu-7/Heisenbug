#!/usr/bin/env node
/**
 * run-docker.js — Reliably runs a docker command on Windows Docker Desktop.
 *
 * The challenge: Docker Desktop's named pipes are ephemeral — they disappear
 * when Docker Desktop suspends its WSL backend. Using PowerShell &&-chaining
 * loses the context. Even execFile with DOCKER_HOST can race.
 *
 * This script:
 * 1. Checks which Docker pipes currently exist
 * 2. Uses the first available one
 * 3. Runs the docker command via execFile with that explicit DOCKER_HOST
 *
 * Usage: node infra/run-docker.js <docker args...>
 * Example: node infra/run-docker.js build -f ... -t tag .
 */
'use strict';

const { execFile, execFileSync } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);
const fs = require('fs');

const PIPE_CANDIDATES = [
  'npipe:////./pipe/dockerDesktopLinuxEngine',
  'npipe:////./pipe/docker_engine',
  'npipe:////./pipe/dockerDesktopEngine',
];

// Synchronously wake the docker-desktop WSL distro to ensure pipes are alive
function wakeWSL() {
  try {
    execFileSync('wsl', ['-d', 'docker-desktop', '-u', 'root', '--', 'echo', 'wsl-alive'], {
      timeout: 10000,
      stdio: ['ignore', 'ignore', 'ignore'],
    });
  } catch { /* ok if this fails */ }
}

// Test if a docker pipe works by running `docker version`
async function probeHost(host) {
  try {
    await execFileAsync('docker', ['version', '--format', '{{.Server.Version}}'], {
      env: { ...process.env, DOCKER_HOST: host },
      timeout: 5000,
      stdio: 'pipe',
    });
    return true;
  } catch {
    return false;
  }
}

async function findWorkingHost() {
  for (const host of PIPE_CANDIDATES) {
    if (await probeHost(host)) return host;
  }
  return null;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('Usage: node infra/run-docker.js <docker args...>');
    process.exit(1);
  }

  console.log('  Waking Docker Desktop WSL backend...');
  wakeWSL();

  // Give it a moment to stabilize after wakeup
  await new Promise(r => setTimeout(r, 2000));

  const host = await findWorkingHost();
  if (!host) {
    console.error('ERROR: No working Docker host found. Is Docker Desktop running?');
    process.exit(1);
  }
  console.log(`  Docker host: ${host}`);

  const { stdout, stderr } = await execFileAsync('docker', args, {
    env: { ...process.env, DOCKER_HOST: host },
    timeout: 300_000,
    maxBuffer: 100 * 1024 * 1024,
    cwd: process.cwd(),
  });

  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);
}

main().catch(err => {
  // If execFileAsync rejects, stdout/stderr may be on err object (jest exit 1 pattern)
  if (err.stdout) process.stdout.write(err.stdout);
  if (err.stderr) process.stderr.write(err.stderr);
  if (!err.stdout && !err.stderr) {
    console.error(err.message?.slice(0, 500));
    process.exit(1);
  }
  // Exit with same code docker used
  process.exit(err.code ?? 1);
});
