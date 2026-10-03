#!/usr/bin/env node
/**
 * infra/run-docker.js — OS-agnostic wrapper for running docker CLI commands.
 * Inherits process.env directly (respecting operator's DOCKER_HOST if explicitly set).
 *
 * Usage: node infra/run-docker.js <docker args...>
 */
'use strict';

const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('Usage: node infra/run-docker.js <docker args...>');
    process.exit(1);
  }

  try {
    const { stdout, stderr } = await execFileAsync('docker', args, {
      env: { ...process.env },
      timeout: 300_000,
      maxBuffer: 100 * 1024 * 1024,
      cwd: process.cwd(),
    });

    if (stdout) process.stdout.write(stdout);
    if (stderr) process.stderr.write(stderr);
  } catch (err) {
    if (err.stdout) process.stdout.write(err.stdout);
    if (err.stderr) process.stderr.write(err.stderr);
    if (!err.stdout && !err.stderr) {
      console.error(err.message?.slice(0, 500));
    }
    process.exit(err.code ?? 1);
  }
}

main();
