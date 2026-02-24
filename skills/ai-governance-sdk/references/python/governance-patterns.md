# Python SDK — Governance Patterns

Policy evaluation, PII scanning, and governance gates.

---

## Pre-Invocation PII Gate

In Python, implement the PII gate manually since there's no `withGovernanceGate` wrapper:

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


async def evaluate_pre_invocation_gate(
    platform, run_id: str, prompt: str, ai_system_id: str, actor: dict
) -> dict:
    """Returns {"allowed": bool, "reason": str | None}"""
    pii = scan_for_pii(prompt)
    pii_types = list({f["type"] for f in pii["findings"]})

    eval_result = await platform.governance.evaluate_policy({
        "runId": run_id,
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

---

## Platform Policy CRUD

```python
async def setup_policies(platform):
    # List existing policies
    result = await platform.governance.policies.list({"search": "pii"})
    existing = result.get("data", [])

    if not any(p.get("key") == "pii-deny-before-invocation" for p in existing):
        await platform.governance.policies.create({
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

---

## Custom Policy Evaluation (BeforeToolCall / AfterToolResult)

```python
async def evaluate_before_tool_call(
    platform, run_id: str, tool_name: str, args: dict, trust_level: str, ctx: dict
) -> dict:
    """Evaluate policy before tool execution."""
    # Local PII scan on tool arguments
    serialized = str(args)
    pii = scan_for_pii(serialized)

    if pii["has_pii"] and ctx.get("environment") == "prod":
        return {"allowed": False, "reason": "PII detected in tool arguments"}

    if trust_level == "high" and ctx.get("environment") == "prod":
        return {"allowed": False, "reason": "High-trust tool requires escalation"}

    return {"allowed": True, "reason": None}


async def evaluate_after_tool_result(output: dict) -> dict:
    """Scan tool output for credential patterns."""
    output_str = str(output)
    cred_pattern = r"(?:api[_-]?key|secret|password|bearer\s+token|access[_-]?token)\s*[:=]\s*\S{8,}"
    if re.search(cred_pattern, output_str, re.IGNORECASE):
        return {"warnings": ["Credential-like pattern detected in tool output"]}
    return {"warnings": []}
```

---

## Error Handling

```python
async def safe_generate(platform, run_id, prompt, model_id, ai_system_id, actor, ctx):
    try:
        gate = await evaluate_pre_invocation_gate(
            platform, run_id, prompt, ai_system_id, actor
        )
        if not gate["allowed"]:
            return None, gate["reason"]

        # Call model provider directly...
        output = await call_model(prompt)
        return output, None

    except Exception as e:
        # Emit blocked event
        await platform.events.create({
            "runId": run_id,
            "aiSystemId": ai_system_id,
            "eventType": "model_invocation_blocked",
            "actor": actor,
            "resource": {"type": "model", "id": model_id},
            "action": "blocked_by_error",
            "timestamp": datetime.utcnow().isoformat(),
            "metadata": {"error": str(e)},
        })
        return None, str(e)
```
