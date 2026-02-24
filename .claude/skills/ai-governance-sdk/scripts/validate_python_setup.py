#!/usr/bin/env python3
"""Validate Python AI Governance SDK setup.

Checks arelis package, environment variables, model provider SDKs,
and governance module configuration.

Usage:
    python scripts/validate_python_setup.py [--project-dir /path/to/project]
"""

import argparse
import importlib
import os
import sys
from pathlib import Path


def check_arelis_package() -> list[tuple[str, bool, str]]:
    """Check that the arelis package is installed and importable."""
    results = []
    try:
        mod = importlib.import_module("arelis")
        results.append(("arelis package installed", True, "Package found"))
        has_factory = hasattr(mod, "create_arelis_platform")
        results.append((
            "create_arelis_platform available",
            has_factory,
            "Main factory function" if has_factory else "Expected create_arelis_platform in arelis module",
        ))
    except ImportError:
        results.append(("arelis package installed", False, "Run: pip install arelis"))
    return results


def check_env_vars() -> list[tuple[str, bool, str]]:
    """Check required environment variables."""
    results = []

    required = {
        "ARELIS_API_KEY": "Arelis Platform API key (ak_sandbox_... or ak_prod_...)",
        "ARELIS_API_URL": "Arelis Platform base URL (https://api.arelis.digital)",
    }
    for var, desc in required.items():
        present = var in os.environ and len(os.environ[var]) > 0
        results.append((var, present, desc))

    # Check for at least one model provider key
    provider_keys = {
        "GEMINI_API_KEY": "Google Gemini",
        "ANTHROPIC_API_KEY": "Anthropic Claude",
        "OPENAI_API_KEY": "OpenAI",
    }
    found_providers = [
        name for key, name in provider_keys.items()
        if key in os.environ and len(os.environ[key]) > 0
    ]
    has_provider = len(found_providers) > 0
    detail = f"Found: {', '.join(found_providers)}" if has_provider else f"Set one of: {', '.join(provider_keys.keys())}"
    results.append(("Model provider API key", has_provider, detail))

    return results


def check_model_provider_sdks() -> list[tuple[str, bool, str]]:
    """Check that at least one model provider SDK is installed."""
    results = []
    providers = {
        "google.genai": "google-genai (Google Gemini)",
        "anthropic": "anthropic (Anthropic Claude)",
        "openai": "openai (OpenAI)",
    }

    found = []
    for module, name in providers.items():
        try:
            importlib.import_module(module)
            found.append(name)
        except ImportError:
            pass

    has_sdk = len(found) > 0
    detail = f"Found: {', '.join(found)}" if has_sdk else "Install at least one: pip install google-genai / anthropic / openai"
    results.append(("Model provider SDK installed", has_sdk, detail))

    return results


def check_governance_module(project_dir: Path) -> list[tuple[str, bool, str]]:
    """Check for a governance module with platform setup."""
    results = []

    # Search common locations
    candidates = []
    for pattern in ["governance.py", "*/governance.py", "*/*/governance.py"]:
        candidates.extend(project_dir.glob(pattern))

    # Filter out test files, venvs, and __pycache__
    candidates = [
        p for p in candidates
        if not any(part in str(p) for part in ["__pycache__", "venv", ".venv", "node_modules", "test"])
    ]

    if not candidates:
        results.append((
            "governance module exists",
            False,
            "Expected a governance.py file with create_arelis_platform setup",
        ))
        return results

    gov_path = candidates[0]
    results.append(("governance module exists", True, str(gov_path)))
    content = gov_path.read_text()

    # Check for platform client initialization
    has_platform = "create_arelis_platform" in content
    results.append((
        "uses create_arelis_platform",
        has_platform,
        "Must import and call create_arelis_platform" if not has_platform else "Found",
    ))

    # Check for singleton pattern
    has_singleton = (
        ("get_arelis_platform" in content or "get_platform" in content)
        or ("_platform" in content and ("global _platform" in content or "_platform = None" in content))
    )
    results.append((
        "singleton pattern",
        has_singleton,
        "Use module-level singleton for platform client" if not has_singleton else "Found",
    ))

    # Check for AI system registration
    has_registration = "ensure_ai_system_registered" in content or "ai_systems.register" in content
    results.append((
        "AI system registration",
        has_registration,
        "Add idempotent AI system registration helper" if not has_registration else "Found",
    ))

    # Check for PII scanning
    has_pii = "scan_for_pii" in content or "pii" in content.lower()
    results.append((
        "PII scanning",
        has_pii,
        "Add PII scanning function for pre-invocation gate" if not has_pii else "Found",
    ))

    return results


def main():
    parser = argparse.ArgumentParser(description="Validate Python AI Governance SDK setup")
    parser.add_argument(
        "--project-dir",
        type=Path,
        default=Path.cwd(),
        help="Path to the Python project root (default: cwd)",
    )
    args = parser.parse_args()
    project_dir = args.project_dir.resolve()

    print(f"Validating Python AI Governance SDK setup in: {project_dir}\n")

    sections = [
        ("Arelis Package", check_arelis_package()),
        ("Environment Variables", check_env_vars()),
        ("Model Provider SDKs", check_model_provider_sdks()),
        ("Governance Module", check_governance_module(project_dir)),
    ]

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

    print(f"Results: {total_pass} passed, {total_fail} failed")

    if total_fail > 0:
        print("\nAction required: fix the FAIL items above before proceeding.")
        sys.exit(1)
    else:
        print("\nAll checks passed. Python governance setup looks good.")
        sys.exit(0)


if __name__ == "__main__":
    main()
