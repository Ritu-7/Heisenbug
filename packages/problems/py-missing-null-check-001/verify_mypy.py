"""
verify_mypy.py — Proof script for py-missing-null-check-001 mypy checks.

Run this on a machine that has mypy installed (e.g. Render, or locally after
`pip install mypy`):

  python3 verify_mypy.py

It demonstrates that:
  1. Starter code (buggy)  → mypy --strict FAILS (union-attr error)
  2. Reference solution    → mypy --strict PASSES (0 errors)
  3. Bad patch             → mypy --strict FAILS (union-attr error)
  4. AST checker correctly distinguishes all three without executing any code
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
PROBLEM_DIR = HERE  # this script lives in the problem root
CHECKER = os.path.join(PROBLEM_DIR, "ast_null_check.py")

PYTHON = sys.executable


# ── Code samples ─────────────────────────────────────────────────────────────

def _read(rel: str) -> str:
    with open(os.path.join(PROBLEM_DIR, rel), encoding="utf-8") as f:
        return f.read()


CASES = [
    {
        "name": "Starter (buggy) — dict.get() result used without None check",
        "code": _read("repo/src/user_service.py"),
        "expect_mypy_ok": False,   # mypy should ERROR
        "expect_ast_clean": False, # AST check should FAIL
    },
    {
        "name": "Reference solution — explicit `if user is None: raise`",
        "code": _read("solutions/reference.py"),
        "expect_mypy_ok": True,   # mypy should PASS
        "expect_ast_clean": True,  # AST check should PASS
    },
    {
        "name": "Bad patch — bare except: pass swallows AttributeError",
        "code": _read("bad_patches/bare_except_swallow.py"),
        "expect_mypy_ok": False,   # mypy should ERROR
        "expect_ast_clean": False, # AST check should FAIL
    },
]


def run_mypy_strict(source_code: str) -> tuple[bool, str]:
    """Run mypy --strict on source_code. Returns (ok, diagnostics)."""
    with tempfile.NamedTemporaryFile(
        suffix=".py", mode="w", encoding="utf-8", delete=False
    ) as f:
        f.write(source_code)
        tmpfile = f.name

    try:
        result = subprocess.run(
            [
                PYTHON, "-m", "mypy",
                "--no-error-summary",
                "--show-error-codes",
                "--ignore-missing-imports",
                "--strict",
                tmpfile,
            ],
            capture_output=True,
            text=True,
        )
        diag = (result.stdout + result.stderr).strip()
        # Replace tmp path with "<candidate>" for readability
        diag = diag.replace(tmpfile, "<candidate>")
        return result.returncode == 0, diag
    finally:
        os.unlink(tmpfile)


def run_ast_check(source_code: str) -> tuple[bool, str]:
    """Run ast_null_check.py on source_code. Returns (clean, details)."""
    with tempfile.NamedTemporaryFile(
        suffix=".py", mode="w", encoding="utf-8", delete=False
    ) as f:
        f.write(source_code)
        tmpfile = f.name

    try:
        result = subprocess.run(
            [PYTHON, CHECKER, tmpfile],
            capture_output=True,
            text=True,
        )
        try:
            data = json.loads(result.stdout.strip())
            return data["clean"], data["details"]
        except (json.JSONDecodeError, KeyError):
            return False, f"Parse error: {result.stdout!r}"
    finally:
        os.unlink(tmpfile)


def main() -> None:
    # Check if mypy is available
    mypy_available = subprocess.run(
        [PYTHON, "-m", "mypy", "--version"],
        capture_output=True,
    ).returncode == 0

    if not mypy_available:
        print("WARNING: mypy not installed — skipping mypy checks (AST checks will still run)")
        print("Install with: pip install mypy")
        print()

    all_passed = True

    for case in CASES:
        name = case["name"]
        code = case["code"]
        expect_mypy_ok = case["expect_mypy_ok"]
        expect_ast_clean = case["expect_ast_clean"]

        print("=" * 70)
        print(f"Case: {name}")
        print()

        # ── mypy check ──────────────────────────────────────────────────────
        if mypy_available:
            mypy_ok, mypy_diag = run_mypy_strict(code)
            mypy_pass = mypy_ok == expect_mypy_ok
            all_passed = all_passed and mypy_pass
            print(f"mypy --strict: {'OK (0 errors)' if mypy_ok else 'ERRORS'}")
            if mypy_diag:
                # Show first 3 error lines
                lines = [l for l in mypy_diag.splitlines() if "error:" in l][:3]
                for l in lines:
                    print(f"  {l}")
                if not lines:
                    print(f"  (clean)")
            print(f"mypy check: {'PASS' if mypy_pass else 'FAIL'} "
                  f"(expected {'ok' if expect_mypy_ok else 'errors'})")
        else:
            print("mypy --strict: SKIPPED (mypy not installed)")

        print()

        # ── AST check ───────────────────────────────────────────────────────
        ast_clean, ast_details = run_ast_check(code)
        ast_pass = ast_clean == expect_ast_clean
        all_passed = all_passed and ast_pass
        print(f"AST check: {'CLEAN' if ast_clean else 'VIOLATION'}")
        print(f"  {ast_details}")
        print(f"AST check: {'PASS' if ast_pass else 'FAIL'} "
              f"(expected {'clean' if expect_ast_clean else 'violation'})")
        print()

    print("=" * 70)
    print(f"Overall: {'ALL PASSED' if all_passed else 'SOME FAILED'}")
    sys.exit(0 if all_passed else 1)


if __name__ == "__main__":
    main()
