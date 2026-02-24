# Python SDK — Governance Patterns

Policy evaluation, PII scanning, governance gates, and error handling.

---

## SDK-Provided PII Scanning (Recommended)

The Python SDK includes `scan_prompt_for_pii` — use this instead of implementing regex patterns manually:

```python
from arelis import scan_prompt_for_pii, ScanPromptForPiiOptions

result = scan_prompt_for_pii("My SSN is 123-45-6789 and email is john@example.com")
# result.has_pii = True
# result.findings = [
#   PromptPiiFinding(type="ssn", original="123-45-6789", start=10, end=21, ...),
#   PromptPiiFinding(type="email", original="john@example.com", start=32, end=48, ...),
# ]

# With custom options
result = scan_prompt_for_pii(text, ScanPromptForPiiOptions(
    detect_emails=True,
    detect_phones=True,
    detect_ssns=True,
    detect_credit_cards=True,
))
```

---

## Pre-Invocation Gate (SDK Function)

Use `evaluate_pre_invocation_gate` from the SDK for a complete pre-invocation policy check:

```python
from arelis import evaluate_pre_invocation_gate, EvaluatePreInvocationGateInput, ActorRef

decision = await evaluate_pre_invocation_gate(
    source=arelis.platform,  # ArelisPlatform instance (use arelis.platform or create_arelis_platform())
    input=EvaluatePreInvocationGateInput(
        prompt="User prompt here",
        actor=ActorRef(type="human", id="user_1"),
        run_id="run-123",
        model="gemini-2.5-flash",
        ai_system_id="ais_...",     # optional — forwarded to platform policy evaluation
        policy_ids=["pii-deny"],    # optional — specific policies
        context=ctx,                 # optional — GovernanceContext
    ),
)

if decision.decision == "deny":
    print(f"Blocked: {decision.reasons}")
    print(f"PII found: {decision.pii.has_pii}")
```

---

## Governance Gate Wrapper (SDK Function)

Use `with_governance_gate` to combine gate evaluation + invocation in one call:

```python
from arelis import with_governance_gate, WithGovernanceGateOptions, EvaluatePreInvocationGateInput, ActorRef

result = await with_governance_gate(
    source=arelis.platform,  # ArelisPlatform instance
    input=EvaluatePreInvocationGateInput(
        prompt="User prompt",
        actor=ActorRef(type="human", id="user_1"),
        ai_system_id="ais_...",  # optional — forwarded to gate telemetry events
    ),
    invoke=lambda: call_model(prompt),
    options=WithGovernanceGateOptions(
        deny_mode="return",  # "return" (default) or "throw"
    ),
)

if result.invoked:
    print(result.result)
else:
    print(f"Blocked: {result.decision}")
    for w in result.warnings or []:
        print(f"Warning: {w}")
```

> **Note:** For most use cases, prefer `governed_invoke` over `with_governance_gate` — it additionally handles event reporting and risk evaluation.

---

## Managed PII Config from Platform

Fetch PII configuration managed on the platform:

```python
from arelis import GetPiiConfigOptions

config = await arelis.governance.get_pii_config()
# Or with a custom namespace:
config = await arelis.governance.get_pii_config(GetPiiConfigOptions(namespace="pii.custom"))
```

---

## Platform Policy CRUD

```python
def setup_policies(platform):
    # List existing policies
    result = platform.governance.policies.list({"search": "pii"})
    existing = result.get("data", [])

    if not any(p.get("key") == "pii-deny-before-invocation" for p in existing):
        platform.governance.policies.create({
            "key": "pii-deny-before-invocation",
            "name": "PII Deny Before Model Invocation",
            "condition": {
                "field": "content.pii_detected",
                "operator": "eq",
                "value": True,
            },
            "action": "deny",
            "severity": "critical",
            "priority": 1,
        })
```

Additional policy operations:

```python
# Version management
platform.governance.policies.createVersion(policy_id, {...})
platform.governance.policies.listVersions(policy_id)
platform.governance.policies.activateVersion(policy_id, {"version": "v2"})

# Lifecycle
platform.governance.policies.transition(policy_id, {"status": "active"})
platform.governance.policies.rollback(policy_id, {"version": "v1"})

# Testing
platform.governance.policies.simulate(policy_id, {"checkpoint": {...}})
platform.governance.policies.bulkSimulate({"policies": [...], "checkpoint": {...}})
platform.governance.policies.impact(policy_id, {"changes": {...}})
```

---

## Custom Policy Evaluation (BeforeToolCall / AfterToolResult)

For tool-level governance in manual agent loops, use `scan_prompt_for_pii` on tool arguments:

```python
from arelis import scan_prompt_for_pii

async def evaluate_before_tool_call(
    tool_name: str, args: dict, trust_level: str, ctx: dict
) -> dict:
    """Evaluate policy before tool execution."""
    pii = scan_prompt_for_pii(str(args))

    if pii.has_pii and ctx.get("environment") == "prod":
        return {"allowed": False, "reason": "PII detected in tool arguments"}

    if trust_level == "high" and ctx.get("environment") == "prod":
        return {"allowed": False, "reason": "High-trust tool requires escalation"}

    return {"allowed": True, "reason": None}


async def evaluate_after_tool_result(output: dict) -> dict:
    """Scan tool output for credential patterns."""
    import re
    output_str = str(output)
    cred_pattern = r"(?:api[_-]?key|secret|password|bearer\s+token|access[_-]?token)\s*[:=]\s*\S{8,}"
    if re.search(cred_pattern, output_str, re.IGNORECASE):
        return {"warnings": ["Credential-like pattern detected in tool output"]}
    return {"warnings": []}
```

---

## Error Handling

```python
from arelis import (
    GovernanceGateDeniedError,
    PolicyBlockedError,
    is_governance_gate_denied_error,
    is_policy_blocked_error,
)

try:
    result = await arelis.governed_invoke(GovernedInvokeInput(
        model="gemini-2.5-flash",
        prompt=prompt,
        invoke=call_model,
        deny_mode="throw",  # raises on denial instead of returning
    ))
except GovernanceGateDeniedError as e:
    print(f"Gate denied: {e.decision}")
except PolicyBlockedError as e:
    print(f"Policy blocked: {e.reason}, run_id: {e.run_id}")
except Exception as e:
    print(f"Unexpected error: {e}")
```

---

## Manual Pre-Invocation Gate (Low-Level)

For cases where you need full control without using the SDK gate functions:

```python
import re
from datetime import datetime

PII_PATTERNS = [
    (r"\b\d{3}-\d{2}-\d{4}\b", "ssn"),
    (r"\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b", "phone"),
    (r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b", "email"),
    (r"\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b", "credit_card"),
]

def scan_for_pii(text: str) -> dict:
    findings = []
    for pattern, pii_type in PII_PATTERNS:
        if re.search(pattern, text):
            findings.append({"type": pii_type, "pattern": pattern})
    return {"has_pii": len(findings) > 0, "findings": findings}

def manual_pre_invocation_gate(
    platform, run_id: str, prompt: str, ai_system_id: str, actor: dict
) -> dict:
    pii = scan_for_pii(prompt)
    pii_types = list({f["type"] for f in pii["findings"]})

    eval_result = platform.governance.evaluatePolicy({
        "runId": run_id,
        "aiSystemId": ai_system_id,
        "checkpoint": {
            "content": {
                "pii_detected": pii["has_pii"],
                "pii_types": pii_types,
                "pii_count": len(pii["findings"]),
            }
        },
    })

    for d in eval_result.get("decisions", []):
        if d.get("decision") == "deny":
            return {
                "allowed": False,
                "reason": f"Denied by {d.get('metadata', {}).get('policyName', d.get('policyId'))}",
                "pii": pii,
            }

    return {"allowed": True, "reason": None, "pii": pii}
```
