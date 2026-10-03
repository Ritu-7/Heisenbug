import { Router, Request, Response } from "express";
import { prisma } from "../lib/prisma";
import fs from "fs";
import path from "path";

const router = Router();

// __dirname here is  apps/api/src/routes/  → go up 4 levels to reach monorepo root
const PROBLEMS_ROOT = path.resolve(__dirname, "../../../../packages/problems");

/**
 * GET /api/problems
 * Returns all problems with their latest PUBLISHED version joined in.
 * Only real rows from the DB — no padding.
 */
router.get("/", async (_req: Request, res: Response): Promise<void> => {
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
        },
      },
    },
  });

  const shaped = problems.map((p: (typeof problems)[number]) => ({
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

export default router;
