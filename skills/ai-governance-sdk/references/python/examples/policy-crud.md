# Policy CRUD

Platform policy lifecycle: list, create, version, list versions, and simulate
policy evaluation.

> Extracted from the comprehensive Python governance demo. See [setup-and-registration.md](setup-and-registration.md) for initialization.

## Policy List and Idempotent Create

```python
POLICY_KEY = "demo-content-safety"

# List existing
existing = platform.governance.policies.list({"search": POLICY_KEY})
match = next((p for p in existing.get("data", []) if p.get("key") == POLICY_KEY), None)

if match:
    policy_id = match["id"]
else:
    # Create policy
    policy = platform.governance.policies.create({
        "key": POLICY_KEY,
        "name": "Content Safety Gate",
        "description": "Blocks prompts with unsafe content signals.",
        "condition": {
            "field": "content.toxicity_score",
            "operator": "gt",
            "value": 0.8,
        },
        "action": "deny",
        "severity": "high",
        "priority": 2,
    })
    policy_id = policy["id"]
```

## Create a Policy Version

```python
version = platform.governance.policies.createVersion(policy_id, {
    "condition": {
        "field": "content.toxicity_score",
        "operator": "gt",
        "value": 0.7,
    },
    "action": "deny",
    "severity": "critical",
})
```

## List Policy Versions

```python
versions = platform.governance.policies.listVersions(policy_id)
print(f"  Versions: {len(versions.get('data', []))}")
```

## Simulate Policy Evaluation

```python
sim_result = platform.governance.policies.simulate(policy_id, {
    "checkpoint": {
        "content": {"toxicity_score": 0.95},
    },
})
```

**Key patterns:**

- Use `policies.list({"search": key})` + key match for idempotent create (avoid duplicates)
- Policy `condition` uses `{"field": ..., "operator": ..., "value": ...}` format
- Supported operators include `gt`, `lt`, `eq`, `gte`, `lte`, `contains`
- `createVersion` creates a new version of an existing policy (with updated condition/action/severity)
- `simulate` dry-runs policy evaluation against a checkpoint without affecting live state
- `action` can be `"deny"` or `"allow"`; `severity` can be `"low"`, `"medium"`, `"high"`, `"critical"`
