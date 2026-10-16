import { Router, Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { getAuth } from "@clerk/express";
import jwt from "jsonwebtoken";
import fs from "fs";
import path from "path";

const router = Router();

// __dirname here is  apps/api/src/routes/  → go up 4 levels to reach monorepo root
const PROBLEMS_ROOT = path.resolve(__dirname, "../../../../packages/problems");

/**
 * Counts test cases in a file by matching `test(` (Jest/Mocha) or `def test_` (pytest).
 */
function countTestsInFile(filePath: string): number {
  if (!fs.existsSync(filePath)) return 0;
  const content = fs.readFileSync(filePath, "utf-8");
  // Match Jest/Mocha: test("..." or test(`...
  const jestMatches = (content.match(/\btest\s*\(/g) ?? []).length;
  // Match pytest: def test_
  const pytestMatches = (content.match(/\bdef test_/g) ?? []).length;
  return jestMatches + pytestMatches;
}

/**
 * Counts the total visible + hidden checks for a problem pack.
 * Walks the repo/tests/visible and tests/hidden directories.
 */
function countChecksForSlug(slug: string): number {
  const packDir = path.join(PROBLEMS_ROOT, slug);
  let total = 0;

  const scanDir = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isFile() && /\.(js|ts|py)$/.test(entry.name)) {
        total += countTestsInFile(path.join(dir, entry.name));
      } else if (entry.isDirectory()) {
        scanDir(path.join(dir, entry.name));
      }
    }
  };

  // Visible tests live inside the repo snapshot
  scanDir(path.join(packDir, "repo", "tests", "visible"));
  // Hidden tests live outside the repo snapshot
  scanDir(path.join(packDir, "tests", "hidden"));

  return total;
}

/**
 * GET /api/problems
 * Returns all problems with their latest PUBLISHED version joined in.
 * Only real rows from the DB — no padding.
 *
 * Optional auth: if a Clerk session or Bearer JWT is present, each problem
 * gets a `solved` boolean (true = user has a passing submission for that
 * problem). Unauthenticated requests get `solved: null`.
 *
 * `solveRate` = passing_submissions / total_submissions per problem,
 * returned as a percentage (0–100, integer) when >= 5 total submissions
 * exist across all users; otherwise null ("not enough data yet").
 */
router.get("/", async (req: Request, res: Response): Promise<void> => {
  // ── Optional auth: try Clerk first, then legacy Bearer JWT ─────────────────
  let authedUserId: string | null = null;
  try {
    const clerkAuth = getAuth(req);
    if (clerkAuth?.userId) {
      authedUserId = clerkAuth.userId;
    } else {
      const authHeader = req.headers.authorization;
      if (authHeader?.startsWith("Bearer ")) {
        const token = authHeader.slice(7);
        const secret = process.env.JWT_SECRET;
        if (secret) {
          try {
            const decoded = jwt.verify(token, secret) as any;
            if (decoded?.sub) authedUserId = decoded.sub;
          } catch {
            // invalid token — treat as unauthenticated
          }
        }
      }
    }
  } catch {
    // optional auth failure — proceed as guest
  }

  const problems = await prisma.problem.findMany({
    orderBy: { createdAt: "asc" },
    include: {
      versions: {
        where: { status: "PUBLISHED" },
        orderBy: { version: "desc" },
        take: 1,
        select: {
          id: true,
          version: true,
          status: true,
          createdAt: true,
          editorialMd: false,
          solutionMd: false,
          descriptionMd: false,
          // Include sessions with submissions for solve-rate + user solved status
          sessions: {
            select: {
              userId: true,
              submissions: {
                select: { score: true },
              },
            },
          },
        },
      },
    },
  });

  const shaped = problems.map((p: (typeof problems)[number]) => {
    const latestVersion = p.versions[0] ?? null;

    // ── Aggregate real submission data across all sessions of this problem ─
    let totalSubmissions = 0;
    let passingSubmissions = 0;
    let userHasPassing = false;

    if (latestVersion) {
      for (const session of latestVersion.sessions) {
        for (const sub of session.submissions) {
          totalSubmissions++;
          if (sub.score >= 100) {
            passingSubmissions++;
            if (authedUserId && session.userId === authedUserId) {
              userHasPassing = true;
            }
          }
        }
      }
    }

    // solveRate: only meaningful once >= 5 total submissions exist
    const solveRate =
      totalSubmissions >= 5
        ? Math.round((passingSubmissions / totalSubmissions) * 100)
        : null;

    return {
      id: p.id,
      slug: p.slug,
      title: p.title,
      track: p.track,
      difficulty: p.difficulty,
      estMinutes: p.estMinutes,
      skills: p.skills,
      stack: p.stack,
      createdAt: p.createdAt,
      currentVersion: latestVersion
        ? {
            id: latestVersion.id,
            version: latestVersion.version,
            status: latestVersion.status,
            createdAt: latestVersion.createdAt,
          }
        : null,
      checkCount: countChecksForSlug(p.slug),
      // null = unauthenticated (show neither ✓ nor ✗), false = not solved, true = solved
      solved: authedUserId ? userHasPassing : null,
      // null = < 5 submissions (not enough data yet)
      solveRate,
    };
  });

  res.json({ ok: true, data: shaped });
});

/**
 * GET /api/problems/:slug/starter-code
 *
 * Reads the entry file from the on-disk problem pack and returns its content.
 * The frontend never hardcodes starter code strings — this is the single
 * source of truth for what candidates start with in the editor.
 *
 * Returns 404 if the pack directory or meta.json is missing.
 */
router.get("/:slug/starter-code", async (req: Request<{ slug: string }>, res: Response): Promise<void> => {
  const { slug } = req.params;

  const packDir = path.join(PROBLEMS_ROOT, slug);
  const metaPath = path.join(packDir, "meta.json");

  if (!fs.existsSync(metaPath)) {
    res.status(404).json({ ok: false, error: `No problem pack found for '${slug}'` });
    return;
  }

  let meta: {
    entryFile: string;
    language: string;
    files: Array<{ path: string; editable: boolean; label: string }>;
  };
  try {
    meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
  } catch {
    res.status(500).json({ ok: false, error: "Failed to parse problem pack meta.json" });
    return;
  }

  const entryPath = path.join(packDir, "repo", meta.entryFile);
  if (!fs.existsSync(entryPath)) {
    res
      .status(404)
      .json({ ok: false, error: `Entry file '${meta.entryFile}' not found in problem pack` });
    return;
  }

  const content = fs.readFileSync(entryPath, "utf-8");

  res.json({
    ok: true,
    data: {
      filename: meta.entryFile,
      language: meta.language,
      content,
      files: meta.files,
    },
  });
});

/**
 * GET /api/problems/:slug
 * Returns the full problem + its latest PUBLISHED version (with descriptionMd).
 * 404 if not found or no published version exists.
 */
router.get("/:slug", async (req: Request<{ slug: string }>, res: Response): Promise<void> => {
  const { slug } = req.params;

  const problem = await prisma.problem.findUnique({
    where: { slug },
    include: {
      versions: {
        where: { status: "PUBLISHED" },
        orderBy: { version: "desc" },
        take: 1,
      },
    },
  });

  if (!problem) {
    res.status(404).json({ ok: false, error: `Problem '${slug}' not found` });
    return;
  }

  const publishedVersion = problem.versions[0];
  if (!publishedVersion) {
    res.status(404).json({ ok: false, error: `No published version for problem '${slug}'` });
    return;
  }

  res.json({
    ok: true,
    data: {
      id: problem.id,
      slug: problem.slug,
      title: problem.title,
      track: problem.track,
      difficulty: problem.difficulty,
      estMinutes: problem.estMinutes,
      skills: problem.skills,
      stack: problem.stack,
      createdAt: problem.createdAt,
      currentVersion: {
        id: publishedVersion.id,
        version: publishedVersion.version,
        status: publishedVersion.status,
        descriptionMd: publishedVersion.descriptionMd,
        editorialMd: publishedVersion.editorialMd,
        solutionMd: publishedVersion.solutionMd,
        createdAt: publishedVersion.createdAt,
      },
    },
  });
});

/**
 * GET /api/problems/:slug/near-misses
 * Returns the bad patches for a problem pack, including:
 * - Bad patch code
 * - Explanation markdown (from accompanying .md file)
 * - Measured validation score from meta.json
 * - Real aggregate stat: "% of submissions on this problem matching this exact failure pattern"
 *   derived from real Submission.verdictJson rows grouped by failed check IDs.
 */
router.get("/:slug/near-misses", async (req: Request<{ slug: string }>, res: Response): Promise<void> => {
  const { slug } = req.params;
  const packDir = path.join(PROBLEMS_ROOT, slug);
  const metaPath = path.join(packDir, "meta.json");

  if (!fs.existsSync(metaPath)) {
    res.status(404).json({ ok: false, error: `Problem pack '${slug}' not found` });
    return;
  }

  let meta: {
    entryFile: string;
    language: string;
    badPatches?: Array<{
      id: string;
      file: string;
      explanationFile: string;
      title: string;
      measuredScore: number;
      maxScore: number;
      summary: string;
      failedChecks: string[];
      passedChecks?: string[];
    }>;
  };
  try {
    meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
  } catch {
    res.status(500).json({ ok: false, error: "Failed to parse problem meta.json" });
    return;
  }

  const badPatchesConfig = meta.badPatches || [];
  const badPatchesDir = path.join(packDir, "bad_patches");

  // Fetch real submissions for this problem to calculate real failure pattern frequency
  const problem = await prisma.problem.findUnique({
    where: { slug },
    include: {
      versions: {
        select: {
          id: true,
          sessions: {
            select: {
              submissions: {
                select: {
                  id: true,
                  score: true,
                  verdictJson: true,
                },
              },
            },
          },
        },
      },
    },
  });

  const allSubmissions: Array<{ id: string; score: number; verdictJson: any }> = [];
  if (problem) {
    for (const v of problem.versions) {
      for (const s of v.sessions) {
        allSubmissions.push(...s.submissions);
      }
    }
  }

  const totalSubmissions = allSubmissions.length;

  const results = badPatchesConfig.map((patch) => {
    const codePath = path.join(badPatchesDir, patch.file);
    const explPath = path.join(badPatchesDir, patch.explanationFile);

    const code = fs.existsSync(codePath) ? fs.readFileSync(codePath, "utf-8") : "";
    const explanation = fs.existsSync(explPath) ? fs.readFileSync(explPath, "utf-8") : "";

    // Derive real failure pattern matching from Submission.verdictJson
    // Pattern matches if submission failed the exact checks specified in patch.failedChecks
    let matchingSubmissionsCount = 0;
    const targetFailedSet = new Set(patch.failedChecks.map((c) => c.toUpperCase()));

    for (const sub of allSubmissions) {
      const v = sub.verdictJson as { checks?: Array<{ id: string; passed: boolean }> };
      if (v && Array.isArray(v.checks)) {
        const failedChecks = v.checks
          .filter((c) => !c.passed)
          .map((c) => c.id.toUpperCase());

        // Check if the submission failed at least all the target failed checks
        const matchesPattern =
          failedChecks.length > 0 &&
          targetFailedSet.size > 0 &&
          patch.failedChecks.every((fc) => failedChecks.includes(fc.toUpperCase()));

        if (matchesPattern) {
          matchingSubmissionsCount++;
        }
      }
    }

    let failureStat: {
      percentage: number | null;
      matchingCount: number;
      totalCount: number;
      formatted: string;
    };

    if (totalSubmissions >= 5) {
      const pct = Math.round((matchingSubmissionsCount / totalSubmissions) * 100);
      failureStat = {
        percentage: pct,
        matchingCount: matchingSubmissionsCount,
        totalCount: totalSubmissions,
        formatted: `${pct}% of submissions on this problem matched this exact failure pattern`,
      };
    } else {
      failureStat = {
        percentage: null,
        matchingCount: matchingSubmissionsCount,
        totalCount: totalSubmissions,
        formatted: "Not enough data yet",
      };
    }

    return {
      id: patch.id,
      title: patch.title,
      filename: patch.file,
      code,
      explanation,
      measuredScore: patch.measuredScore,
      maxScore: patch.maxScore,
      summary: patch.summary,
      failedChecks: patch.failedChecks,
      passedChecks: patch.passedChecks || [],
      failureStat,
    };
  });

  res.json({
    ok: true,
    data: {
      slug,
      nearMisses: results,
      totalSubmissions,
    },
  });
});

export default router;
