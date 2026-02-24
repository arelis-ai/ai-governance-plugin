# Governed Invoke

High-level `governed_invoke` wrapping model calls with automatic PII scanning,
policy evaluation, risk assessment, and telemetry.

> Extracted from the comprehensive Python governance demo. See [setup-and-registration.md](setup-and-registration.md) for initialization.

## Governed Invoke with Gemini (Clean Prompt)

```python
from arelis import GovernedInvokeInput, GovernanceContext, ActorRef, OrgRef

result_gemini = await arelis.governed_invoke(GovernedInvokeInput(
    model=MODEL_GEMINI,
    prompt="List three key principles of responsible AI in one sentence each.",
    invoke=lambda sanitized: gemini_client.models.generate_content(
        model=MODEL_GEMINI, contents=sanitized
    ).text,
    actor=ActorRef(type="human", id="demo-user"),
    context=GovernanceContext(
        org=OrgRef(id="org_demo", name="Demo Corp"),
        actor=ActorRef(type="human", id="demo-user"),
        purpose="governance-demo",
        environment="dev",
    ),
    deny_mode="return",
    include_risk=True,
))
```

## Governed Invoke with Claude (Clean Prompt)

```python
result_claude = await arelis.governed_invoke(GovernedInvokeInput(
    model=MODEL_CLAUDE,
    prompt="What are the three most important AI compliance considerations for enterprises?",
    invoke=lambda sanitized: anthropic_client.messages.create(
        model=MODEL_CLAUDE,
        max_tokens=512,
        messages=[{"role": "user", "content": sanitized}],
    ).content[0].text,
    actor=ActorRef(type="human", id="demo-user"),
    context=GovernanceContext(
        org=OrgRef(id="org_demo", name="Demo Corp"),
        actor=ActorRef(type="human", id="demo-user"),
        purpose="governance-demo",
        environment="dev",
    ),
    deny_mode="return",
))
```

## Governed Invoke with PII (Blocked Path)

```python
result_blocked = await arelis.governed_invoke(GovernedInvokeInput(
    model=MODEL_GEMINI,
    prompt="My SSN is 123-45-6789 and my email is sensitive@secret.com. Summarize my taxes.",
    invoke=lambda sanitized: "SHOULD NOT REACH HERE",
    deny_mode="return",
))
# result_blocked.invoked == False
# result_blocked.decision.decision == "deny"
# result_blocked.decision.pii.has_pii == True
# result_blocked.decision.codes contains denial reason codes
```

## Governed Invoke with deny_mode="throw"

```python
from arelis import GovernanceGateDeniedError, is_governance_gate_denied_error

try:
    await arelis.governed_invoke(GovernedInvokeInput(
        model=MODEL_GEMINI,
        prompt="SSN 999-88-7777 -- process this immediately.",
        invoke=lambda s: "SHOULD NOT REACH",
        deny_mode="throw",
    ))
except GovernanceGateDeniedError as e:
    print(f"  Caught GovernanceGateDeniedError: {e.decision}")
    print(f"  is_governance_gate_denied_error: {is_governance_gate_denied_error(e)}")
```

## Result Inspection

```python
print(f"  Run ID: {result_gemini.run_id}")
print(f"  Invoked: {result_gemini.invoked}")
print(f"  Sanitized prompt: \"{result_gemini.sanitized_prompt[:80]}...\"")
if result_gemini.invoked:
    print(f"  Response: \"{str(result_gemini.result)[:150]}...\"")
print(f"  Risk: {result_gemini.risk}")
for w in result_gemini.warnings or []:
    print(f"  Warning: {w}")
```

**Key patterns:**

- `GovernedInvokeInput.invoke` receives the sanitized prompt and calls the provider -- it can be any callable
- `deny_mode="return"` returns a result with `invoked=False`; `deny_mode="throw"` raises `GovernanceGateDeniedError`
- `include_risk=True` attaches a risk score to the result
- `GovernanceContext` provides org, actor, purpose, and environment for policy evaluation
- The `aiSystemId` set at client init is auto-forwarded; no need to pass it per call
- Result fields: `run_id`, `invoked`, `sanitized_prompt`, `result`, `decision`, `risk`, `warnings`
