#!/usr/bin/env python3
"""Validate AI Governance SDK governance setup in a project.

Supports both TypeScript (Next.js) and Python projects.

Usage:
    python scripts/validate_governance_setup.py [--project-dir /path/to/project] [--lang ts|py]
"""

import argparse
import os
import re
import sys
from pathlib import Path


# ─── TypeScript Checks ────────────────────────────────────────────────────────

def check_ts_env_vars() -> list[tuple[str, bool, str]]:
    """Check required environment variables for TypeScript."""
    required = {
        "GEMINI_API_KEY": "Model provider API key for Gemini",
        "ARELIS_API_KEY": "Arelis Platform API key (ak_sandbox_... or ak_prod_...)",
    }
    results = []
    for var, desc in required.items():
        present = var in os.environ and len(os.environ[var]) > 0
        results.append((var, present, desc))
    has_api_url = "ARELIS_API_URL" in os.environ and len(os.environ["ARELIS_API_URL"]) > 0
    results.append((
        "ARELIS_API_URL (optional)",
        True,
        "Set" if has_api_url else "Unset (using SDK default https://api.arelis.digital)",
    ))
    return results


def check_governance_module(project_dir: Path) -> list[tuple[str, bool, str]]:
    """Check that governance.ts exports required functions."""
    results = []
    gov_path = project_dir / "src" / "lib" / "governance.ts"

    if not gov_path.exists():
        results.append(("governance.ts exists", False, f"Expected at {gov_path}"))
        return results

    results.append(("governance.ts exists", True, str(gov_path)))
    content = gov_path.read_text()

    def has_export(name: str) -> bool:
        pattern = rf"export\s+(?:async\s+)?(?:function|const|let)\s+{name}\b"
        return bool(re.search(pattern, content))

    uses_unified = "createArelis(" in content

    has_client_entry = has_export("getGovernanceClient") or has_export("getArelis")
    results.append((
        "exports governance entrypoint",
        has_client_entry,
        "Export getGovernanceClient() (split pattern) or getArelis() (unified pattern)",
    ))

    has_platform_entry = has_export("getArelisPlatform") or has_export("getArelis")
    results.append((
        "exports platform entrypoint",
        has_platform_entry,
        "Export getArelisPlatform() (split pattern) or getArelis() (unified pattern)",
    ))

    has_ai_system_helper = has_export("ensureAiSystemRegistered") or uses_unified
    results.append((
        "AI system registration strategy",
        has_ai_system_helper,
        "Define ensureAiSystemRegistered() for split pattern, or use createArelis orchestration",
    ))

    return results


def check_next_config(project_dir: Path) -> list[tuple[str, bool, str]]:
    """Check next.config.ts has serverExternalPackages."""
    results = []

    config_path = None
    for ext in ["ts", "mjs", "js"]:
        candidate = project_dir / f"next.config.{ext}"
        if candidate.exists():
            config_path = candidate
            break

    if not config_path:
        results.append(("next.config exists", False, "No next.config.{ts,mjs,js} found"))
        return results

    results.append(("next.config exists", True, str(config_path)))
    content = config_path.read_text()

    has_external = "serverExternalPackages" in content
    results.append((
        "serverExternalPackages configured",
        has_external,
        "Must include '@arelis-ai/ai-governance-sdk'" if not has_external else "Found",
    ))

    if has_external:
        has_sdk = "@arelis-ai/ai-governance-sdk" in content
        results.append((
            "SDK in serverExternalPackages",
            has_sdk,
            "Add '@arelis-ai/ai-governance-sdk' to the array",
        ))

    return results


def check_instrumentation(project_dir: Path) -> list[tuple[str, bool, str]]:
    """Check instrumentation.ts exists with require polyfill."""
    results = []
    instr_path = project_dir / "src" / "instrumentation.ts"

    if not instr_path.exists():
        results.append((
            "instrumentation.ts exists",
            False,
            f"Expected at {instr_path} — needed for ULID crypto polyfill",
        ))
        return results

    results.append(("instrumentation.ts exists", True, str(instr_path)))
    content = instr_path.read_text()

    has_register = "export" in content and "register" in content
    results.append(("exports register()", has_register, "Must export async register()"))

    has_require_polyfill = "globalThis" in content and "require" in content
    results.append((
        "require polyfill present",
        has_require_polyfill,
        "Polyfills globalThis.require for ULID in Turbopack ESM runtime",
    ))

    return results


# ─── Python Checks ────────────────────────────────────────────────────────────

def check_py_env_vars() -> list[tuple[str, bool, str]]:
    """Check required environment variables for Python."""
    required = {
        "ARELIS_API_KEY": "Arelis Platform API key (ak_sandbox_... or ak_prod_...)",
        "ARELIS_API_URL": "Arelis Platform base URL (https://api.arelis.digital)",
    }
    results = []
    for var, desc in required.items():
        present = var in os.environ and len(os.environ[var]) > 0
        results.append((var, present, desc))

    # Check for at least one model provider key
    provider_keys = ["GEMINI_API_KEY", "ANTHROPIC_API_KEY", "OPENAI_API_KEY"]
    has_provider = any(
        k in os.environ and len(os.environ[k]) > 0 for k in provider_keys
    )
    results.append((
        "Model provider API key",
        has_provider,
        f"At least one of: {', '.join(provider_keys)}",
    ))
    return results


def check_py_arelis_importable() -> list[tuple[str, bool, str]]:
    """Check that the arelis package is importable."""
    results = []
    try:
        import importlib
        importlib.import_module("arelis")
        results.append(("arelis package importable", True, "pip install arelis"))
    except ImportError:
        results.append(("arelis package importable", False, "Run: pip install arelis"))
    return results


def check_py_governance_module(project_dir: Path) -> list[tuple[str, bool, str]]:
    """Check for a Python governance module with platform setup."""
    results = []

    # Search common locations
    candidates = [
        project_dir / "governance.py",
        project_dir / "src" / "governance.py",
        project_dir / "app" / "governance.py",
    ]
    # Also search for any governance.py recursively (up to 3 levels)
    for p in project_dir.glob("**/governance.py"):
        if p not in candidates and len(p.relative_to(project_dir).parts) <= 3:
            candidates.append(p)

    found_path = None
    for candidate in candidates:
        if candidate.exists():
            found_path = candidate
            break

    if not found_path:
        results.append((
            "governance module exists",
            False,
            "Expected governance.py with create_arelis_platform setup",
        ))
        return results

    results.append(("governance module exists", True, str(found_path)))
    content = found_path.read_text()

    has_platform = "create_arelis_platform" in content
    results.append((
        "uses create_arelis_platform",
        has_platform,
        "Must initialize Arelis platform client",
    ))

    has_singleton = "get_arelis_platform" in content or "_platform" in content
    results.append((
        "singleton pattern",
        has_singleton,
        "Platform client should be a module-level singleton",
    ))

    return results


# ─── Main ─────────────────────────────────────────────────────────────────────

def run_checks(sections: list[tuple[str, list[tuple[str, bool, str]]]]) -> tuple[int, int]:
    total_pass = 0
    total_fail = 0

    for title, checks in sections:
        print(f"--- {title} ---")
        for name, passed, detail in checks:
            status = "PASS" if passed else "FAIL"
            icon = "+" if passed else "!"
            print(f"  [{icon}] {status}: {name}")
            if not passed:
                print(f"        -> {detail}")
                total_fail += 1
            else:
                total_pass += 1
        print()

    return total_pass, total_fail


def main():
    parser = argparse.ArgumentParser(description="Validate AI Governance SDK governance setup")
    parser.add_argument(
        "--project-dir",
        type=Path,
        default=Path.cwd(),
        help="Path to the project root (default: cwd)",
    )
    parser.add_argument(
        "--lang",
        choices=["ts", "py"],
        default="ts",
        help="Language to validate: ts (TypeScript/Next.js) or py (Python). Default: ts",
    )
    args = parser.parse_args()
    project_dir = args.project_dir.resolve()

    print(f"Validating AI Governance SDK setup ({args.lang}) in: {project_dir}\n")

    if args.lang == "ts":
        sections = [
            ("Environment Variables", check_ts_env_vars()),
            ("Governance Module (src/lib/governance.ts)", check_governance_module(project_dir)),
            ("Next.js Configuration", check_next_config(project_dir)),
            ("Instrumentation (src/instrumentation.ts)", check_instrumentation(project_dir)),
        ]
    else:
        sections = [
            ("Environment Variables", check_py_env_vars()),
            ("Arelis Package", check_py_arelis_importable()),
            ("Governance Module", check_py_governance_module(project_dir)),
        ]

    total_pass, total_fail = run_checks(sections)

    print(f"Results: {total_pass} passed, {total_fail} failed")

    if total_fail > 0:
        print("\nAction required: fix the FAIL items above before proceeding.")
        sys.exit(1)
    else:
        print("\nAll checks passed. Governance setup looks good.")
        sys.exit(0)


if __name__ == "__main__":
    main()
