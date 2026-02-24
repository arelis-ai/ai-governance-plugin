# Python SDK — Model Patterns

Direct model provider calls with governance wrapping.

---

## Key Difference from TypeScript

In Python, there is **no local governance client** (`createArelisClient`). You call model providers directly and use the Arelis platform for governance:

1. Call model provider (google-genai, anthropic, openai) directly
2. Before the call: evaluate platform policy (PII check)
3. After the call: emit events, assess risk, build causal graph

---

## Google Gemini — Basic Call

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

## Anthropic Claude — Basic Call

```python
import anthropic

async def generate_with_claude(prompt: str, user_id: str):
    platform = get_arelis_platform()
    run_id = f"run-chat-{uuid.uuid4()}"
    ai_system_id = await ensure_ai_system_registered(platform, "claude-sonnet-4")

    client = anthropic.Anthropic()
    message = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=1024,
        messages=[{"role": "user", "content": prompt}],
    )
    output = message.content[0].text

    # Emit governance events (same pattern as Gemini)
    await platform.events.create({
        "runId": run_id,
        "aiSystemId": ai_system_id,
        "eventType": "model.invoked",
        "actor": {"type": "human", "id": user_id},
        "resource": {"type": "model", "id": "claude-sonnet-4"},
        "action": "inference",
        "timestamp": datetime.utcnow().isoformat(),
        "metadata": {"responseLength": len(output)},
    })

    return output
```

---

## Streaming (Gemini)

```python
async def stream_with_governance(prompt: str, user_id: str):
    platform = get_arelis_platform()
    run_id = f"run-chat-{uuid.uuid4()}"
    ai_system_id = await ensure_ai_system_registered(platform, MODEL_ID)

    # Pre-invocation policy check (same as above)...

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
