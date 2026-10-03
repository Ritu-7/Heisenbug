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
// On a default Docker Desktop install (Linux or Mac) we let docker pick its
// own context; on the CI runner the CI system sets DOCKER_HOST itself.
const DOCKER_ENV: NodeJS.ProcessEnv = { ...process.env };
// (DOCKER_HOST is inherited from process.env automatically if set)

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

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Extracts [V1:10] or [H3:15] prefix from a test title.
 * Returns null if the title doesn't follow the convention.
 */
function parseTestId(title: string): { id: string; weight: number } | null {
  const m = title.match(/^\[([A-Z]\d+):(\d+)\]/);
  if (!m) return null;
  return { id: m[1], weight: parseInt(m[2], 10) };
}

/**
 * Parses Jest --json stdout into a RunResult.
 * Jest with --json writes the JSON blob to stdout; non-JSON lines before it
 * (npm notices, warnings) are stripped by finding the first `{`.
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
      const meta = parseTestId(t.title);
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
 * Writes candidate code to a temp file, runs Jest inside a Docker container,
 * returns parsed result.
 *
 * NOTE: Each call starts a fresh container (docker run --rm).
 * Known perf gap: no warm container pool — cold-start adds ~5–10s.
 */
async function runInDocker(opts: {
  image: string;
  candidateCode: string;
  slug: string;
  jestArgs: string[];
  extraVolumes?: string[];
}): Promise<{ result: Omit<RunResult, "rawOutput" | "durationMs">; rawOutput: string }> {
  const { image, candidateCode, jestArgs, extraVolumes = [] } = opts;

  // Write candidate code to a host temp file for volume mounting
  const tmpFile = path.join(os.tmpdir(), `heisenbug-${Date.now()}-charge.js`);
  fs.writeFileSync(tmpFile, candidateCode, "utf-8");

  try {
    const dockerArgs = [
      "run", "--rm",
      "--network", "none",           // no network access inside container
      "--memory", "256m",            // memory cap
      "--cpus", "0.5",               // CPU cap
      "-v", `${tmpFile}:/app/src/charge.js:ro`,
      ...extraVolumes.flatMap(v => ["-v", v]),
      image,
      "sh", "-c",
      // 2>/dev/null suppresses Jest's progress output; JSON goes to stdout
      `cd /app && npx jest ${jestArgs.join(" ")} --json --no-coverage --forceExit 2>/dev/null`,
    ];

    const t0 = Date.now();
    let stdout = "";
    let stderr = "";
    try {
      const out = await execFileAsync("docker", dockerArgs, {
        timeout: 120_000,
        env: DOCKER_ENV,
        maxBuffer: 10 * 1024 * 1024, // 10 MB
      });
      stdout = out.stdout;
      stderr = out.stderr;
    } catch (err: unknown) {
      // Jest exits with code 1 when tests fail — execFileAsync throws.
      // We still want to parse the JSON output.
      const e = err as { stdout?: string; stderr?: string; code?: number };
      stdout = e.stdout ?? "";
      stderr = e.stderr ?? "";
      if (!stdout && !stderr) throw err;
    }

    const rawOutput = (stdout + "\n" + stderr).trim();
    const result = parseJestJson(stdout || stderr);
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
 * Runs the candidate's current saved code against the VISIBLE test suite
 * inside a fresh session-runner container. No hidden tests involved.
 *
 * KNOWN PERF GAP: no warm container pool — first run adds ~5–10s cold-start.
 * Results are returned directly (no queue/polling needed at current scale).
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

  // Record a RUN_STARTED event
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
      jestArgs: [`--testPathPattern="tests/visible"`],
    });

    rawOutput = raw;
    const durationMs = Date.now() - t0;

    // Record RUN_COMPLETED event with result
    await prisma.sessionEvent.create({
      data: {
        sessionId: id,
        occurredAt: new Date(),
        type: "RUN_COMPLETED",
        // Double cast via unknown is required because custom interface arrays (VerdictCheck[]) don't automatically overlap Prisma's recursive InputJsonValue index signature
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
 * Runs the candidate's code against the FULL test suite (visible + hidden)
 * inside a fresh grader-runner container. Hidden tests are mounted from the
 * host — they are NOT present in the grader image.
 *
 * Saves a real Submission row to Postgres with verdictJson and score.
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

  // Hidden tests path on the HOST (never inside any image)
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
      jestArgs: [], // run all tests (visible + hidden)
      extraVolumes: [
        // Mount hidden tests from HOST into grader container
        // Session runner never receives this volume mount
        `${hiddenTestsHostPath}:/app/tests/hidden:ro`,
      ],
    });

    const durationMs = Date.now() - t0;
    const verdictJson = {
      passed: result.passed,
      score:  result.score,
      checks: result.checks,
    };

    // Compute a real unified diff between starter code and candidate submission.
    // createPatch(filename, oldStr, newStr, oldHeader, newHeader) → unified diff string
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

    // Save real Submission row to Postgres
    const submission = await prisma.submission.create({
      data: {
        sessionId: id,
        diffText,
        // Double cast via unknown is required because custom interface arrays (VerdictCheck[]) don't automatically overlap Prisma's recursive InputJsonValue index signature
        verdictJson: verdictJson as unknown as Prisma.InputJsonObject,
        score: result.score,
      },
    });

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
