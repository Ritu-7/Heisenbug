/**
 * apps/api/src/services/staticTscGrader.ts
 *
 * Static Analysis Grader for `testFramework: "static-tsc"` problems.
 *
 * This grader NEVER executes candidate code. It only:
 *   1. Writes the submitted TypeScript source to a temp file.
 *   2. Runs `tsc --noEmit` (non-strict) via child_process → visible checks.
 *   3. Runs `tsc --noEmit --strict` → hidden check H1.
 *   4. Uses the TypeScript Compiler API to walk the AST and detect unsound
 *      `as User` assertions without a preceding type guard → hidden check H2.
 *
 * Because no code is ever executed, this grader is safe to run directly on
 * the host (Render or local) without Docker isolation.
 *
 * Execution mode: "STATIC_ANALYSIS" — a distinct third category, separate
 * from "DOCKER" (isolated container) and "NATIVE_UNISOLATED" (host runner).
 */

import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import os from "os";
import path from "path";
import ts from "typescript";

const execFileAsync = promisify(execFile);

// ── Types ──────────────────────────────────────────────────────────────────

export interface StaticCheck {
  id: string;
  weight: number;
  passed: boolean;
  message?: string;
}

export interface StaticGradeResult {
  passed: boolean;
  score: number;
  checks: StaticCheck[];
  rawOutput: string;
  durationMs: number;
  executionMode: "STATIC_ANALYSIS";
}

// ── tsc runner ─────────────────────────────────────────────────────────────

/**
 * Runs `tsc --noEmit` (optionally with --strict) on a single .ts source file.
 * Returns { ok: boolean; diagnostics: string }.
 *
 * We invoke the tsc binary that ships with the monorepo's own TypeScript
 * installation so the version is deterministic regardless of the host OS.
 */
async function runTsc(opts: {
  sourceFile: string;
  strict: boolean;
  tscBin: string;
  tsconfigFile?: string;
}): Promise<{ ok: boolean; diagnostics: string }> {
  const { sourceFile, strict, tscBin, tsconfigFile } = opts;

  const args: string[] = ["--noEmit", "--skipLibCheck", "--target", "ES2020", "--module", "CommonJS"];
  if (strict) {
    args.push("--strict");
  }
  if (tsconfigFile && fs.existsSync(tsconfigFile)) {
    // When a tsconfig exists, use it as base — override noEmit and strict via CLI
    args.push("--project", tsconfigFile);
    if (strict) args.push("--strict");
  }
  args.push(sourceFile);

  try {
    const { stdout, stderr } = await execFileAsync("node", [tscBin, ...args], {
      timeout: 30_000,
      maxBuffer: 2 * 1024 * 1024,
    });
    const combined = (stdout + "\n" + stderr).trim();
    return { ok: true, diagnostics: combined };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; code?: number };
    const combined = ((e.stdout ?? "") + "\n" + (e.stderr ?? "")).trim();
    // tsc exits non-zero when there are type errors — that is expected.
    // Only treat it as a hard failure if there's no output at all.
    if (!combined) {
      return { ok: false, diagnostics: `tsc process failed with no output (code ${e.code})` };
    }
    return { ok: false, diagnostics: combined };
  }
}

// ── AST unsound-cast checker ───────────────────────────────────────────────

/**
 * Checks whether the given TypeScript source contains any `as User` type
 * assertion (AsExpression) that is NOT immediately preceded by a type guard
 * in the same function scope.
 *
 * "Preceded by a type guard" means: within the same function body, there is
 * at least one IfStatement or ConditionalExpression that:
 *   - appears before the AsExpression in source order, AND
 *   - has a condition that calls a function whose name contains "is" (type
 *     guard convention: isUser, isValidUser, etc.) or uses typeof/instanceof
 *     narrowing on the same identifier.
 *
 * Returns { clean: boolean; details: string }.
 *
 * This uses the real TypeScript compiler API (ts.createSourceFile + AST walk),
 * not regex. Regex on TypeScript source is fragile; the AST is the correct tool.
 */
function checkNoUnsoundUserCast(source: string): { clean: boolean; details: string } {
  const sourceFile = ts.createSourceFile(
    "candidate.ts",
    source,
    ts.ScriptTarget.ES2020,
    /* setParentNodes */ true,
  );

  const violations: string[] = [];

  /**
   * Walk the AST recursively. For each function body found, collect:
   *   - All AsExpression nodes whose type is "User" (or ends in "User")
   *   - All IfStatements / ConditionalExpressions that contain type-guard
   *     patterns (calls to isXxx(), typeof checks, instanceof checks)
   */
  function visitFunctionBody(body: ts.Node): void {
    // Collect AsExpression nodes and guard nodes within this scope
    const asExpressions: ts.AsExpression[] = [];
    const guardPositions: number[] = []; // source positions of guard checks

    function collectNodes(node: ts.Node): void {
      // Detect AsExpression: `expr as Type`
      if (ts.isAsExpression(node)) {
        const typeText = node.type.getText(sourceFile).replace(/\s+/g, "");
        // Match: as User, as User | null, as Partial<User>, but not as UserDTO etc.
        // We look for the exact token "User" in the cast type.
        if (/\bUser\b/.test(typeText)) {
          asExpressions.push(node);
        }
      }

      // Detect type guard patterns — if / conditional with narrowing call or typeof
      if (ts.isIfStatement(node) || ts.isConditionalExpression(node)) {
        const condition = ts.isIfStatement(node) ? node.expression : node.condition;
        const condText = condition.getText(sourceFile);
        // Patterns: isUser(...), isValidUser(...), typeof x === 'object', instanceof
        if (
          /\bis[A-Z][A-Za-z]*\s*\(/.test(condText) ||   // isUser(data)
          /typeof\s+\w+/.test(condText) ||               // typeof data === "object"
          /instanceof\s+\w+/.test(condText) ||           // data instanceof SomeClass
          /hasOwnProperty/.test(condText) ||             // hasOwnProperty checks
          /in\s+\w+/.test(condText)                      // 'email' in data
        ) {
          guardPositions.push(node.getStart(sourceFile));
        }
      }

      ts.forEachChild(node, collectNodes);
    }

    collectNodes(body);

    // For each AsExpression casting to User, check if a guard appears before it
    for (const asExpr of asExpressions) {
      const castPos = asExpr.getStart(sourceFile);
      const hasGuardBefore = guardPositions.some((gPos) => gPos < castPos);

      if (!hasGuardBefore) {
        const { line, character } = sourceFile.getLineAndCharacterOfPosition(castPos);
        const castTypeText = asExpr.type.getText(sourceFile);
        violations.push(
          `Line ${line + 1}:${character + 1} — unsound \`as ${castTypeText}\` assertion with no preceding type guard in the same scope`
        );
      }
    }
  }

  // Walk top-level for function declarations, arrow functions, method declarations
  function visitNode(node: ts.Node): void {
    if (
      ts.isFunctionDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isArrowFunction(node) ||
      ts.isMethodDeclaration(node)
    ) {
      if (node.body) {
        visitFunctionBody(node.body);
      }
    } else {
      ts.forEachChild(node, visitNode);
    }
  }

  ts.forEachChild(sourceFile, visitNode);

  if (violations.length === 0) {
    return { clean: true, details: "No unsound `as User` assertions detected — type guard validation is in place." };
  }

  return {
    clean: false,
    details: `Found ${violations.length} unsound assertion(s):\n${violations.map((v) => `  • ${v}`).join("\n")}`,
  };
}

// ── Main grader entry point ────────────────────────────────────────────────

/**
 * Resolves the path to the tsc binary shipped with the monorepo's TypeScript
 * installation. Falls back to the system tsc if not found.
 *
 * __dirname here is: apps/api/src/services/
 * Monorepo root is 4 directories up: ../../../../
 */
function resolveTscBin(): string {
  const candidates = [
    // Monorepo root node_modules (preferred — version-pinned)
    path.resolve(__dirname, "../../../../node_modules/typescript/bin/tsc"),
    // Local api package node_modules
    path.resolve(__dirname, "../../node_modules/typescript/bin/tsc"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  // Absolute fallback: rely on PATH (may differ in version)
  return "tsc";
}

/**
 * Grade a `static-tsc` problem submission.
 *
 * @param candidateCode  The TypeScript source submitted by the candidate.
 * @param slug           Problem slug (used for temp-file naming and tsconfig lookup).
 * @param testScope      "visible" → only V1/V2; "all" → V1/V2 + H1/H2.
 * @returns              Full grading result with executionMode: "STATIC_ANALYSIS".
 */
export async function gradeStaticTsc(opts: {
  candidateCode: string;
  slug: string;
  testScope: "visible" | "all";
}): Promise<StaticGradeResult> {
  const { candidateCode, slug, testScope } = opts;
  const t0 = Date.now();

  const tscBin = resolveTscBin();

  // Write candidate source to a temp file
  const tmpDir = os.tmpdir();
  const tmpTs = path.join(tmpDir, `heisenbug-static-${slug}-${Date.now()}.ts`);

  const checks: StaticCheck[] = [];
  let rawOutputLines: string[] = [];

  try {
    fs.writeFileSync(tmpTs, candidateCode, "utf-8");

    // ── V1: Basic compilation (non-strict) ──────────────────────────────────
    const v1Result = await runTsc({ sourceFile: tmpTs, strict: false, tscBin });
    const v1Passed = v1Result.ok;
    rawOutputLines.push(`=== V1: tsc --noEmit ===`);
    rawOutputLines.push(v1Result.diagnostics || "(no output — clean)");

    checks.push({
      id: "V1",
      weight: 20,
      passed: v1Passed,
      message: v1Passed
        ? undefined
        : (v1Result.diagnostics.split("\n").find((l) => l.includes("error")) ?? "Compilation failed").slice(0, 200),
    });

    // ── V2: No syntax errors (tsc exits cleanly → same as V1 in practice) ──
    // V2 specifically checks that there are no syntax-level errors (as opposed
    // to type errors which might pass under --noEmit without --strict).
    // We treat V2 as "passed if V1 produced no syntax error messages".
    const hasSyntaxError = v1Result.diagnostics.includes("error TS1") ||
      v1Result.diagnostics.includes("error TS2300") || // duplicate identifier
      !v1Passed && v1Result.diagnostics.includes("SyntaxError");

    // V2 passes if it compiles at all (even with type errors, V1 captures those)
    // V2 is a sanity check: the file is parseable TypeScript
    const v2Passed = !hasSyntaxError || v1Passed;
    rawOutputLines.push(`\n=== V2: Syntax check ===`);
    rawOutputLines.push(v2Passed ? "(no syntax errors)" : "Syntax errors detected");

    checks.push({
      id: "V2",
      weight: 20,
      passed: v2Passed,
      message: v2Passed
        ? undefined
        : "File has TypeScript syntax errors — check for mismatched brackets, invalid syntax, etc.",
    });

    // ── Hidden checks (only for testScope === "all") ─────────────────────────
    if (testScope === "all") {
      // ── H1: Strict compilation ─────────────────────────────────────────────
      const h1Result = await runTsc({ sourceFile: tmpTs, strict: true, tscBin });
      rawOutputLines.push(`\n=== H1: tsc --noEmit --strict ===`);
      rawOutputLines.push(h1Result.diagnostics || "(no output — clean)");

      checks.push({
        id: "H1",
        weight: 30,
        passed: h1Result.ok,
        message: h1Result.ok
          ? undefined
          : (h1Result.diagnostics.split("\n").find((l) => l.includes("error")) ?? "Strict compilation failed").slice(0, 200),
      });

      // ── H2: AST check — no bare `as User` without preceding guard ─────────
      const astResult = checkNoUnsoundUserCast(candidateCode);
      rawOutputLines.push(`\n=== H2: AST unsound-cast check ===`);
      rawOutputLines.push(astResult.details);

      checks.push({
        id: "H2",
        weight: 30,
        passed: astResult.clean,
        message: astResult.clean ? undefined : astResult.details.slice(0, 300),
      });
    }
  } finally {
    try { fs.unlinkSync(tmpTs); } catch { /* ignore cleanup error */ }
  }

  const score = checks.reduce((sum, c) => sum + (c.passed ? c.weight : 0), 0);
  const maxScore = checks.reduce((sum, c) => sum + c.weight, 0);
  const passed = checks.every((c) => c.passed);
  const rawOutput = rawOutputLines.join("\n");
  const durationMs = Date.now() - t0;

  return {
    passed,
    score,
    checks,
    rawOutput,
    durationMs,
    executionMode: "STATIC_ANALYSIS",
  };
}
