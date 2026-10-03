#!/usr/bin/env node
/**
 * wait-for-docker.js — Polls until a Docker named pipe accepts connections.
 * Exits 0 and prints the working DOCKER_HOST to stdout when ready.
 * Exits 1 if Docker isn't ready within the timeout.
 */
'use strict';

const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);

const PIPES = [
  'npipe:////./pipe/dockerDesktopLinuxEngine',
  'npipe:////./pipe/docker_engine',
  'npipe:////./pipe/dockerDesktopEngine',
];

const TIMEOUT_MS  = 120_000;
const POLL_MS     = 3_000;

async function probe(host) {
  try {
    await execFileAsync('docker', ['ps', '--format', '{{.ID}}'], {
      env: { ...process.env, DOCKER_HOST: host },
      timeout: 4000,
    });
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const start = Date.now();
  process.stderr.write('Waiting for Docker Desktop to be ready');
  while (Date.now() - start < TIMEOUT_MS) {
    for (const host of PIPES) {
      if (await probe(host)) {
        process.stderr.write(' ✓\n');
        console.log(host); // stdout: the working host
        process.exit(0);
      }
    }
    process.stderr.write('.');
    await new Promise(r => setTimeout(r, POLL_MS));
  }
  process.stderr.write(' TIMEOUT\n');
  process.exit(1);
}

main();
