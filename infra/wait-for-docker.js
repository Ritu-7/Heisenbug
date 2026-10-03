#!/usr/bin/env node
/**
 * infra/wait-for-docker.js — OS-agnostic helper to wait until docker CLI is responsive.
 * Uses default docker context (inheriting process.env directly).
 */
'use strict';

const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);

const TIMEOUT_MS = 60_000;
const POLL_MS    = 2_000;

async function probe() {
  try {
    await execFileAsync('docker', ['ps', '--format', '{{.ID}}'], {
      env: { ...process.env },
      timeout: 4000,
    });
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const start = Date.now();
  process.stderr.write('Waiting for Docker daemon to be ready');
  while (Date.now() - start < TIMEOUT_MS) {
    if (await probe()) {
      process.stderr.write(' ✓\n');
      process.exit(0);
    }
    process.stderr.write('.');
    await new Promise(r => setTimeout(r, POLL_MS));
  }
  process.stderr.write(' TIMEOUT\n');
  process.exit(1);
}

main();
