import { Router, Request, Response } from "express";
import { execFile, exec } from "child_process";
import { promisify } from "util";
import fs from "fs";
import os from "os";
import path from "path";
import { createPatch } from "diff";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";

const router = Router();
const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);

// ── Config ─────────────────────────────────────────────────────────────────

// Image names are derived from the problem slug — no special-casing needed.
// Each problem gets its own pair of images built at `npm run docker:build`.
const sessionImage = (slug: string) => `heisenbug-session-runner-${slug}:latest`;
const graderImage  = (slug: string) => `heisenbug-grader-runner-${slug}:latest`;

// Hidden tests live on the HOST — never inside any container image
// routes/ → src/ → api/ → apps/ → monorepo root → packages/problems/…
const MONOREPO_ROOT = path.resolve(__dirname, "../../../../");
const PROBLEMS_ROOT = path.resolve(MONOREPO_ROOT, "packages/problems");
const SANDBOX_ROOT  = path.resolve(MONOREPO_ROOT, ".sandbox");

// Pass DOCKER_HOST through only if the operator has explicitly set it in
// their environment (e.g. a non-standard socket path or a remote daemon).
const DOCKER_ENV: NodeJS.ProcessEnv = { ...process.env };

// ── Types ──────────────────────────────────────────────────────────────────

interface VerdictCheck {
  id: string;
  weight: number;
  passed: boolean;
  message?: string;
}

interface RunResult {
  passed: boolean;
  score: number;
  checks: VerdictCheck[];
  rawOutput: string;
  durationMs: number;
}

interface ProblemMeta {
  slug: string;
  title: string;
  version: number;
  entryFile: string;
  language: string;
  testFramework: "jest" | "pytest";
  testCommand: string;
  files: Array<{ path: string; editable: boolean; label: string }>;
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** Load problem metadata from packages/problems/<slug>/meta.json */
function loadProblemMeta(slug: string): ProblemMeta {
  const metaPath = path.join(PROBLEMS_ROOT, slug, "meta.json");
  if (fs.existsSync(metaPath)) {
    try {
      const raw = fs.readFileSync(metaPath, "utf-8");
      const data = JSON.parse(raw);
      return {
        slug: data.slug ?? slug,
        title: data.title ?? "",
        version: data.version ?? 1,
        entryFile: data.entryFile ?? "src/charge.js",
        language: data.language ?? "javascript",
        testFramework: data.testFramework ?? "jest",
        testCommand: data.testCommand ?? "npx jest --json --no-coverage --forceExit",
        files: data.files ?? [],
      };
    } catch { /* ignore parse error, fallback to defaults */ }
  }
  return {
    slug,
    title: "",
    version: 1,
    entryFile: "src/charge.js",
    language: "javascript",
    testFramework: "jest",
    testCommand: "npx jest --json --no-coverage --forceExit",
    files: [],
  };
}

/**
 * Extracts a complete JSON object substring from raw stdout/stderr
 * ignoring any preceding or trailing text (such as Jest or Pytest logs).
 */
function extractJsonObject(raw: string): string | null {
  const start = raw.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < raw.length; i++) {
    const ch = raw[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\") {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (!inString) {
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          return raw.slice(start, i + 1);
        }
      }
    }
  }
  return null;
}

/**
 * JEST TEST ID CONVENTION:
 * Extracts [V1:10] or [H3:15] prefix from a Jest test title.
 * Example: "PAY-482 [V1:10] Returns 400 if header missing" -> id: "V1", weight: 10
 */
function parseJestTestId(title: string): { id: string; weight: number } | null {
  const m = title.match(/^\[([A-Z]\d+):(\d+)\]/);
  if (!m) return null;
  return { id: m[1], weight: parseInt(m[2], 10) };
}

/**
 * Parses Jest --json stdout into a normalized result shape.
 */
function parseJestJson(raw: string): Omit<RunResult, "rawOutput" | "durationMs"> {
  const jsonStr = extractJsonObject(raw);
  if (!jsonStr) {
    throw new Error(`Jest produced no JSON output.\nRaw:\n${raw.slice(0, 2000)}`);
  }

  let jestData: {
    success: boolean;
    testResults: Array<{
      name?: string;
      assertionResults?: Array<{
        title: string;
        status: "passed" | "failed" | "pending" | "todo";
        failureMessages: string[];
      }>;
    }>;
  };

  try {
    jestData = JSON.parse(jsonStr);
  } catch (e) {
    throw new Error(`Failed to parse Jest JSON: ${(e as Error).message}\nRaw slice:\n${jsonStr.slice(0, 500)}`);
  }

  const checks: VerdictCheck[] = [];
  let score = 0;

  for (const fileResult of jestData.testResults ?? []) {
    const assertions = fileResult.assertionResults ?? [];
    for (const t of assertions) {
      const meta = parseJestTestId(t.title);
      if (!meta) continue; // skip tests without ID prefix

      const passed = t.status === "passed";
      if (passed) score += meta.weight;

      checks.push({
        id:      meta.id,
        weight:  meta.weight,
        passed,
        message: passed
          ? undefined
          : (t.failureMessages[0] ?? "Test failed").split("\n")[0].trim(),
      });
    }
  }

  return { passed: jestData.success, score, checks };
}

/**
 * PYTEST OUTPUT DESTINATION CONVENTION:
 * Pytest with `pytest-json-report` plugin writes report JSON to a file by default.
 * To ensure structured JSON is piped directly to stdout for parsing, problem testCommand
 * configurations for pytest MUST specify `--json-report --json-report-file=/dev/stdout` or
 * `--json-report --json-report-file=.report.json && cat .report.json`.
 *
 * Example testCommand in meta.json for Python/pytest problems:
 *   "pytest --json-report --json-report-file=/dev/stdout"
 *
 * PYTEST TEST ID CONVENTION:
 * Pytest test function node IDs embed the test ID and weight in their function name or docstring:
 * Matches `test_v1_10_description` or `test_h2_15_concurrent` -> id: "V1", weight: 10
 * Also matches `[V1:10]` embedded in nodeid or test title if docstring/parametrize is used.
 *
 * Examples:
 *   nodeid: "tests/visible/test_purchase.py::test_v1_10_single_purchase" -> id: "V1", weight: 10
 *   nodeid: "tests/hidden/test_race.py::test_h1_25_concurrent" -> id: "H1", weight: 25
 */
function parsePytestTestId(nodeid: string): { id: string; weight: number } | null {
  const m1 = nodeid.match(/test_([vVhH]\d+)_(\d+)/);
  if (m1) {
    return { id: m1[1].toUpperCase(), weight: parseInt(m1[2], 10) };
  }
  const m2 = nodeid.match(/\[([A-Z]\d+):(\d+)\]/);
  if (m2) {
    return { id: m2[1], weight: parseInt(m2[2], 10) };
  }
  return null;
}

/**
 * Parses pytest-json-report structured output into normalized result shape.
 */
function parsePytestJson(raw: string): Omit<RunResult, "rawOutput" | "durationMs"> {
  const jsonStr = extractJsonObject(raw);
  if (!jsonStr) {
    throw new Error(`Pytest produced no JSON report output.\nRaw:\n${raw.slice(0, 2000)}`);
  }

  let pytestData: {
    exitcode?: number;
    summary?: { passed?: number; failed?: number; total?: number };
    tests?: Array<{
      nodeid: string;
      outcome: string;
      call?: {
        longrepr?: string | { crash?: { message?: string } };
      };
    }>;
  };

  try {
    pytestData = JSON.parse(jsonStr);
  } catch (e) {
    throw new Error(`Failed to parse Pytest JSON: ${(e as Error).message}\nRaw slice:\n${raw.slice(0, 500)}`);
  }

  const checks: VerdictCheck[] = [];
  let score = 0;
  let allPassed = (pytestData.exitcode === 0);

  for (const t of pytestData.tests ?? []) {
    const meta = parsePytestTestId(t.nodeid);
    if (!meta) continue;

    const passed = t.outcome === "passed";
    if (passed) {
      score += meta.weight;
    } else {
      allPassed = false;
    }

    let failureMessage: string | undefined = undefined;
    if (!passed && t.call?.longrepr) {
      if (typeof t.call.longrepr === "string") {
        failureMessage = t.call.longrepr.split("\n").filter((l) => l.trim().length > 0).pop()?.trim();
      } else if (typeof t.call.longrepr === "object" && t.call.longrepr?.crash?.message) {
        failureMessage = t.call.longrepr.crash.message;
      }
    }

    checks.push({
      id: meta.id,
      weight: meta.weight,
      passed,
      message: failureMessage ?? (passed ? undefined : "Test failed"),
    });
  }

  return { passed: allPassed, score, checks };
}

/**
 * Dynamic Docker availability check.
 * Caches result for 30s to avoid repeated daemon probes.
 */
let cachedDockerAvailable: boolean | null = null;
let lastDockerCheckTime = 0;

export async function isDockerAvailable(): Promise<boolean> {
  const now = Date.now();
  if (cachedDockerAvailable !== null && now - lastDockerCheckTime < 30_000) {
    return cachedDockerAvailable;
  }
  try {
    await execFileAsync("docker", ["info"], { timeout: 2000 });
    cachedDockerAvailable = true;
  } catch {
    cachedDockerAvailable = false;
  }
  lastDockerCheckTime = now;
  return cachedDockerAvailable;
}

/** Testing helper to simulate Docker availability states */
export function setDockerAvailableForTesting(available: boolean | null): void {
  cachedDockerAvailable = available;
  lastDockerCheckTime = available !== null ? Date.now() + 3_600_000 : 0;
}

/**
 * Framework-agnostic Docker runner.
 * Reads meta.json for the given slug to determine entryFile, testCommand, and testFramework,
 * constructs framework-specific scope flags, volume-mounts candidate code to `/app/${meta.entryFile}`,
 * executes inside Docker, and parses output using the appropriate framework parser.
 */
async function runInDocker(opts: {
  image: string;
  candidateCode: string;
  slug: string;
  testScope: "visible" | "all";
  extraVolumes?: string[];
}): Promise<{ result: Omit<RunResult, "rawOutput" | "durationMs">; rawOutput: string }> {
  const { image, candidateCode, slug, testScope, extraVolumes = [] } = opts;
  const meta = loadProblemMeta(slug);

  // Write candidate code to host temp file for mounting
  const tmpFile = path.join(os.tmpdir(), `heisenbug-${Date.now()}-entry`);
  fs.writeFileSync(tmpFile, candidateCode, "utf-8");

  try {
    let frameworkCmd = "";
    if (meta.testFramework === "jest") {
      const scopeFlag = testScope === "visible" ? `tests/visible` : `tests`;
      frameworkCmd = `${meta.testCommand} ${scopeFlag}`.trim();
    } else if (meta.testFramework === "pytest") {
      const scopeFlag = testScope === "visible" ? `tests/visible` : `tests`;
      frameworkCmd = `${meta.testCommand} ${scopeFlag}`.trim();
    } else {
      throw new Error(`Unsupported test framework '${meta.testFramework}'`);
    }

    const dockerArgs = [
      "run", "--rm",
      "--network", "none",
      "--memory", "256m",
      "--cpus", "0.5",
      "-v", `${tmpFile}:/app/${meta.entryFile}:ro`,
      ...extraVolumes.flatMap((v) => ["-v", v]),
      image,
      "sh", "-c",
      `cd /app && ${frameworkCmd} 2>/dev/null`,
    ];

    let stdout = "";
    let stderr = "";
    try {
      const out = await execFileAsync("docker", dockerArgs, {
        timeout: 60_000,
        env: DOCKER_ENV,
        maxBuffer: 10 * 1024 * 1024,
      });
      stdout = out.stdout;
      stderr = out.stderr;
    } catch (err: unknown) {
      const e = err as { stdout?: string; stderr?: string; code?: number };
      stdout = e.stdout ?? "";
      stderr = e.stderr ?? "";
      if (!stdout && !stderr) throw err;
    }

    const rawOutput = (stdout + "\n" + stderr).trim();
    const rawForParse = stdout || stderr;
    const result = meta.testFramework === "pytest"
      ? parsePytestJson(rawForParse)
      : parseJestJson(rawForParse);

    return { result, rawOutput };
  } finally {
    try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
  }
}

/**
 * Isolated Native Process Runner (Host Fallback).
 * Runs natively in environments without a Docker daemon (e.g. Render Web Services,
 * local environments with Docker Desktop stopped).
 * Copies the problem pack repository into an isolated workspace directory inside .sandbox/,
 * injects the candidate's code, runs the test runner directly, and cleans up.
 */
async function runNative(opts: {
  candidateCode: string;
  slug: string;
  testScope: "visible" | "all";
}): Promise<{ result: Omit<RunResult, "rawOutput" | "durationMs">; rawOutput: string }> {
  const { candidateCode, slug, testScope } = opts;
  const meta = loadProblemMeta(slug);
  const problemDir = path.join(PROBLEMS_ROOT, slug);
  const repoDir = path.join(problemDir, "repo");

  if (!fs.existsSync(repoDir)) {
    throw new Error(`Problem repository files not found for '${slug}' at ${repoDir}`);
  }

  // Ensure sandbox directory exists inside monorepo to resolve hoisted node_modules
  fs.mkdirSync(SANDBOX_ROOT, { recursive: true });
  const runId = `run-${slug}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const runDir = path.join(SANDBOX_ROOT, runId);

  try {
    // 1. Copy problem repository files
    fs.cpSync(repoDir, runDir, { recursive: true });

    // 2. Write candidate's edited code to entryFile
    const entryFilePath = path.join(runDir, meta.entryFile);
    fs.mkdirSync(path.dirname(entryFilePath), { recursive: true });
    fs.writeFileSync(entryFilePath, candidateCode, "utf-8");

    // 3. For 'all' test scope (submit / grading), copy hidden test files
    if (testScope === "all") {
      const hiddenSrc = path.join(problemDir, "tests", "hidden");
      if (fs.existsSync(hiddenSrc)) {
        const hiddenDst = path.join(runDir, "tests", "hidden");
        fs.mkdirSync(path.dirname(hiddenDst), { recursive: true });
        fs.cpSync(hiddenSrc, hiddenDst, { recursive: true });
      }
    }

    let stdout = "";
    let stderr = "";

    if (meta.testFramework === "jest") {
      const testTarget = testScope === "visible" ? "tests/visible" : "tests";
      const jestCmd = `npx jest ${testTarget} --json --no-coverage --forceExit`;

      try {
        const out = await execAsync(jestCmd, {
          cwd: runDir,
          timeout: 45_000,
          maxBuffer: 10 * 1024 * 1024,
          env: { ...process.env, NODE_ENV: "test" },
        });
        stdout = out.stdout;
        stderr = out.stderr;
      } catch (err: any) {
        stdout = err.stdout ?? "";
        stderr = err.stderr ?? "";
        if (!stdout && !stderr) {
          throw new Error(`Jest runner execution failed: ${err.message}`);
        }
      }

      const rawForParse = (stdout + "\n" + stderr).trim();
      const result = parseJestJson(rawForParse);
      return { result, rawOutput: rawForParse };
    } else if (meta.testFramework === "pytest") {
      const testTarget = testScope === "visible" ? "tests/visible" : "tests";
      const pytestCmd = `pytest ${testTarget} --json-report --json-report-file=/dev/stdout -q`;

      try {
        const out = await execAsync(pytestCmd, {
          cwd: runDir,
          timeout: 45_000,
          maxBuffer: 10 * 1024 * 1024,
          env: { ...process.env },
        });
        stdout = out.stdout;
        stderr = out.stderr;
      } catch (err: any) {
        stdout = err.stdout ?? "";
        stderr = err.stderr ?? "";
        if (!stdout && !stderr) {
          throw new Error(`Pytest runner execution failed (is Python 3 / pytest installed?): ${err.message}`);
        }
      }

      const rawForParse = stdout || stderr;
      const result = parsePytestJson(rawForParse);
      return { result, rawOutput: rawForParse };
    } else {
      throw new Error(`Unsupported test framework '${meta.testFramework}'`);
    }
  } finally {
    try {
      fs.rmSync(runDir, { recursive: true, force: true });
    } catch {
      /* ignore cleanup error */
    }
  }
}

export class IsolationUnavailableError extends Error {
  public readonly code = "SUBMISSION_ISOLATION_UNAVAILABLE";
  constructor(message: string, public readonly originalError?: Error) {
    super(message);
    this.name = "IsolationUnavailableError";
  }
}

/**
 * Unified Test Execution Dispatcher.
 * Uses Docker sandbox if available; falls back gracefully to native execution for non-isolated runs (e.g. visible tests).
 * When isolated grading is required (Submit / testScope: "all"), native fallback is strictly disabled and throws IsolationUnavailableError.
 */
export async function executeRunner(opts: {
  image: string;
  candidateCode: string;
  slug: string;
  testScope: "visible" | "all";
  extraVolumes?: string[];
  allowNativeFallback?: boolean;
}): Promise<{ result: Omit<RunResult, "rawOutput" | "durationMs">; rawOutput: string; executionMode: "DOCKER" | "NATIVE_UNISOLATED" }> {
  const allowNative = opts.allowNativeFallback ?? (opts.testScope === "visible");
  const dockerOk = await isDockerAvailable();
  if (dockerOk) {
    try {
      const dockerRes = await runInDocker(opts);
      return { ...dockerRes, executionMode: "DOCKER" };
    } catch (dockerErr) {
      if (!allowNative) {
        throw new IsolationUnavailableError(
          `Docker execution failed during isolated grading: ${(dockerErr as Error).message}`,
          dockerErr as Error
        );
      }
      console.warn(`[runner] Docker execution failed for ${opts.slug}, falling back to native runner:`, (dockerErr as Error).message);
    }
  } else if (!allowNative) {
    throw new IsolationUnavailableError("Docker is unavailable on this host and isolated grading is required.");
  }
  const nativeRes = await runNative(opts);
  return { ...nativeRes, executionMode: "NATIVE_UNISOLATED" };
}

/** Fetch latest CODE_SAVE event code, or read starter code from disk using meta.entryFile. */
async function resolveCode(sessionId: string, slug: string): Promise<string> {
  const latest = await prisma.sessionEvent.findFirst({
    where: { sessionId, type: "CODE_SAVE" },
    orderBy: { occurredAt: "desc" },
  });

  if (latest) {
    const payload = latest.payloadJson as { code?: string };
    if (payload?.code) return payload.code;
  }

  // Fall back to starter code on disk using meta.entryFile
  const meta = loadProblemMeta(slug);
  const starterPath = path.join(PROBLEMS_ROOT, slug, "repo", meta.entryFile);
  if (fs.existsSync(starterPath)) return fs.readFileSync(starterPath, "utf-8");

  throw new Error(`No saved code and no starter code found for '${slug}' at ${starterPath}`);
}

// ── Routes ─────────────────────────────────────────────────────────────────

/**
 * GET /api/sessions/execution-mode
 * Returns the current runtime execution environment mode ("DOCKER" vs "NATIVE_UNISOLATED").
 */
router.get("/execution-mode", async (_req: Request, res: Response): Promise<void> => {
  const dockerOk = await isDockerAvailable();
  res.json({
    ok: true,
    data: {
      executionMode: dockerOk ? "DOCKER" : "NATIVE_UNISOLATED",
      dockerAvailable: dockerOk,
      submitAllowed: dockerOk,
    },
  });
});

/**
 * POST /api/sessions/:id/run
 *
 * Runs candidate's code against VISIBLE test suite.
 */
router.post("/:id/run", requireAuth, async (req: Request<{ id: string }>, res: Response): Promise<void> => {
  const { id } = req.params;
  const userId = req.user!.sub;

  const session = await prisma.session.findUnique({
    where: { id },
    select: {
      userId: true,
      status: true,
      version: { select: { problem: { select: { slug: true } } } },
    },
  });

  if (!session) {
    res.status(404).json({ ok: false, error: `Session '${id}' not found` });
    return;
  }

  // Authorize by userId or verified email
  let isAuthorized = session.userId === userId || req.user!.role === "ADMIN";
  if (!isAuthorized && req.user?.email) {
    const dbUser = await prisma.user.findUnique({ where: { email: req.user.email } });
    if (dbUser && dbUser.id === session.userId) {
      isAuthorized = true;
    }
  }
  if (!isAuthorized) {
    res.status(403).json({ ok: false, error: "Forbidden: you do not own this session" });
    return;
  }

  const slug = session.version?.problem?.slug ?? "be-idempotency-001";

  let candidateCode: string;
  try {
    candidateCode = await resolveCode(id, slug);
  } catch (e) {
    res.status(422).json({ ok: false, error: (e as Error).message });
    return;
  }

  // Record RUN_STARTED event
  await prisma.sessionEvent.create({
    data: {
      sessionId: id,
      occurredAt: new Date(),
      type: "RUN_STARTED",
      payloadJson: { triggeredBy: userId },
    },
  });

  const t0 = Date.now();
  let rawOutput = "";

  try {
    const { result, rawOutput: raw, executionMode } = await executeRunner({
      image: sessionImage(slug),
      candidateCode,
      slug,
      testScope: "visible",
    });

    rawOutput = raw;
    const durationMs = Date.now() - t0;

    // Record RUN_COMPLETED event with result and executionMode
    await prisma.sessionEvent.create({
      data: {
        sessionId: id,
        occurredAt: new Date(),
        type: "RUN_COMPLETED",
        payloadJson: {
          durationMs,
          score: result.score,
          passed: result.passed,
          checks: result.checks,
          executionMode,
        } as unknown as Prisma.InputJsonObject,
      },
    });

    res.json({
      ok: true,
      data: { ...result, rawOutput, durationMs, executionMode },
    });
  } catch (err: any) {
    rawOutput = err.message || "Test runner failed";
    console.error(`[run:${id}] Test runner execution error:`, {
      message: err.message,
      stack: err.stack,
      code: err.code,
      stderr: err.stderr,
      stdout: err.stdout,
    });
    res.status(500).json({
      ok: false,
      error: `Test runner failed: ${err.message}`,
      detail: (err.stderr || err.stdout || err.message || "").slice(0, 1000),
    });
  }
});

/**
 * POST /api/sessions/:id/submit
 *
 * Runs candidate's code against FULL test suite (visible + hidden) and grades submission.
 */
router.post("/:id/submit", requireAuth, async (req: Request<{ id: string }>, res: Response): Promise<void> => {
  const { id } = req.params;
  const userId = req.user!.sub;

  const session = await prisma.session.findUnique({
    where: { id },
    select: {
      userId: true,
      status: true,
      version: { select: { problem: { select: { slug: true } } } },
    },
  });

  if (!session) {
    res.status(404).json({ ok: false, error: `Session '${id}' not found` });
    return;
  }

  let isAuthorized = session.userId === userId || req.user!.role === "ADMIN";
  if (!isAuthorized && req.user?.email) {
    const dbUser = await prisma.user.findUnique({ where: { email: req.user.email } });
    if (dbUser && dbUser.id === session.userId) {
      isAuthorized = true;
    }
  }
  if (!isAuthorized) {
    res.status(403).json({ ok: false, error: "Forbidden: you do not own this session" });
    return;
  }

  // Option (a): Submit requires isolated grading in a Docker container.
  // When Docker is unavailable, immediately reject with HTTP 503 rather than running unisolated.
  const dockerAvailable = await isDockerAvailable();
  if (!dockerAvailable) {
    res.status(503).json({
      ok: false,
      error: "SUBMISSION_ISOLATION_UNAVAILABLE",
      message: "Submit requires isolated grading in a Docker container, which is unavailable in this environment. Run visible tests or run Heisenbug locally with Docker.",
      executionMode: "NATIVE_UNISOLATED",
    });
    return;
  }

  const slug = session.version?.problem?.slug ?? "be-idempotency-001";
  const meta = loadProblemMeta(slug);

  let candidateCode: string;
  try {
    candidateCode = await resolveCode(id, slug);
  } catch (e) {
    res.status(422).json({ ok: false, error: (e as Error).message });
    return;
  }

  // Hidden tests path on the HOST
  const hiddenTestsHostPath = path.join(PROBLEMS_ROOT, slug, "tests", "hidden");
  if (!fs.existsSync(hiddenTestsHostPath)) {
    res.status(500).json({ ok: false, error: `Hidden tests not found for '${slug}'` });
    return;
  }

  const t0 = Date.now();

  try {
    const { result, rawOutput } = await executeRunner({
      image: graderImage(slug),
      candidateCode,
      slug,
      testScope: "all",
      allowNativeFallback: false,
      extraVolumes: [
        `${hiddenTestsHostPath}:/app/tests/hidden:ro`,
      ],
    });

    const durationMs = Date.now() - t0;
    const verdictJson = {
      passed: result.passed,
      score:  result.score,
      checks: result.checks,
      executionMode: "DOCKER" as const,
    };

    // Compute real unified diff using meta.entryFile
    const starterPath = path.join(PROBLEMS_ROOT, slug, "repo", meta.entryFile);
    const starterCode = fs.existsSync(starterPath)
      ? fs.readFileSync(starterPath, "utf-8")
      : "";
    const diffText = createPatch(
      meta.entryFile,
      starterCode,
      candidateCode,
      `a/${meta.entryFile} (starter)`,
      `b/${meta.entryFile} (submission)`,
    );

    const rawConfidence = req.body?.confidencePct;
    const parsedConfidence =
      typeof rawConfidence === "number" && !isNaN(rawConfidence)
        ? Math.max(0, Math.min(100, Math.round(rawConfidence)))
        : typeof rawConfidence === "string" && rawConfidence.trim() !== "" && !isNaN(Number(rawConfidence))
        ? Math.max(0, Math.min(100, Math.round(Number(rawConfidence))))
        : null;

    // Save Submission row to Postgres, record SUBMIT event, and mark session as SUBMITTED
    const [submission] = await prisma.$transaction([
      prisma.submission.create({
        data: {
          sessionId: id,
          verdictJson: verdictJson as unknown as Prisma.InputJsonObject,
          diffText,
          score: result.score,
          confidencePct: parsedConfidence,
          executionMode: "DOCKER",
        },
      }),
      prisma.session.update({
        where: { id },
        data: { status: "SUBMITTED" },
      }),
      prisma.sessionEvent.create({
        data: {
          sessionId: id,
          occurredAt: new Date(),
          type: "SUBMIT",
          payloadJson: {
            score: result.score,
            passed: result.passed,
            checks: result.checks,
            durationMs,
            confidencePct: parsedConfidence,
            executionMode: "DOCKER",
          } as unknown as Prisma.InputJsonObject,
        },
      }),
    ]);

    res.json({
      ok: true,
      data: {
        submission,
        verdict: verdictJson,
        rawOutput,
        durationMs,
        executionMode: "DOCKER",
      },
    });
  } catch (err: any) {
    if (err instanceof IsolationUnavailableError || err.code === "SUBMISSION_ISOLATION_UNAVAILABLE") {
      res.status(503).json({
        ok: false,
        error: "SUBMISSION_ISOLATION_UNAVAILABLE",
        message: "Submit requires isolated grading in a Docker container, which failed during execution. Try again or run locally.",
        detail: (err.originalError?.message || err.message || "").slice(0, 1000),
        executionMode: "NATIVE_UNISOLATED",
      });
      return;
    }
    console.error(`[submit:${id}] Grader execution error:`, {
      message: err.message,
      stack: err.stack,
      code: err.code,
      stderr: err.stderr,
      stdout: err.stdout,
    });
    res.status(500).json({
      ok: false,
      error: `Grader failed: ${err.message}`,
      detail: (err.stderr || err.stdout || err.message || "").slice(0, 1000),
    });
  }
});

export default router;
