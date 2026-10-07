import fs from "fs";
import path from "path";
import { promisify } from "util";
import { execFile } from "child_process";
import { prisma } from "../lib/prisma";

const execFileAsync = promisify(execFile);

// Root of monorepo: apps/api/src/services/ -> up 4 levels
const MONOREPO_ROOT = path.resolve(__dirname, "../../../../");
const PROBLEMS_ROOT = path.join(MONOREPO_ROOT, "packages", "problems");
const DOCKER_ROOT = path.join(MONOREPO_ROOT, "infra", "docker");

export interface DraftBrief {
  brief: string;
  track?: string;
  difficulty?: string;
  slug?: string;
}

export interface DraftResult {
  slug: string;
  title: string;
  track: string;
  difficulty: string;
  estMinutes: number;
  skills: string[];
  stack: string;
  files: string[];
  status: "DRAFT";
  rawPromptBrief: string;
}

/**
 * Calls Gemini API to generate a complete problem pack adhering strictly
 * to Heisenbug's 4-check verification pipeline requirements.
 */
export async function generateProblemDraft(briefData: DraftBrief): Promise<DraftResult> {
  const apiKey =
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
    process.env.GOOGLE_API_KEY;

  if (!apiKey) {
    throw new Error(
      "No Gemini API key found. Please set GEMINI_API_KEY or GOOGLE_GENERATIVE_AI_API_KEY in environment."
    );
  }

  const prompt = `You are an expert Principal Engineer and Problem Author for Heisenbug, a real-world debugging assessment platform.
Create a complete, realistic debugging problem pack based on this brief:
"${briefData.brief}"
${briefData.track ? `Track: ${briefData.track}` : "Track: backend"}
${briefData.difficulty ? `Difficulty: ${briefData.difficulty}` : "Difficulty: medium"}
${briefData.slug ? `Desired slug: ${briefData.slug}` : ""}

CRITICAL ARCHITECTURAL CONSTRAINTS FOR HEISENBUG:
1. Language: JavaScript (Node.js / Express / Jest / Supertest, CommonJS).
2. The problem pack MUST pass the deterministic 4-check validation pipeline:
   - CHECK 1: The starter code in repo/ MUST FAIL at least one hidden test (score < 100/100).
   - CHECK 2: The reference solution in solutions/reference.js MUST PASS all visible AND hidden tests (exact score: 100/100).
   - CHECK 3: The reference solution must be completely deterministic (zero random flakiness).
   - CHECK 4: The bad patch in bad_patches/ MUST pass ALL visible tests, but FAIL at least one hidden test.
3. Test title naming convention:
   - Visible test names in repo/tests/visible/ MUST start with [V1:weight], [V2:weight], etc.
   - Hidden test names in tests/hidden/ MUST start with [H1:weight], [H2:weight], etc.
   - The total weights of all visible and hidden tests combined MUST SUM TO EXACTLY 100.
   - For example: V1: 30, V2: 30, H1: 40 -> Total: 100.
4. Entry file & import paths:
   - The entry file (e.g., "src/orders.js") must export the main function/handler/express app.
   - The reference solution and bad patch must be drop-in replacements for the entry file.
   - Visible tests require the entry file via require('../../src/<fileBase>').
   - Hidden tests (which run mounted at /app/tests/hidden/) MUST ALSO require the entry file via require('../../src/<fileBase>') (NEVER '../../repo/src').
5. Directory Structure:
   - meta.json
   - DESCRIPTION.md
   - repo/package.json
   - repo/jest.config.js
   - repo/<entryFile> (starter code containing the real bug)
   - repo/tests/visible/<entryFileBase>.test.js (visible tests with [V1:pts], [V2:pts])
   - tests/hidden/<entryFileBase>.hidden.test.js (hidden tests with [H1:pts], [H2:pts])
   - bad_patches/naive_solution.js (incomplete workaround passing visible only)
   - solutions/reference.js (clean correct fix passing 100/100)

OUTPUT FORMAT:
Return ONLY a valid JSON object (no markdown code blocks, no other text) with this exact schema:
{
  "slug": "kebab-case-slug",
  "title": "Clear concise engineering issue title",
  "track": "backend",
  "difficulty": "medium",
  "estMinutes": 45,
  "skills": ["JavaScript", "Node.js", "Express", "Optimization"],
  "stack": "Node.js / Express / Jest",
  "entryFile": "src/orders.js",
  "descriptionMd": "Full markdown ticket description",
  "editorialMd": "Full markdown editorial explaining bug and architecture",
  "solutionMd": "Markdown walkthrough of reference fix",
  "packageJson": { "name": "...", "version": "1.0.0", "dependencies": { "express": "^4.19.2" }, "devDependencies": { "jest": "^29.7.0", "supertest": "^7.0.0" } },
  "jestConfigJs": "/** @type {import('jest').Config} */\\nmodule.exports = { testMatch: ['**/tests/**/*.test.js'], testTimeout: 15000, forceExit: true, transform: {} };\\n",
  "starterCode": "file contents of repo/<entryFile> containing bug",
  "visibleTestsCode": "file contents of repo/tests/visible/test.js with [V1:pts]",
  "hiddenTestsCode": "file contents of tests/hidden/hidden.test.js with [H1:pts]",
  "badPatchCode": "file contents of bad_patches/naive_patch.js",
  "referenceSolutionCode": "file contents of solutions/reference.js"
}`;

  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${apiKey}`;

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.2,
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API error (HTTP ${response.status}): ${errorText}`);
  }

  const responseJson: any = await response.json();
  const rawText = responseJson.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawText) {
    throw new Error("Gemini returned empty candidate content");
  }

  let parsed: any;
  try {
    parsed = JSON.parse(rawText);
  } catch (err) {
    // Try cleaning potential json markdown fences
    const cleaned = rawText.replace(/^```json\s*/, "").replace(/\s*```$/, "");
    parsed = JSON.parse(cleaned);
  }

  const slug = briefData.slug || parsed.slug;
  const packDir = path.join(PROBLEMS_ROOT, slug);

  // 1. Create directory structure
  fs.mkdirSync(path.join(packDir, "repo", path.dirname(parsed.entryFile)), { recursive: true });
  fs.mkdirSync(path.join(packDir, "repo", "tests", "visible"), { recursive: true });
  fs.mkdirSync(path.join(packDir, "tests", "hidden"), { recursive: true });
  fs.mkdirSync(path.join(packDir, "bad_patches"), { recursive: true });
  fs.mkdirSync(path.join(packDir, "solutions"), { recursive: true });

  const writtenFiles: string[] = [];

  // 2. Write meta.json
  const meta = {
    slug,
    title: parsed.title,
    version: 1,
    entryFile: parsed.entryFile,
    language: "javascript",
    testFramework: "jest",
    testCommand: "npx jest --json --no-coverage --forceExit",
    files: [
      { path: parsed.entryFile, editable: true, label: "implementation" },
    ],
  };
  fs.writeFileSync(path.join(packDir, "meta.json"), JSON.stringify(meta, null, 2), "utf-8");
  writtenFiles.push("meta.json");

  // 3. Write DESCRIPTION.md
  fs.writeFileSync(path.join(packDir, "DESCRIPTION.md"), parsed.descriptionMd, "utf-8");
  writtenFiles.push("DESCRIPTION.md");

  // 4. Write repo/package.json
  const pkg = typeof parsed.packageJson === "string" ? parsed.packageJson : JSON.stringify(parsed.packageJson, null, 2);
  fs.writeFileSync(path.join(packDir, "repo", "package.json"), pkg, "utf-8");
  writtenFiles.push("repo/package.json");

  // 5. Write repo/jest.config.js
  fs.writeFileSync(path.join(packDir, "repo", "jest.config.js"), parsed.jestConfigJs, "utf-8");
  writtenFiles.push("repo/jest.config.js");

  // 6. Write repo/<entryFile> (starter code)
  fs.writeFileSync(path.join(packDir, "repo", parsed.entryFile), parsed.starterCode, "utf-8");
  writtenFiles.push(`repo/${parsed.entryFile}`);

  // 7. Write repo/tests/visible/
  const entryBase = path.basename(parsed.entryFile, path.extname(parsed.entryFile));
  const visibleTestRel = `repo/tests/visible/${entryBase}.test.js`;
  fs.writeFileSync(path.join(packDir, visibleTestRel), parsed.visibleTestsCode, "utf-8");
  writtenFiles.push(visibleTestRel);

  // 8. Write tests/hidden/
  const hiddenTestRel = `tests/hidden/${entryBase}.hidden.test.js`;
  fs.writeFileSync(path.join(packDir, hiddenTestRel), parsed.hiddenTestsCode, "utf-8");
  writtenFiles.push(hiddenTestRel);

  // 9. Write bad_patches/
  const badPatchRel = "bad_patches/naive_solution.js";
  fs.writeFileSync(path.join(packDir, badPatchRel), parsed.badPatchCode, "utf-8");
  writtenFiles.push(badPatchRel);

  // 10. Write solutions/reference.js
  const refSolutionRel = "solutions/reference.js";
  fs.writeFileSync(path.join(packDir, refSolutionRel), parsed.referenceSolutionCode, "utf-8");
  writtenFiles.push(refSolutionRel);

  // 11. Create Dockerfiles in infra/docker/
  const sessionDockerfile = path.join(DOCKER_ROOT, `session-runner-${slug}.Dockerfile`);
  const graderDockerfile = path.join(DOCKER_ROOT, `grader-runner-${slug}.Dockerfile`);

  const sessionDockerfileContent = `# infra/docker/session-runner-${slug}.Dockerfile
FROM node:20-alpine

LABEL role="session-runner" \\
      problem="${slug}" \\
      hidden-tests="false"

WORKDIR /app

COPY packages/problems/${slug}/repo/package.json ./package.json
RUN npm install --prefer-offline

COPY packages/problems/${slug}/repo/jest.config.js ./jest.config.js
COPY packages/problems/${slug}/repo/src             ./src
COPY packages/problems/${slug}/repo/tests/visible ./tests/visible

RUN if [ -d /app/tests/hidden ]; then \\
      echo "ERROR: hidden tests found in session-runner image — aborting build" >&2; \\
      exit 1; \\
    fi && echo "✓ ISOLATION CHECK PASSED: /app/tests/hidden does not exist"

CMD ["sh"]
`;

  const graderDockerfileContent = `# infra/docker/grader-runner-${slug}.Dockerfile
FROM node:20-alpine

LABEL role="grader-runner" \\
      problem="${slug}" \\
      hidden-tests="mounted-at-runtime"

WORKDIR /app

COPY packages/problems/${slug}/repo/package.json ./package.json
RUN npm install --prefer-offline

COPY packages/problems/${slug}/repo/jest.config.js ./jest.config.js
COPY packages/problems/${slug}/repo/src             ./src
COPY packages/problems/${slug}/repo/tests/visible ./tests/visible

RUN mkdir -p /app/tests/hidden && \\
    echo "✓ Mount point /app/tests/hidden created (empty — populated by host volume at runtime)"

RUN [ -z "$(ls -A /app/tests/hidden)" ] && \\
    echo "✓ ISOLATION CHECK PASSED: /app/tests/hidden is empty in grader image"

CMD ["sh"]
`;

  fs.writeFileSync(sessionDockerfile, sessionDockerfileContent, "utf-8");
  fs.writeFileSync(graderDockerfile, graderDockerfileContent, "utf-8");

  // 12. Upsert in database with status DRAFT
  const problem = await prisma.problem.upsert({
    where: { slug },
    update: {
      title: parsed.title,
      track: parsed.track || "backend",
      difficulty: parsed.difficulty || "medium",
      estMinutes: parsed.estMinutes || 45,
      skills: parsed.skills || ["JavaScript", "Node.js"],
      stack: parsed.stack || "Node.js / Express / Jest",
    },
    create: {
      slug,
      title: parsed.title,
      track: parsed.track || "backend",
      difficulty: parsed.difficulty || "medium",
      estMinutes: parsed.estMinutes || 45,
      skills: parsed.skills || ["JavaScript", "Node.js"],
      stack: parsed.stack || "Node.js / Express / Jest",
    },
  });

  const version = await prisma.problemVersion.upsert({
    where: {
      problemId_version: {
        problemId: problem.id,
        version: 1,
      },
    },
    update: {
      status: "DRAFT",
      descriptionMd: parsed.descriptionMd,
      editorialMd: parsed.editorialMd || "",
      solutionMd: parsed.solutionMd || "",
    },
    create: {
      problemId: problem.id,
      version: 1,
      status: "DRAFT",
      descriptionMd: parsed.descriptionMd,
      editorialMd: parsed.editorialMd || "",
      solutionMd: parsed.solutionMd || "",
    },
  });

  // Ensure default variant exists
  const existingVariant = await prisma.variant.findFirst({
    where: { versionId: version.id },
  });
  if (!existingVariant) {
    await prisma.variant.create({
      data: {
        versionId: version.id,
        paramsJson: {},
      },
    });
  }

  return {
    slug,
    title: parsed.title,
    track: parsed.track || "backend",
    difficulty: parsed.difficulty || "medium",
    estMinutes: parsed.estMinutes || 45,
    skills: parsed.skills || [],
    stack: parsed.stack || "Node.js / Express / Jest",
    files: writtenFiles,
    status: "DRAFT",
    rawPromptBrief: briefData.brief,
  };
}
