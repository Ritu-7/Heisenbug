import { Router, Request, Response } from "express";
import fs from "fs";
import path from "path";
import { promisify } from "util";
import { execFile } from "child_process";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAuth, requireRole } from "../middleware/auth";
import { generateProblemDraft } from "../services/ai-author";

const execFileAsync = promisify(execFile);
const router = Router();

const MONOREPO_ROOT = path.resolve(__dirname, "../../../../");
const PROBLEMS_ROOT = path.join(MONOREPO_ROOT, "packages", "problems");
const DOCKER_ROOT = path.join(MONOREPO_ROOT, "infra", "docker");

/**
 * GET /api/admin/users
 * Returns list of all registered users with their roles, creation dates,
 * and aggregate activity counts. Strictly ADMIN only.
 */
router.get(
  "/users",
  requireAuth,
  requireRole("ADMIN"),
  async (_req: Request, res: Response): Promise<void> => {
    const users = await prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true,
        _count: {
          select: {
            sessions: true,
            assessments: true,
          },
        },
      },
    });

    res.json({ ok: true, data: users });
  },
);

/**
 * GET /api/admin/problems
 * Lists all problem packs with their versions, status (DRAFT/PUBLISHED), and metadata.
 */
router.get(
  "/problems",
  requireAuth,
  requireRole("AUTHOR", "ADMIN"),
  async (_req: Request, res: Response): Promise<void> => {
    const problems = await prisma.problem.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        versions: {
          orderBy: { version: "desc" },
          take: 1,
        },
      },
    });

    const data = problems.map((p) => ({
      id: p.id,
      slug: p.slug,
      title: p.title,
      track: p.track,
      difficulty: p.difficulty,
      estMinutes: p.estMinutes,
      skills: p.skills,
      stack: p.stack,
      createdAt: p.createdAt,
      currentVersion: p.versions[0] ?? null,
    }));

    res.json({ ok: true, data });
  },
);

const DraftSchema = z.object({
  brief: z.string().min(10, "Brief must be at least 10 characters"),
  track: z.string().optional(),
  difficulty: z.string().optional(),
  slug: z.string().optional(),
});

/**
 * POST /api/admin/problems/draft
 * Uses AI to draft a complete problem pack based on a brief.
 * Saves files to packages/problems/<slug>/ and records in DB as DRAFT.
 */
router.post(
  "/problems/draft",
  requireAuth,
  requireRole("AUTHOR", "ADMIN"),
  async (req: Request, res: Response): Promise<void> => {
    const parsed = DraftSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ ok: false, error: parsed.error.flatten() });
      return;
    }

    try {
      const result = await generateProblemDraft(parsed.data);
      res.status(201).json({ ok: true, data: result });
    } catch (err: any) {
      console.error("[ai-author] generation error:", err);
      res.status(500).json({
        ok: false,
        error: "Failed to generate problem draft",
        detail: err.message,
      });
    }
  },
);

/**
 * POST /api/admin/problems/:slug/validate
 * Runs the deterministic 4-check validate.ts pipeline against the draft.
 */
router.post(
  "/problems/:slug/validate",
  requireAuth,
  requireRole("AUTHOR", "ADMIN"),
  async (req: Request<{ slug: string }>, res: Response): Promise<void> => {
    const { slug } = req.params;
    const packDir = path.join(PROBLEMS_ROOT, slug);

    if (!fs.existsSync(packDir)) {
      res.status(404).json({ ok: false, error: `Problem pack '${slug}' not found` });
      return;
    }

    // Build Docker images if needed
    const sessionDockerfile = path.join(DOCKER_ROOT, `session-runner-${slug}.Dockerfile`);
    const graderDockerfile = path.join(DOCKER_ROOT, `grader-runner-${slug}.Dockerfile`);

    if (fs.existsSync(sessionDockerfile)) {
      try {
        await execFileAsync("docker", [
          "build",
          "-f",
          path.relative(MONOREPO_ROOT, sessionDockerfile),
          "-t",
          `heisenbug-session-runner-${slug}:latest`,
          ".",
        ], { cwd: MONOREPO_ROOT, timeout: 300_000 });
      } catch (err: any) {
        res.status(500).json({
          ok: false,
          error: "Failed to build session-runner image",
          detail: err.message,
        });
        return;
      }
    }

    if (fs.existsSync(graderDockerfile)) {
      try {
        await execFileAsync("docker", [
          "build",
          "-f",
          path.relative(MONOREPO_ROOT, graderDockerfile),
          "-t",
          `heisenbug-grader-runner-${slug}:latest`,
          ".",
        ], { cwd: MONOREPO_ROOT, timeout: 300_000 });
      } catch (err: any) {
        res.status(500).json({
          ok: false,
          error: "Failed to build grader-runner image",
          detail: err.message,
        });
        return;
      }
    }

    // Run validate.ts pipeline
    let stdout = "";
    let stderr = "";
    let exitCode = 0;

    try {
      const out = await execFileAsync("npx", ["ts-node", "packages/problems/validate.ts", slug], {
        cwd: MONOREPO_ROOT,
        timeout: 180_000,
        env: { ...process.env },
      });
      stdout = out.stdout;
      stderr = out.stderr;
    } catch (err: any) {
      exitCode = err.code ?? 1;
      stdout = err.stdout ?? "";
      stderr = err.stderr ?? "";
    }

    const fullOutput = stdout + (stderr ? `\n${stderr}` : "");
    const cleanOutput = fullOutput.replace(/\x1b\[[0-9;]*m/g, "");

    const check1 = /check1:\s*PASSED/i.test(cleanOutput);
    const check2 = /check2:\s*PASSED/i.test(cleanOutput);
    const check3 = /check3:\s*PASSED/i.test(cleanOutput);
    const check4 = /check4:\s*PASSED/i.test(cleanOutput);
    const allPassed = exitCode === 0 && cleanOutput.includes("Validation PASSED");

    res.json({
      ok: true,
      slug,
      checks: { check1, check2, check3, check4 },
      allPassed,
      exitCode,
      output: cleanOutput,
    });
  },
);

/**
 * POST /api/admin/problems/:slug/publish
 * Only allows publishing if all 4 checks genuinely pass.
 * Strictly ADMIN only.
 */
router.post(
  "/problems/:slug/publish",
  requireAuth,
  requireRole("ADMIN"),
  async (req: Request<{ slug: string }>, res: Response): Promise<void> => {
    const { slug } = req.params;

    const problem = await prisma.problem.findUnique({
      where: { slug },
      include: {
        versions: {
          orderBy: { version: "desc" },
          take: 1,
        },
      },
    });

    if (!problem || problem.versions.length === 0) {
      res.status(404).json({ ok: false, error: `Problem '${slug}' not found` });
      return;
    }

    const currentVersion = problem.versions[0];
    if (currentVersion.status === "PUBLISHED") {
      res.json({ ok: true, slug, status: "PUBLISHED", message: "Already published" });
      return;
    }

    // Run validate.ts pipeline directly to verify all 4 checks
    let stdout = "";
    let stderr = "";
    let exitCode = 0;

    try {
      const out = await execFileAsync("npx", ["ts-node", "packages/problems/validate.ts", slug], {
        cwd: MONOREPO_ROOT,
        timeout: 180_000,
        env: { ...process.env },
      });
      stdout = out.stdout;
      stderr = out.stderr;
    } catch (err: any) {
      exitCode = err.code ?? 1;
      stdout = err.stdout ?? "";
      stderr = err.stderr ?? "";
    }

    const fullOutput = stdout + (stderr ? `\n${stderr}` : "");
    const cleanOutput = fullOutput.replace(/\x1b\[[0-9;]*m/g, "");
    const allPassed = exitCode === 0 && cleanOutput.includes("Validation PASSED");

    if (!allPassed) {
      res.status(400).json({
        ok: false,
        error: "Validation failed: all 4 checks must genuinely pass before publishing",
        slug,
        status: currentVersion.status,
        output: cleanOutput,
      });
      return;
    }

    // Genuinely passed all 4 checks — update status to PUBLISHED
    const updated = await prisma.problemVersion.update({
      where: { id: currentVersion.id },
      data: { status: "PUBLISHED" },
    });

    res.json({
      ok: true,
      slug,
      versionId: updated.id,
      status: "PUBLISHED",
      message: "Problem pack successfully validated and published!",
    });
  },
);

export default router;
