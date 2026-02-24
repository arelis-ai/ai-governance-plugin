# Platform Events, Policy Evaluation, and Risk

Creating single and batch events, emitting governance gate events, listing and
counting events, evaluating policies, and risk scoring across scenarios.

> Extracted from the comprehensive Python governance demo. See [setup-and-registration.md](setup-and-registration.md) for initialization.

## Single Event Creation

```python
run_id = f"run-events-demo-{uuid.uuid4()}"

ev1 = platform.events.create({
    "runId": run_id,
    "aiSystemId": ai_system_id,
    "eventType": "model.invoked",
    "actor": {"type": "human", "id": "demo-user"},
    "resource": {"type": "model", "id": MODEL_GEMINI},
    "action": "inference",
    "timestamp": now_iso(),
    "metadata": {"demo": True, "responseLength": 256},
})
```

## Batch Events

```python
batch = platform.events.createBatch([
    {
        "runId": run_id,
        "aiSystemId": ai_system_id,
        "eventType": "output.delivered",
        "actor": {"type": "human", "id": "demo-user"},
        "resource": {"type": "model", "id": MODEL_GEMINI},
        "action": "deliver",
        "timestamp": now_iso(),
        "metadata": {"outputLength": 256},
    },
    {
        "runId": run_id,
        "aiSystemId": ai_system_id,
        "eventType": "policy.evaluated",
        "actor": {"type": "human", "id": "demo-user"},
        "resource": {"type": "model", "id": MODEL_GEMINI},
        "action": "evaluate",
        "timestamp": now_iso(),
        "metadata": {"checkpoints": ["BeforePrompt"]},
    },
])
```

## Governance Gate Event

```python
platform.events.create({
    "runId": run_id,
    "aiSystemId": ai_system_id,
    "eventType": "governance.gate.evaluated",
    "actor": {"type": "human", "id": "demo-user"},
    "resource": {"type": "model", "id": MODEL_GEMINI},
    "action": "evaluate",
    "timestamp": now_iso(),
    "metadata": {
        "pii_detected": True,
        "pii_types": ["ssn", "email"],
        "pii_count": 2,
        "decision": "deny",
    },
})
```

## List and Count Events

```python
event_list = platform.events.list({"runId": run_id})
print(f"  Events found: {len(event_list.get('data', []))}")

count = platform.events.count({"runId": run_id})
print(f"  Event count: {count}")
```

## evaluatePolicy with PII (Denials)

```python
run_id = f"run-policy-eval-{uuid.uuid4()}"

result_pii = platform.governance.evaluatePolicy({
    "runId": run_id,
    "aiSystemId": ai_system_id,
    "checkpoint": {
        "content": {"pii_detected": True, "pii_types": ["ssn", "email"], "pii_count": 2},
    },
})
decisions = result_pii.get("decisions", [])
deny_count = sum(1 for d in decisions if d.get("decision") == "deny")
allow_count = sum(1 for d in decisions if d.get("decision") == "allow")
```

## evaluatePolicy Clean (All Allow)

```python
result_clean = platform.governance.evaluatePolicy({
    "runId": f"{run_id}-clean",
    "aiSystemId": ai_system_id,
    "checkpoint": {
        "content": {"pii_detected": False, "pii_types": [], "pii_count": 0},
    },
})
decisions = result_clean.get("decisions", [])
```

## Risk Evaluation (Low, Medium, High)

```python
scenarios = [
    {
        "label": "Low risk",
        "run_id": f"run-risk-low-{uuid.uuid4()}",
        "quotaState": {"usageRatio": 0.1},
        "evaluationSignals": [{"name": "output_check", "value": 0.01, "severity": "low"}],
        "explicitSignals": {"surface": "model", "outcome": "allowed"},
    },
    {
        "label": "Medium risk",
        "run_id": f"run-risk-med-{uuid.uuid4()}",
        "quotaState": {"usageRatio": 0.75},
        "evaluationSignals": [
            {"name": "pii_detected", "value": 1, "severity": "high"},
            {"name": "toxicity_score", "value": 0.6, "severity": "medium"},
        ],
        "explicitSignals": {"surface": "model", "outcome": "blocked"},
    },
    {
        "label": "High risk",
        "run_id": f"run-risk-high-{uuid.uuid4()}",
        "quotaState": {"usageRatio": 0.95},
        "evaluationSignals": [
            {"name": "pii_detected", "value": 1, "severity": "high"},
            {"name": "credential_leak", "value": 1, "severity": "high"},
            {"name": "toxicity_score", "value": 0.92, "severity": "high"},
            {"name": "prompt_injection", "value": 0.95, "severity": "high"},
        ],
        "explicitSignals": {"surface": "model", "outcome": "blocked", "environment": "prod"},
    },
]

for s in scenarios:
    risk = platform.risk.evaluate({
        "runId": s["run_id"],
        "aiSystemId": ai_system_id,
        "policyDecisions": [],
        "quotaState": s["quotaState"],
        "evaluationSignals": s["evaluationSignals"],
        "explicitSignals": s["explicitSignals"],
    })
    print(f"  {s['label']}: action={risk.get('action')}, score={risk.get('score')}")
```

**Key patterns:**

- Every event requires `runId`, `eventType`, `actor`, `resource`, `action`, and `timestamp`
- `aiSystemId` is included in events for system-level tracing
- `createBatch` accepts an array of event objects for efficient bulk ingestion
- `evaluatePolicy` takes a `checkpoint` with content signals; returns `decisions` array
- `aiSystemId` in `evaluatePolicy` enables system-specific policy matching; compatibility fallback retries without it on HTTP 400
- Risk `evaluationSignals` use `severity` field (`"low"`, `"medium"`, `"high"`)
- Risk `quotaState.usageRatio` ranges from 0.0 to 1.0
- Risk result contains `action` (e.g., `"allow"`, `"warn"`, `"block"`) and `score`
