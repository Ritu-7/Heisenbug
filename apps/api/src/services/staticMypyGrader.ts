/**
 * apps/api/src/services/staticMypyGrader.ts
 *
 * Static Analysis Grader for `testFramework: "static-mypy"` problems.
 *
 * This grader NEVER executes candidate code. It only:
 *   1. Writes the submitted Python source to a temp file.
 *   2. Runs `python3 -c "import ast; ast.parse(...)"` — syntax check → V1.
 *   3. Runs `mypy` (non-strict) on the file → V2.
 *   4. Runs `mypy --strict` on the file → hidden check H1.
 *   5. Invokes the problem's bundled `ast_null_check.py` via a Python
 *      subprocess to walk the AST for unguarded `.get()` attribute accesses
 *      (the "guard must appear before the unsafe access" pattern) → hidden H2.
 *
 * Because no code is ever executed, this grader is safe to run directly on
 * the host (Render or local) without Docker isolation.
 *
 * Execution mode: "STATIC_ANALYSIS" — same as staticTscGrader, a distinct
 * third category separate from "DOCKER" and "NATIVE_UNISOLATED".
 *
 * Architecture note: this mirrors staticTscGrader.ts exactly:
 *   - tsc → mypy
 *   - TypeScript Compiler API AST walk → Python ast module subprocess
 *   - hasGuardBefore logic → ast_null_check.py's guard-before-access check
 */

import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import os from "os";
import path from "path";

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

// ── Python / mypy resolution ───────────────────────────────────────────────

/**
 * Resolves the python3 binary to use for subprocess calls.
 * Tries common locations in order; falls back to "python3" on PATH.
 *
 * On Render (Linux): python3 is available at /usr/bin/python3.
 * On macOS (Homebrew): /usr/local/bin/python3 or /opt/homebrew/bin/python3.
 * On Windows dev machines: C:\msys64\ucrt64\bin\python3.exe (msys2).
 */
function resolvePython3(): string {
  if (process.env.PYTHON_BIN && fs.existsSync(process.env.PYTHON_BIN)) {
    return process.env.PYTHON_BIN;
  }

  const venvPython = path.join(os.homedir(), ".mypy-env", "bin", "python3.exe");
  if (fs.existsSync(venvPython)) return venvPython;

  const candidates = [
    "/usr/bin/python3",
    "/usr/local/bin/python3",
    "/opt/homebrew/bin/python3",
    "C:\\msys64\\ucrt64\\bin\\python3.exe",
    "C:\\msys64\\mingw64\\bin\\python3.exe",
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return "python3"; // fallback — relies on PATH
}

/**
 * Resolves the mypy binary.
 * On Render (Linux): /usr/local/bin/mypy or in the venv.
 * Prefers the mypy that ships alongside the resolved python3 (same env).
 * Falls back to the system mypy on PATH.
 */
function resolveMypyBin(python3: string): string {
  if (process.env.MYPY_BIN && fs.existsSync(process.env.MYPY_BIN)) {
    return process.env.MYPY_BIN;
  }

  // Try sibling to the python3 binary first (same venv/prefix)
  const sibling = path.join(path.dirname(python3), "mypy");
  if (fs.existsSync(sibling)) return sibling;
  const siblingExe = path.join(path.dirname(python3), "mypy.exe");
  if (fs.existsSync(siblingExe)) return siblingExe;

  // Common system locations
  const candidates = [
    "/usr/local/bin/mypy",
    "/usr/bin/mypy",
    "/opt/homebrew/bin/mypy",
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }

  // Fallback: invoke mypy as a Python module (works if mypy is installed
  // in the Python environment but its script isn't on PATH)
  return "__python_module__"; // sentinel handled in runMypy
}

// ── Syntax check ───────────────────────────────────────────────────────────

/**
 * Checks that the submitted file parses as valid Python by calling
 * `python3 -c "import ast; ast.parse(open('file').read())"`.
 * Returns { ok: boolean; error: string }.
 */
async function checkSyntax(
  python3: string,
  sourceFile: string,
): Promise<{ ok: boolean; error: string }> {
  const script = `
import ast, sys
try:
    with open(sys.argv[1], 'r', encoding='utf-8') as f:
        src = f.read()
    ast.parse(src)
    print('ok')
except SyntaxError as e:
    print(f'SyntaxError at line {e.lineno}: {e.msg}')
    sys.exit(1)
`.trim();

  try {
    await execFileAsync(python3, ["-c", script, sourceFile], {
      timeout: 15_000,
      maxBuffer: 512 * 1024,
    });
    return { ok: true, error: "" };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string };
    const msg = ((e.stdout ?? "") + (e.stderr ?? "")).trim();
    return { ok: false, error: msg || "Syntax check failed" };
  }
}

// ── mypy runner ────────────────────────────────────────────────────────────

/**
 * Runs mypy on a single Python source file.
 * Returns { ok: boolean; diagnostics: string }.
 *
 * ok = true  → mypy exit code 0 (no errors)
 * ok = false → mypy found errors or could not run
 */
async function runMypy(opts: {
  sourceFile: string;
  strict: boolean;
  python3: string;
  mypyBin: string;
}): Promise<{ ok: boolean; diagnostics: string }> {
  const { sourceFile, strict, python3, mypyBin } = opts;

  const args: string[] = [
    "--no-error-summary",
    "--show-error-codes",
    "--ignore-missing-imports", // don't fail on missing stubs for stdlib
  ];
  if (strict) {
    args.push("--strict");
  }
  args.push(sourceFile);

  // Build the command: either `mypy <args>` or `python3 -m mypy <args>`
  let cmd: string;
  let cmdArgs: string[];

  if (mypyBin === "__python_module__") {
    cmd = python3;
    cmdArgs = ["-m", "mypy", ...args];
  } else {
    cmd = mypyBin;
    cmdArgs = args;
  }

  try {
    const { stdout, stderr } = await execFileAsync(cmd, cmdArgs, {
      timeout: 30_000,
      maxBuffer: 2 * 1024 * 1024,
    });
    const combined = (stdout + "\n" + stderr).trim();
    return { ok: true, diagnostics: combined };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; code?: number; message?: string };
    const combined = ((e.stdout ?? "") + "\n" + (e.stderr ?? "")).trim();

    // mypy exits non-zero when there are type errors — expected.
    // A hard failure is when there's no output at all (binary not found, etc.)
    if (!combined) {
      return {
        ok: false,
        diagnostics: `mypy process failed with no output (code ${e.code}): ${e.message ?? ""}`,
      };
    }
    // Non-zero exit with output means type errors were found
    return { ok: false, diagnostics: combined };
  }
}

// ── AST null-check (Python subprocess) ─────────────────────────────────────

/**
 * Invokes the problem-bundled `ast_null_check.py` script via a Python
 * subprocess to walk the AST and detect unguarded attribute accesses on
 * Optional values returned by `.get()` calls.
 *
 * This mirrors the TypeScript `checkNoUnsoundUserCast` function in
 * staticTscGrader.ts — the "guard must appear before the unsafe access" logic
 * is identical, just implemented in Python and targeting Python code.
 *
 * MONOREPO_ROOT/packages/problems/<slug>/ast_null_check.py is the checker.
 *
 * Returns { clean: boolean; details: string }.
 */
async function runAstNullCheck(opts: {
  python3: string;
  slug: string;
  sourceFile: string;
  problemsRoot: string;
}): Promise<{ clean: boolean; details: string }> {
  const { python3, slug, sourceFile, problemsRoot } = opts;
  const checkerScript = path.join(problemsRoot, slug, "ast_null_check.py");

  if (!fs.existsSync(checkerScript)) {
    return {
      clean: false,
      details: `AST checker script not found at ${checkerScript}`,
    };
  }

  try {
    const { stdout } = await execFileAsync(
      python3,
      [checkerScript, sourceFile],
      {
        timeout: 20_000,
        maxBuffer: 512 * 1024,
      },
    );
    const result = JSON.parse(stdout.trim()) as { clean: boolean; details: string };
    return result;
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; code?: number };
    // Exit code 1 = violation found (JSON still on stdout)
    if (e.stdout) {
      try {
        const result = JSON.parse((e.stdout as string).trim()) as { clean: boolean; details: string };
        return result;
      } catch {
        /* fall through to error handling */
      }
    }
    const msg = ((e.stdout ?? "") + (e.stderr ?? "")).trim();
    return {
      clean: false,
      details: `AST checker subprocess failed (code ${e.code}): ${msg || "no output"}`,
    };
  }
}

// ── Main grader entry point ────────────────────────────────────────────────

// Routes are: routes/ → src/ → api/ → apps/ → monorepo root → packages/problems/
const MONOREPO_ROOT = path.resolve(__dirname, "../../../../");
const PROBLEMS_ROOT = path.resolve(MONOREPO_ROOT, "packages/problems");

/**
 * Grade a `static-mypy` problem submission.
 *
 * @param candidateCode  The Python source submitted by the candidate.
 * @param slug           Problem slug (used for temp-file naming and ast_null_check.py lookup).
 * @param testScope      "visible" → only V1/V2; "all" → V1/V2 + H1/H2.
 * @returns              Full grading result with executionMode: "STATIC_ANALYSIS".
 */
export async function gradeStaticMypy(opts: {
  candidateCode: string;
  slug: string;
  testScope: "visible" | "all";
}): Promise<StaticGradeResult> {
  const { candidateCode, slug, testScope } = opts;
  const t0 = Date.now();

  const python3 = resolvePython3();
  const mypyBin = resolveMypyBin(python3);

  // Write candidate source to a temp file
  const tmpDir = os.tmpdir();
  const tmpPy = path.join(tmpDir, `heisenbug-static-${slug}-${Date.now()}.py`);

  const checks: StaticCheck[] = [];
  const rawOutputLines: string[] = [];

  try {
    fs.writeFileSync(tmpPy, candidateCode, "utf-8");

    // ── V1: Python syntax check ──────────────────────────────────────────────
    rawOutputLines.push(`=== V1: Python syntax check ===`);
    const syntaxResult = await checkSyntax(python3, tmpPy);
    rawOutputLines.push(syntaxResult.ok ? "(no syntax errors)" : syntaxResult.error);

    checks.push({
      id: "V1",
      weight: 20,
      passed: syntaxResult.ok,
      message: syntaxResult.ok
        ? undefined
        : syntaxResult.error.slice(0, 200),
    });

    // ── V2: mypy (non-strict) ────────────────────────────────────────────────
    rawOutputLines.push(`\n=== V2: mypy (non-strict) ===`);
    const v2Result = await runMypy({ sourceFile: tmpPy, strict: false, python3, mypyBin });
    rawOutputLines.push(v2Result.diagnostics || "(no output — clean)");

    checks.push({
      id: "V2",
      weight: 20,
      passed: v2Result.ok,
      message: v2Result.ok
        ? undefined
        : (v2Result.diagnostics.split("\n").find((l) => l.includes("error")) ?? "mypy found errors").slice(0, 200),
    });

    // ── Hidden checks (only for testScope === "all") ─────────────────────────
    if (testScope === "all") {
      // ── H1: mypy --strict ───────────────────────────────────────────────────
      rawOutputLines.push(`\n=== H1: mypy --strict ===`);
      const h1Result = await runMypy({ sourceFile: tmpPy, strict: true, python3, mypyBin });
      rawOutputLines.push(h1Result.diagnostics || "(no output — clean)");

      checks.push({
        id: "H1",
        weight: 30,
        passed: h1Result.ok,
        message: h1Result.ok
          ? undefined
          : (h1Result.diagnostics.split("\n").find((l) => l.includes("error")) ?? "mypy --strict found errors").slice(0, 200),
      });

      // ── H2: AST null-check (Python subprocess) ──────────────────────────────
      // Mirrors staticTscGrader's checkNoUnsoundUserCast / hasGuardBefore logic:
      // walk the AST, find variables assigned from .get() calls, check that a
      // None guard (if var is None, assert var is not None, etc.) appears
      // before any attribute access on that variable in source order.
      rawOutputLines.push(`\n=== H2: AST null-check (guard-before-access) ===`);
      const astResult = await runAstNullCheck({
        python3,
        slug,
        sourceFile: tmpPy,
        problemsRoot: PROBLEMS_ROOT,
      });
      rawOutputLines.push(astResult.details);

      checks.push({
        id: "H2",
        weight: 30,
        passed: astResult.clean,
        message: astResult.clean ? undefined : astResult.details.slice(0, 300),
      });
    }
  } finally {
    try {
      fs.unlinkSync(tmpPy);
    } catch {
      /* ignore cleanup error */
    }
  }

  const score = checks.reduce((sum, c) => sum + (c.passed ? c.weight : 0), 0);
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
