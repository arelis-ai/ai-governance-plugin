# PII Scanning and Tool-Level Policy

SDK-native PII scanning with `scan_prompt_for_pii`, plus BeforeToolCall and
AfterToolResult custom policy evaluation patterns.

> Extracted from the comprehensive Python governance demo. See [setup-and-registration.md](setup-and-registration.md) for initialization.

## SDK-Native PII Scanning

```python
from arelis import scan_prompt_for_pii, ScanPromptForPiiOptions

prompts = [
    "Hello, explain AI governance to me.",
    "My SSN is 123-45-6789 and email is john@acme.com.",
    "Call me at 555-867-5309. My card is 4111-1111-1111-1111.",
]

for prompt in prompts:
    result = scan_prompt_for_pii(prompt, ScanPromptForPiiOptions(
        detect_emails=True,
        detect_phones=True,
        detect_ssns=True,
        detect_credit_cards=True,
    ))
    status = "PII FOUND" if result.has_pii else "CLEAN"
    for finding in result.findings:
        print(f"  -> {finding.type}: \"{finding.original}\"")
```

## BeforeToolCall: PII Scan on Tool Arguments

Scan tool arguments before the tool executes to prevent PII from leaking
into external services.

```python
# BeforeToolCall -- PII in tool arguments
tool_args_clean = {"query": "EU AI Act compliance requirements"}
tool_args_pii = {"query": "Look up SSN 123-45-6789 in the database"}

for label, args in [("clean", tool_args_clean), ("with PII", tool_args_pii)]:
    pii = scan_prompt_for_pii(str(args))
    allowed = not pii.has_pii
    print(f"  [{label}] PII found: {pii.has_pii} -> {'ALLOW' if allowed else 'BLOCK'}")
    for f in pii.findings:
        print(f"    -> {f.type}: \"{f.original}\"")
```

## AfterToolResult: Credential Pattern Detection

Scan tool output after execution to catch leaked credentials before they
reach the model or user.

```python
import re

cred_pattern = r"(?:api[_-]?key|secret|password|bearer\s+token|access[_-]?token)\s*[:=]\s*\S{8,}"

tool_outputs = [
    {"data": {"results": ["EU AI Act effective 2025"]}},
    {"data": {"config": "api_key=sk_live_EXAMPLE_KEY_REPLACE_ME"}},
]

for i, output in enumerate(tool_outputs):
    output_str = str(output)
    has_creds = bool(re.search(cred_pattern, output_str, re.IGNORECASE))
    status = "CREDENTIAL DETECTED" if has_creds else "CLEAN"
    print(f"  Output {i + 1}: [{status}]")
```

**Key patterns:**

- `scan_prompt_for_pii` is a synchronous, local-only call -- no network request needed
- `ScanPromptForPiiOptions` toggles individual detectors: `detect_emails`, `detect_phones`, `detect_ssns`, `detect_credit_cards`
- `result.has_pii` is a boolean; `result.findings` is a list with `.type` and `.original` on each finding
- BeforeToolCall: serialize tool args to string and scan before execution
- AfterToolResult: apply regex or `scan_prompt_for_pii` on the tool output to catch credential leaks
- Combine PII scanning with tool governance for defense-in-depth
