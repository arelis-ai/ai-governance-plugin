# Python SDK — Model Patterns

Model invocation with governance orchestration.

---

## Table of Contents

- [Platform-First governed_invoke (Recommended)](#platform-first-governed_invoke-recommended)
- [Google Gemini — governed_invoke](#google-gemini--governed_invoke)
- [Anthropic Claude — governed_invoke](#anthropic-claude--governed_invoke)
- [Manual Governance Wrapping (Low-Level)](#manual-governance-wrapping-low-level)
- [Streaming (Gemini)](#streaming-gemini)

---

## Platform-First governed_invoke (Recommended)

Use `create_arelis(...).governed_invoke(...)` for pre-invocation gate + PII redaction + platform reporting in one call:

```python
import os
from arelis import create_arelis, GovernedInvokeInput

arelis = create_arelis({
    "platform": {
        "apiKey": os.environ["ARELIS_API_KEY"],
        **({"baseUrl": os.environ["ARELIS_API_URL"]} if os.environ.get("ARELIS_API_URL") else {}),
    }
})

result = await arelis.governed_invoke(GovernedInvokeInput(
    model="gemini-2.5-flash",
    prompt="Summarize AI governance controls in two bullets.",
    deny_mode="return",
    invoke=lambda sanitized_prompt: call_model(sanitized_prompt),
))

if result.invoked:
    print(result.result)
    print(f"Risk: {result.risk}")
else:
    print(f"Blocked: {result.decision}")

for warning in result.warnings or []:
    print(f"Warning: {warning}")
```

### What governed_invoke handles automatically

1. Generates `run_id` if not provided
2. Loads PII configuration from platform
3. Redacts PII from prompt using managed config
4. Evaluates pre-invocation governance gate
5. If blocked: returns result with `invoked=False` (or raises if `deny_mode="throw"`)
6. If allowed: executes the `invoke` callable with sanitized prompt
7. Reports events to platform (request, response/error, blocked)
8. Evaluates risk based on policy decisions
9. Returns complete `GovernedInvokeResult`

---

## Google Gemini — governed_invoke

```python
import os
from arelis import create_arelis, GovernedInvokeInput
from google import genai

arelis = create_arelis({
    "platform": {
        "apiKey": os.environ["ARELIS_API_KEY"],
        **({"baseUrl": os.environ["ARELIS_API_URL"]} if os.environ.get("ARELIS_API_URL") else {}),
    }
})

MODEL_ID = "gemini-2.5-flash"
gemini = genai.Client(api_key=os.environ["GEMINI_API_KEY"])

async def generate_with_governance(prompt: str, user_id: str):
    result = await arelis.governed_invoke(GovernedInvokeInput(
        model=MODEL_ID,
        prompt=prompt,
        invoke=lambda sanitized: gemini.models.generate_content(
            model=MODEL_ID, contents=sanitized
        ).text,
        actor={"type": "human", "id": user_id},
        context={
            "org": {"id": "org_123", "name": "Acme"},
            "purpose": "chat",
            "environment": "prod",
        },
        deny_mode="return",
    ))

    if not result.invoked:
        return None, f"Blocked: {result.decision}"

    return result.result, None
```

---

## Anthropic Claude — governed_invoke

```python
import anthropic
from arelis import create_arelis, GovernedInvokeInput

arelis = create_arelis({
    "platform": {
        "apiKey": os.environ["ARELIS_API_KEY"],
        **({"baseUrl": os.environ["ARELIS_API_URL"]} if os.environ.get("ARELIS_API_URL") else {}),
    }
})

claude = anthropic.Anthropic()

async def generate_with_claude(prompt: str, user_id: str):
    result = await arelis.governed_invoke(GovernedInvokeInput(
        model="claude-sonnet-4",
        prompt=prompt,
        invoke=lambda sanitized: claude.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=1024,
            messages=[{"role": "user", "content": sanitized}],
        ).content[0].text,
        actor={"type": "human", "id": user_id},
        context={
            "org": {"id": "org_123", "name": "Acme"},
            "purpose": "chat",
            "environment": "prod",
        },
        deny_mode="return",
    ))

    if not result.invoked:
        return None, f"Blocked: {result.decision}"

    return result.result, None
```

---

## Manual Governance Wrapping (Low-Level)

For cases where you need fine-grained control over each governance step, use `create_arelis_platform` directly. This is the low-level pattern — prefer `governed_invoke` for new code.

```python
from google import genai
from .governance import get_arelis_platform, ensure_ai_system_registered
import re
import uuid
from datetime import datetime

MODEL_ID = "gemini-2.5-flash"

async def generate_with_governance(prompt: str, user_id: str):
    platform = get_arelis_platform()
    run_id = f"run-chat-{uuid.uuid4()}"
    ai_system_id = await ensure_ai_system_registered(platform, MODEL_ID)

    ctx = {
        "org": {"id": "org_123", "name": "Acme"},
        "actor": {"type": "human", "id": user_id},
        "purpose": "chat",
        "environment": "prod",
    }

    # Pre-invocation: PII check via platform policy
    pii_detected = bool(re.search(r"\b\d{3}-\d{2}-\d{4}\b", prompt))
    eval_result = await platform.governance.evaluate_policy({
        "runId": run_id,
        "checkpoint": {
            "content": {
                "pii_detected": pii_detected,
                "pii_types": ["ssn"] if pii_detected else [],
                "pii_count": 1 if pii_detected else 0,
            }
        },
    })

    # Check for deny
    for d in eval_result.get("decisions", []):
        if d.get("decision") == "deny":
            await platform.events.create({
                "runId": run_id,
                "aiSystemId": ai_system_id,
                "eventType": "model_invocation_blocked",
                "actor": ctx["actor"],
                "resource": {"type": "model", "id": MODEL_ID},
                "action": "blocked_by_policy",
                "timestamp": datetime.utcnow().isoformat(),
                "metadata": {"pii_detected": pii_detected},
            })
            return None, "Blocked by policy: PII detected"

    # Direct model call
    client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
    response = client.models.generate_content(
        model=MODEL_ID,
        contents=prompt,
    )
    output = response.text

    # Post-call: emit events
    await platform.events.create({
        "runId": run_id,
        "aiSystemId": ai_system_id,
        "eventType": "model.invoked",
        "actor": ctx["actor"],
        "resource": {"type": "model", "id": MODEL_ID},
        "action": "inference",
        "timestamp": datetime.utcnow().isoformat(),
        "metadata": {"responseLength": len(output)},
    })
    await platform.events.create({
        "runId": run_id,
        "aiSystemId": ai_system_id,
        "eventType": "output.delivered",
        "actor": ctx["actor"],
        "resource": {"type": "model", "id": MODEL_ID},
        "action": "deliver",
        "timestamp": datetime.utcnow().isoformat(),
        "metadata": {"outputLength": len(output)},
    })

    return output, None
```

---

## Streaming (Gemini)

Streaming still requires manual governance wrapping since `governed_invoke` expects a single return value:

```python
async def stream_with_governance(prompt: str, user_id: str):
    platform = get_arelis_platform()
    run_id = f"run-chat-{uuid.uuid4()}"
    ai_system_id = await ensure_ai_system_registered(platform, MODEL_ID)

    # Pre-invocation policy check (same as manual pattern above)...

    client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
    output = ""

    for chunk in client.models.generate_content_stream(
        model=MODEL_ID,
        contents=prompt,
    ):
        if chunk.text:
            output += chunk.text
            yield chunk.text  # Stream to caller

    # Post-stream pipeline (emit events, risk, proofs, causal graph)
    # See platform-pipeline.md for full implementation
```
