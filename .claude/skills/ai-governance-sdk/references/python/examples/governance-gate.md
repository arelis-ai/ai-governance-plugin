# Governance Gate

Standalone governance gate (`with_governance_gate`) and manual pre-invocation
gate (`evaluate_pre_invocation_gate`) for fine-grained control.

> Extracted from the comprehensive Python governance demo. See [setup-and-registration.md](setup-and-registration.md) for initialization.

## Helper: async_wrap

```python
def async_wrap(value):
    """Wrap a plain value in an async callable (required by with_governance_gate)."""
    async def _fn():
        return value
    return _fn
```

## with_governance_gate: Clean Prompt (ALLOW)

```python
from arelis import (
    with_governance_gate, WithGovernanceGateOptions,
    EvaluatePreInvocationGateInput, ActorRef, generate_run_id,
)

result_clean = await with_governance_gate(
    source=arelis.platform,
    input=EvaluatePreInvocationGateInput(
        prompt="Explain AI governance best practices.",
        actor=ActorRef(type="human", id="demo-user"),
        run_id=generate_run_id(),
        model=MODEL_GEMINI,
        ai_system_id=ai_system_id,
    ),
    invoke=async_wrap("Simulated model response for clean prompt"),
    options=WithGovernanceGateOptions(
        deny_mode="return",
        detect_emails=True,
        detect_ssns=True,
    ),
)
# result_clean.invoked == True
# result_clean.decision.decision == "allow"
# result_clean.result contains the invoke return value
```

## with_governance_gate: PII Prompt (DENY)

```python
result_pii = await with_governance_gate(
    source=arelis.platform,
    input=EvaluatePreInvocationGateInput(
        prompt="My SSN is 123-45-6789. Help me file taxes.",
        actor=ActorRef(type="human", id="demo-user"),
        run_id=generate_run_id(),
        model=MODEL_GEMINI,
        ai_system_id=ai_system_id,
    ),
    invoke=async_wrap("This should not be reached"),
    options=WithGovernanceGateOptions(deny_mode="return"),
)
# result_pii.invoked == False
# result_pii.decision.decision == "deny"
# result_pii.decision.pii.has_pii == True
# result_pii.decision.reasons contains denial reasons
```

## evaluate_pre_invocation_gate: Manual Gate with Context

```python
from arelis import (
    evaluate_pre_invocation_gate, EvaluatePreInvocationGateInput,
    ScanPromptForPiiOptions, GovernanceContext, OrgRef, ActorRef,
    generate_run_id,
)

ctx = GovernanceContext(
    org=OrgRef(id="org_demo", name="Demo Corp"),
    actor=ActorRef(type="human", id="demo-user", email="demo@corp.com", roles=["analyst"]),
    purpose="compliance-check",
    environment="dev",
    session_id=f"sess_{uuid.uuid4().hex[:8]}",
    tags={"feature": "governance-demo"},
)

decision = await evaluate_pre_invocation_gate(
    source=arelis.platform,
    input=EvaluatePreInvocationGateInput(
        prompt="Analyze compliance gaps for our high-risk AI system.",
        actor=ActorRef(type="human", id="demo-user"),
        run_id=generate_run_id(),
        model=MODEL_GEMINI,
        ai_system_id=ai_system_id,
        context=ctx,
    ),
    options=ScanPromptForPiiOptions(
        detect_emails=True,
        detect_phones=True,
        detect_ssns=True,
        detect_credit_cards=True,
    ),
)
# decision.decision -- "allow" or "deny"
# decision.pii.has_pii -- boolean
# decision.policy -- platform policy evaluation result
# decision.metadata.timings -- gate timing breakdown
```

**Key patterns:**

- `with_governance_gate` wraps an async invoke callable; use `async_wrap` for plain values
- `source=arelis.platform` routes policy evaluation to the platform API
- `ai_system_id` in the input is forwarded to platform policy evaluation and gate telemetry
- `evaluate_pre_invocation_gate` returns a decision object without invoking any model
- `GovernanceContext` carries org, actor, purpose, environment, session, and tags
- `ScanPromptForPiiOptions` toggles individual PII detectors for the gate
