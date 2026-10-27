/**
 * apps/api/src/services/transparentVmGrader.ts
 *
 * Grader for `testFramework: "transparent-vm"` problems.
 *
 * Design intent:
 *   - ALL test cases are fully visible to the candidate from the start.
 *   - There is no hidden test tier; Docker isolation is unnecessary.
 *   - Candidate code IS actually executed, unlike static-analysis graders.
 *   - Execution happens inside Node's built-in `vm` module sandbox:
 *       • No access to `process`, `require`, `fs`, `net`, `fetch`, or any
 *         host global — the context is a sealed Object.freeze({}) copy plus
 *         only the symbols explicitly whitelisted (console-like logging into
 *         a buffer, Math, JSON, Array, Object, etc.).
 *       • A hard wall-clock timeout (default 2000 ms) is enforced by
 *         vm.Script.runInContext({timeout}). An infinite-loop submission
 *         receives ERR_SCRIPT_EXECUTION_TIMEOUT and a clean 0/100 response.
 *   - executionMode: "TRANSPARENT_VM" — a new, honestly distinct category
 *     separate from DOCKER, NATIVE_UNISOLATED, and STATIC_ANALYSIS.
 *
 * The test suite for a transparent-vm problem lives at:
 *   packages/problems/<slug>/tests/vm_tests.json
 *
 * Format (array of test cases):
 * [
 *   {
 *     "id": "V1",
 *     "weight": 10,
 *     "description": "get on empty cache returns -1",
 *     "script": "const c = new LRUCache(2); result = c.get(1);",
 *     "expect": -1
 *   },
 *   ...
 * ]
 *
 * The grader:
 *   1. Compiles the candidate code into a vm.Script.
 *   2. For each test case, runs `script` in a fresh context that has
 *      the candidate's exported class/function injected plus a `result`
 *      variable. Compares `result` to `expect` with deep equality.
 *   3. Returns a StaticGradeResult-compatible structure with
 *      executionMode: "TRANSPARENT_VM".
 */

import vm from "vm";
import fs from "fs";
import path from "path";

// ── Types ──────────────────────────────────────────────────────────────────

export interface VmCheck {
  id: string;
  weight: number;
  passed: boolean;
  message?: string;
}

export interface VmGradeResult {
  passed: boolean;
  score: number;
  checks: VmCheck[];
  rawOutput: string;
  durationMs: number;
  executionMode: "TRANSPARENT_VM";
}

interface VmTestCase {
  id: string;
  weight: number;
  description: string;
  /** JS snippet to run inside the VM after the candidate code is loaded.
   *  Must assign `result` to the value to compare. */
  script: string;
  /** Expected value — deep-equal compared to `result` after execution. */
  expect: unknown;
}

// ── Constants ──────────────────────────────────────────────────────────────

const VM_TIMEOUT_MS = 1500;
const MAX_SUITE_TIMEOUT_MS = 3500;

// Path resolution: services/ → src/ → api/ → apps/ → monorepo root
const MONOREPO_ROOT = path.resolve(__dirname, "../../../../");
const PROBLEMS_ROOT = path.resolve(MONOREPO_ROOT, "packages/problems");

// ── Deep equality helper ───────────────────────────────────────────────────

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== "object" || typeof b !== "object") return false;
  const aArr = Array.isArray(a);
  const bArr = Array.isArray(b);
  if (aArr !== bArr) return false;
  if (aArr) {
    const aA = a as unknown[];
    const bA = b as unknown[];
    if (aA.length !== bA.length) return false;
    return aA.every((v, i) => deepEqual(v, bA[i]));
  }
  const aKeys = Object.keys(a as object).sort();
  const bKeys = Object.keys(b as object).sort();
  if (aKeys.join(",") !== bKeys.join(",")) return false;
  return aKeys.every((k) =>
    deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])
  );
}

// ── Sandbox context factory ────────────────────────────────────────────────

/**
 * Build a minimal, safe sandbox context.
 *
 * Explicitly included:
 *   Math, JSON, Array, Object, String, Number, Boolean, Symbol, BigInt,
 *   Map, Set, WeakMap, WeakSet, Error, TypeError, RangeError,
 *   parseInt, parseFloat, isNaN, isFinite, Infinity, NaN, undefined.
 *
 * Explicitly excluded (by not being in the context):
 *   process, require, __dirname, __filename, global, globalThis,
 *   fetch, XMLHttpRequest, WebSocket, fs, net, child_process, etc.
 *
 * A `logs` array is injected for candidate console.log (optional, cosmetic only).
 */
function createSandboxContext(logs: string[]): vm.Context {
  const sandbox: Record<string, unknown> = {
    // Safe globals
    Math,
    JSON,
    Array,
    Object,
    String,
    Number,
    Boolean,
    Symbol,
    BigInt,
    Map,
    Set,
    WeakMap,
    WeakSet,
    Error,
    TypeError,
    RangeError,
    SyntaxError,
    ReferenceError,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    Infinity,
    NaN,
    undefined,
    // Cosmetic console (logs captured, not printed to host stdout)
    console: {
      log: (...args: unknown[]) => logs.push(args.map(String).join(" ")),
      warn: (...args: unknown[]) => logs.push("[warn] " + args.map(String).join(" ")),
      error: (...args: unknown[]) => logs.push("[error] " + args.map(String).join(" ")),
    },
    // result slot — test scripts write their outcome here
    result: undefined,
  };

  return vm.createContext(sandbox);
}

// ── Core grader ────────────────────────────────────────────────────────────

/**
 * Grade a transparent-vm problem submission.
 *
 * @param candidateCode  The JavaScript source submitted by the candidate.
 * @param slug           Problem slug — used to load vm_tests.json.
 * @param testScope      "visible" or "all" — for transparent-vm problems
 *                       both scopes run the same full test suite because
 *                       there is no hidden tier by design.
 */
export async function gradeTransparentVm(opts: {
  candidateCode: string;
  slug: string;
  testScope: "visible" | "all";
}): Promise<VmGradeResult> {
  const { candidateCode, slug } = opts;
  const t0 = Date.now();

  const rawOutputLines: string[] = [];
  const checks: VmCheck[] = [];

  // ── Load test cases ──────────────────────────────────────────────────────
  const testsPath = path.join(PROBLEMS_ROOT, slug, "tests", "vm_tests.json");
  if (!fs.existsSync(testsPath)) {
    return {
      passed: false,
      score: 0,
      checks: [{ id: "LOAD", weight: 0, passed: false, message: `vm_tests.json not found at ${testsPath}` }],
      rawOutput: `Error: test suite not found at ${testsPath}`,
      durationMs: Date.now() - t0,
      executionMode: "TRANSPARENT_VM",
    };
  }

  let testCases: VmTestCase[];
  try {
    testCases = JSON.parse(fs.readFileSync(testsPath, "utf-8")) as VmTestCase[];
  } catch (e) {
    return {
      passed: false,
      score: 0,
      checks: [{ id: "LOAD", weight: 0, passed: false, message: `Failed to parse vm_tests.json: ${(e as Error).message}` }],
      rawOutput: `Error: ${(e as Error).message}`,
      durationMs: Date.now() - t0,
      executionMode: "TRANSPARENT_VM",
    };
  }

  // ── Compile candidate code ───────────────────────────────────────────────
  // Wrap in IIFE so candidate top-level variables don't bleed between tests.
  // Candidate must assign to the global class name (e.g. `LRUCache`) or use
  // the module-style `class LRUCache { ... }` which becomes a global in the VM context.
  rawOutputLines.push("=== Transparent VM Grader ===");
  rawOutputLines.push(`Slug: ${slug}  |  Tests: ${testCases.length}  |  Timeout per run: ${VM_TIMEOUT_MS}ms`);
  rawOutputLines.push("");

  let candidateScript: vm.Script;
  try {
    candidateScript = new vm.Script(candidateCode, { filename: "candidate.js" });
  } catch (e) {
    const syntaxMsg = `SyntaxError in candidate code: ${(e as Error).message}`;
    rawOutputLines.push(syntaxMsg);
    const allChecks = testCases.map((tc) => ({
      id: tc.id,
      weight: tc.weight,
      passed: false,
      message: syntaxMsg.slice(0, 200),
    }));
    return {
      passed: false,
      score: 0,
      checks: allChecks,
      rawOutput: rawOutputLines.join("\n"),
      durationMs: Date.now() - t0,
      executionMode: "TRANSPARENT_VM",
    };
  }

  // ── Run each test case ───────────────────────────────────────────────────
  for (const tc of testCases) {
    if (Date.now() - t0 > MAX_SUITE_TIMEOUT_MS) {
      checks.push({
        id: tc.id,
        weight: tc.weight,
        passed: false,
        message: `Execution timed out — suite exceeded ${MAX_SUITE_TIMEOUT_MS}ms limit due to previous timeouts`,
      });
      rawOutputLines.push(`[${tc.id}] ✗ FAIL — ${tc.description}`);
      rawOutputLines.push(`       Suite timeout limit exceeded`);
      continue;
    }

    const logs: string[] = [];
    const ctx = createSandboxContext(logs);

    let passed = false;
    let message: string | undefined;

    try {
      // Step 1: load candidate definitions into this context
      candidateScript.runInContext(ctx, { timeout: VM_TIMEOUT_MS });

      // Step 2: run the test script
      const testScript = new vm.Script(`result = (function() { ${tc.script} })();`, {
        filename: `test_${tc.id}.js`,
      });
      testScript.runInContext(ctx, { timeout: VM_TIMEOUT_MS });

      // Step 3: compare result to expected
      const actual = (ctx as Record<string, unknown>)["result"];
      if (deepEqual(actual, tc.expect)) {
        passed = true;
      } else {
        message = `Expected ${JSON.stringify(tc.expect)}, got ${JSON.stringify(actual)}`;
      }
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code === "ERR_SCRIPT_EXECUTION_TIMEOUT") {
        message = `Execution timed out after ${VM_TIMEOUT_MS}ms — possible infinite loop or O(n²) blowup`;
      } else {
        message = `Runtime error: ${err.message?.slice(0, 200) ?? String(err)}`;
      }
    }

    const statusStr = passed ? "✓ PASS" : "✗ FAIL";
    rawOutputLines.push(`[${tc.id}] ${statusStr} — ${tc.description}`);
    if (!passed && message) rawOutputLines.push(`       ${message}`);
    if (logs.length > 0) rawOutputLines.push(`       logs: ${logs.join("; ").slice(0, 200)}`);

    checks.push({ id: tc.id, weight: tc.weight, passed, message: passed ? undefined : message });
  }

  const score = checks.reduce((sum, c) => sum + (c.passed ? c.weight : 0), 0);
  const passed = checks.every((c) => c.passed);

  rawOutputLines.push("");
  rawOutputLines.push(`Score: ${score}/${checks.reduce((s, c) => s + c.weight, 0)}`);
  rawOutputLines.push(`Passed: ${passed}`);
  rawOutputLines.push(`executionMode: TRANSPARENT_VM`);

  return {
    passed,
    score,
    checks,
    rawOutput: rawOutputLines.join("\n"),
    durationMs: Date.now() - t0,
    executionMode: "TRANSPARENT_VM",
  };
}
