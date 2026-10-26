"""
ast_null_check.py — Python AST checker for py-missing-null-check-001.

Invoked by staticMypyGrader.ts as a subprocess:
  python3 ast_null_check.py <source_file>

Exit codes:
  0  — clean: no unguarded attribute access on .get() results found
  1  — violation found (details printed to stdout as JSON)
  2  — syntax error in the submitted file (details in JSON)
  3  — usage error

Output (always JSON on stdout):
  { "clean": bool, "details": str }
"""

from __future__ import annotations

import ast
import json
import sys
from typing import Dict, List, Tuple


def _find_get_assigned_vars(func_node: ast.AST) -> Dict[str, int]:
    """
    Walk a function body and collect variable names that receive the result of
    a `.get()` call (i.e. dict.get(), which returns Optional[T]).

    Returns a dict mapping var_name -> assignment_line_number.
    """
    get_vars: Dict[str, int] = {}

    for node in ast.walk(func_node):
        # Match: var = something.get(...)
        if isinstance(node, ast.Assign):
            if isinstance(node.value, ast.Call):
                func = node.value.func
                if isinstance(func, ast.Attribute) and func.attr == "get":
                    for target in node.targets:
                        if isinstance(target, ast.Name):
                            # Only record first assignment (in source order)
                            if target.id not in get_vars:
                                get_vars[target.id] = node.lineno

        # Also match annotated assignment: var: Optional[X] = something.get(...)
        elif isinstance(node, ast.AnnAssign):
            if node.value is not None and isinstance(node.value, ast.Call):
                func = node.value.func
                if isinstance(func, ast.Attribute) and func.attr == "get":
                    if isinstance(node.target, ast.Name):
                        var_name = node.target.id
                        if var_name not in get_vars:
                            get_vars[var_name] = node.lineno

    return get_vars


def _collect_guard_lines(func_node: ast.AST, var_name: str) -> List[int]:
    """
    Walk a function body and collect line numbers of statements that constitute
    a None guard for var_name. A None guard is any of:

      if var is None: ...
      if var is not None: ...
      if not var: ...
      if var: ...          (truthiness — only counts as a guard if it's a standalone if)
      assert var is not None, ...
      assert var, ...
      if isinstance(var, SomeType): ...
    """
    guard_lines: List[int] = []

    for node in ast.walk(func_node):
        # ── if-statement guards ────────────────────────────────────────────
        if isinstance(node, ast.If):
            test = node.test
            line = node.lineno

            # Pattern: `if var is None:` or `if var is not None:`
            if isinstance(test, ast.Compare):
                left = test.left
                ops = test.ops
                comps = test.comparators
                # `var is None` or `var is not None`
                if (
                    isinstance(left, ast.Name) and left.id == var_name
                    and len(ops) == 1
                    and isinstance(ops[0], (ast.Is, ast.IsNot))
                    and len(comps) == 1
                    and isinstance(comps[0], ast.Constant)
                    and comps[0].value is None
                ):
                    guard_lines.append(line)
                # `None is var` or `None is not var`
                elif (
                    isinstance(left, ast.Constant) and left.value is None
                    and len(ops) == 1
                    and isinstance(ops[0], (ast.Is, ast.IsNot))
                    and len(comps) == 1
                    and isinstance(comps[0], ast.Name)
                    and comps[0].id == var_name
                ):
                    guard_lines.append(line)

            # Pattern: `if not var:`
            elif (
                isinstance(test, ast.UnaryOp)
                and isinstance(test.op, ast.Not)
                and isinstance(test.operand, ast.Name)
                and test.operand.id == var_name
            ):
                guard_lines.append(line)

            # Pattern: `if var:`  (truthiness guard)
            elif isinstance(test, ast.Name) and test.id == var_name:
                guard_lines.append(line)

            # Pattern: `if isinstance(var, SomeClass):`
            elif (
                isinstance(test, ast.Call)
                and isinstance(test.func, ast.Name)
                and test.func.id == "isinstance"
                and test.args
                and isinstance(test.args[0], ast.Name)
                and test.args[0].id == var_name
            ):
                guard_lines.append(line)

        # ── assert guards ──────────────────────────────────────────────────
        elif isinstance(node, ast.Assert):
            test = node.test
            line = node.lineno

            # `assert var is not None`
            if isinstance(test, ast.Compare):
                left = test.left
                ops = test.ops
                comps = test.comparators
                if (
                    isinstance(left, ast.Name) and left.id == var_name
                    and len(ops) == 1
                    and isinstance(ops[0], ast.IsNot)
                    and len(comps) == 1
                    and isinstance(comps[0], ast.Constant)
                    and comps[0].value is None
                ):
                    guard_lines.append(line)

            # `assert var` (truthiness assert)
            elif isinstance(test, ast.Name) and test.id == var_name:
                guard_lines.append(line)

    return guard_lines


def _find_unguarded_attr_accesses(
    func_node: ast.AST,
    get_vars: Dict[str, int],
) -> List[Tuple[int, str, str, int]]:
    """
    For each variable in get_vars, find attribute accesses that occur
    AFTER the assignment but WITHOUT a preceding None guard.

    Returns a list of (attr_line, var_name, attr_name, assign_line).
    """
    violations: List[Tuple[int, str, str, int]] = []

    for var_name, assign_line in get_vars.items():
        guard_lines = _collect_guard_lines(func_node, var_name)

        for node in ast.walk(func_node):
            if (
                isinstance(node, ast.Attribute)
                and isinstance(node.value, ast.Name)
                and node.value.id == var_name
            ):
                attr_line = node.lineno

                # Only flag accesses that come after the assignment
                if attr_line <= assign_line:
                    continue

                # Check if any guard line appears before this attribute access
                has_guard_before = any(g < attr_line for g in guard_lines)

                if not has_guard_before:
                    violations.append((attr_line, var_name, node.attr, assign_line))

    # Deduplicate and sort by line number
    seen: set = set()
    unique: List[Tuple[int, str, str, int]] = []
    for v in sorted(violations, key=lambda x: x[0]):
        key = (v[0], v[1], v[2])
        if key not in seen:
            seen.add(key)
            unique.append(v)

    return unique


def check_source(source_code: str) -> Tuple[bool, str]:
    """
    Parse source_code with ast.parse and check for unguarded attribute accesses
    on variables assigned from .get() calls.

    Returns (clean: bool, details: str).
    """
    try:
        tree = ast.parse(source_code)
    except SyntaxError as exc:
        return False, f"SyntaxError at line {exc.lineno}: {exc.msg}"

    all_violations: List[Tuple[int, str, str, int]] = []

    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            get_vars = _find_get_assigned_vars(node)
            if not get_vars:
                continue
            violations = _find_unguarded_attr_accesses(node, get_vars)
            all_violations.extend(violations)

    if not all_violations:
        return True, "No unguarded attribute access on Optional values detected."

    lines = []
    for attr_line, var_name, attr_name, assign_line in all_violations:
        lines.append(
            f"Line {attr_line} — `{var_name}.{attr_name}` accessed without a "
            f"prior None check (variable assigned from `.get()` at line "
            f"{assign_line}, which can return None)"
        )

    details = (
        f"Found {len(all_violations)} unguarded access(es):\n"
        + "\n".join(f"  * {l}" for l in lines)
    )
    return False, details


def main() -> None:
    if len(sys.argv) < 2:
        result = {"clean": False, "details": "Usage: ast_null_check.py <source_file>"}
        print(json.dumps(result))
        sys.exit(3)

    source_file = sys.argv[1]
    try:
        with open(source_file, "r", encoding="utf-8") as f:
            source_code = f.read()
    except OSError as exc:
        result = {"clean": False, "details": f"Could not read file: {exc}"}
        print(json.dumps(result))
        sys.exit(3)

    clean, details = check_source(source_code)
    result = {"clean": clean, "details": details}
    print(json.dumps(result))
    sys.exit(0 if clean else 1)


if __name__ == "__main__":
    main()
