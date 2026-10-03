import { Router, Request, Response } from "express";
import { execFile } from "child_process";
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

// ── Config ─────────────────────────────────────────────────────────────────

// Image names are derived from the problem slug — no special-casing needed.
// Each problem gets its own pair of images built at `npm run docker:build`.
const sessionImage = (slug: string) => `heisenbug-session-runner-${slug}:latest`;
const graderImage  = (slug: string) => `heisenbug-grader-runner-${slug}:latest`;

// Hidden tests live on the HOST — never inside any container image
// routes/ → src/ → api/ → apps/ → monorepo root → packages/problems/…
const PROBLEMS_ROOT = path.resolve(__dirname, "../../../../packages/problems");

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
  const start = raw.indexOf("{");
  if (start === -1) {
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
    jestData = JSON.parse(raw.slice(start));
  } catch (e) {
    throw new Error(`Failed to parse Jest JSON: ${(e as Error).message}\nRaw slice:\n${raw.slice(start, start + 500)}`);
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
  const start = raw.indexOf("{");
  if (start === -1) {
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
    pytestData = JSON.parse(raw.slice(start));
  } catch (e) {
    throw new Error(`Failed to parse Pytest JSON: ${(e as Error).message}\nRaw slice:\n${raw.slice(start, start + 500)}`);
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
 * Framework-agnostic Docker runner.
 * Reads meta.json for the given slug to determine testCommand and testFramework,
 * constructs the framework-specific scope flags, executes inside Docker,
 * and parses output using the framework's parser.
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
      const scopeFlag = testScope === "visible" ? `--testPathPattern="tests/visible"` : "";
      frameworkCmd = `${meta.testCommand} ${scopeFlag}`.trim();
    } else if (meta.testFramework === "pytest") {
      const scopeFlag = testScope === "visible" ? `tests/visible` : "";
      frameworkCmd = `${meta.testCommand} ${scopeFlag}`.trim();
    } else {
      throw new Error(`Unsupported test framework '${meta.testFramework}'`);
    }

    const dockerArgs = [
      "run", "--rm",
      "--network", "none",
      "--memory", "256m",
      "--cpus", "0.5",
      "-v", `${tmpFile}:/app/src/charge.js:ro`,
      ...extraVolumes.flatMap((v) => ["-v", v]),
      image,
      "sh", "-c",
      `cd /app && ${frameworkCmd} 2>/dev/null`,
    ];

    let stdout = "";
    let stderr = "";
    try {
      const out = await execFileAsync("docker", dockerArgs, {
        timeout: 120_000,
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

/** Fetch latest CODE_SAVE event code, or read starter code from disk. */
async function resolveCode(sessionId: string, slug: string): Promise<string> {
  const latest = await prisma.sessionEvent.findFirst({
    where: { sessionId, type: "CODE_SAVE" },
    orderBy: { occurredAt: "desc" },
  });

  if (latest) {
    const payload = latest.payloadJson as { code?: string };
    if (payload?.code) return payload.code;
  }

  // Fall back to starter code on disk
  const starterPath = path.join(PROBLEMS_ROOT, slug, "repo", "src", "charge.js");
  if (fs.existsSync(starterPath)) return fs.readFileSync(starterPath, "utf-8");

  throw new Error(`No saved code and no starter code found for '${slug}'`);
}

// ── Routes ─────────────────────────────────────────────────────────────────

/**
 * POST /api/sessions/:id/run
 *
 * Runs candidate's code against VISIBLE test suite inside session-runner container.
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
  if (session.userId !== userId && req.user!.role !== "ADMIN") {
    res.status(403).json({ ok: false, error: "Forbidden" });
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
    const { result, rawOutput: raw } = await runInDocker({
      image: sessionImage(slug),
      candidateCode,
      slug,
      testScope: "visible",
    });

    rawOutput = raw;
    const durationMs = Date.now() - t0;

    // Record RUN_COMPLETED event with result
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
        } as unknown as Prisma.InputJsonObject,
      },
    });

    res.json({
      ok: true,
      data: { ...result, rawOutput, durationMs },
    });
  } catch (err) {
    rawOutput = (err as Error).message;
    res.status(500).json({
      ok: false,
      error: "Test runner failed",
      detail: rawOutput.slice(0, 1000),
    });
  }
});

/**
 * POST /api/sessions/:id/submit
 *
 * Runs candidate's code against FULL test suite (visible + hidden) inside grader-runner container.
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
  if (session.userId !== userId && req.user!.role !== "ADMIN") {
    res.status(403).json({ ok: false, error: "Forbidden" });
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

  // Hidden tests path on the HOST
  const hiddenTestsHostPath = path.join(PROBLEMS_ROOT, slug, "tests", "hidden");
  if (!fs.existsSync(hiddenTestsHostPath)) {
    res.status(500).json({ ok: false, error: `Hidden tests not found for '${slug}'` });
    return;
  }

  const t0 = Date.now();

  try {
    const { result, rawOutput } = await runInDocker({
      image: graderImage(slug),
      candidateCode,
      slug,
      testScope: "all",
      extraVolumes: [
        `${hiddenTestsHostPath}:/app/tests/hidden:ro`,
      ],
    });

    const durationMs = Date.now() - t0;
    const verdictJson = {
      passed: result.passed,
      score:  result.score,
      checks: result.checks,
    };

    // Compute real unified diff
    const starterPath = path.join(PROBLEMS_ROOT, slug, "repo", "src", "charge.js");
    const starterCode = fs.existsSync(starterPath)
      ? fs.readFileSync(starterPath, "utf-8")
      : "";
    const diffText = createPatch(
      "src/charge.js",
      starterCode,
      candidateCode,
      "a/src/charge.js (starter)",
      "b/src/charge.js (submission)",
    );

    // Save Submission row to Postgres and mark session as SUBMITTED
    const [submission] = await prisma.$transaction([
      prisma.submission.create({
        data: {
          sessionId: id,
          verdictJson: verdictJson as unknown as Prisma.InputJsonObject,
          diffText,
          score: result.score,
        },
      }),
      prisma.session.update({
        where: { id },
        data: { status: "SUBMITTED" },
      }),
    ]);

    res.json({
      ok: true,
      data: {
        submission,
        verdict: verdictJson,
        rawOutput,
        durationMs,
      },
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: "Grader failed",
      detail: (err as Error).message.slice(0, 1000),
    });
  }
});

export default router;
