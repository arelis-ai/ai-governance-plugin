# Python SDK — API Reference

Complete API surface for the `arelis` Python package.

---

## Installation

```bash
pip install arelis
```

---

## Client Creation

```python
from arelis import create_arelis_platform

platform = create_arelis_platform({
    "base_url": "https://api.arelis.digital",  # ARELIS_API_URL
    "api_key": "ak_sandbox_...",                # ARELIS_API_KEY
    "max_retries": 2,                           # default: 3
    "timeout": 15_000,                          # ms, default: 30_000
})
```

---

## Platform Namespaces

### events

```python
await platform.events.create({
    "runId": str,           # required
    "aiSystemId": str,      # required
    "eventType": str,       # required (e.g. "model.invoked")
    "actor": {"type": str, "id": str},   # required
    "resource": {"type": str, "id": str}, # required
    "action": str,          # required
    "timestamp": str,       # ISO 8601, required
    "metadata": dict,       # optional
})
# Returns: {"id": str, ...}
```

### ai_systems

```python
# Register
record = await platform.ai_systems.register({
    "name": str,            # required
    "type": str,            # required: "model" | "agent" | "pipeline" | "tool_chain"
    "provider": str,        # optional
    "modelRef": str,        # optional
    "version": str,         # optional
    "description": str,     # optional
    "config": dict,         # optional
    "metadata": dict,       # optional
    "tags": list[str],      # optional
})
# Returns: {"id": str, "slug": str, "name": str, "type": str, "status": str, ...}

# List
result = await platform.ai_systems.list({"type": "model", "status": "active"})
# Returns: {"data": [AiSystemRecord, ...], "nextCursor": str | None}

# Get
record = await platform.ai_systems.get(system_id)

# Update
record = await platform.ai_systems.update(system_id, {"name": "new-name"})

# Archive
record = await platform.ai_systems.archive(system_id)

# Set default
record = await platform.ai_systems.set_default(system_id)

# Summary
summary = await platform.ai_systems.summary(system_id, {"start": "2026-01-01", "end": "2026-02-01"})
# Returns: {"aiSystem": {...}, "period": {...}, "events": {...}, "risk": {...}, "proofs": {...}}
```

### governance

```python
# List policies
result = await platform.governance.policies.list({"search": "pii"})
# Returns: {"data": [PolicyRecord, ...]}

# Create policy
record = await platform.governance.policies.create({
    "key": str,
    "name": str,
    "condition": {"field": str, "operator": str, "value": Any},
    "action": "allow" | "deny",
    "severity": "low" | "medium" | "high" | "critical",
    "priority": int,
})

# Evaluate policy
result = await platform.governance.evaluate_policy({
    "runId": str,
    "checkpoint": {
        "content": dict,    # e.g. {"pii_detected": True, "pii_types": [...]}
    },
})
# Returns: {"decisions": [{"decision": "allow"|"deny", "policyId": str, "metadata": dict}]}
```

### risk

```python
result = await platform.risk.evaluate({
    "runId": str,
    "aiSystemId": str,
    "policyDecisions": list[dict],
    "quotaState": dict,          # optional
    "evaluationSignals": dict,   # optional
})
# Returns: {"action": str, "score": int, "deterministicInputsHash": str}
```

### graphs

```python
# Commit causal graph (MUST be called after startCausalGraph)
result = await platform.graphs.commit(run_id)
# Returns: {"rootHash": str}

# Get lineage
result = await platform.graphs.lineage(run_id, node_id)
# Returns: {"nodes": [...], "edges": [...]}
```

### replay

```python
# Start causal graph (MUST be called BEFORE graphs.commit)
result = await platform.replay.start_causal_graph({
    "runId": str,
    "nodes": [{"id": str, "type": str, "data": dict}, ...],
    "edges": [{"source": str, "target": str, "type": "sequence"}, ...],
})

# Start replay
result = await platform.replay.start({"runId": str, ...})

# Get replay result
result = await platform.replay.get(replay_id)

# List replays
result = await platform.replay.list({"cursor": str, "limit": int})

# Templates
template = await platform.replay.create_template({...})
templates = await platform.replay.list_templates({"runId": str})
template = await platform.replay.get_template(template_id)
```

### proofs

```python
# Create compliance proof
result = await platform.proofs.create({
    "runId": str,
    "aiSystemId": str,
    "schemaVersion": "v1",
})

# Verify proof
result = await platform.proofs.verify({"proofId": str})
# Returns: {"verified": bool, "evidence": dict}
```

---

## Key Differences from TypeScript SDK

| Feature | TypeScript | Python |
|---------|-----------|--------|
| Local governance client | `createArelisClient()` — full orchestration | Not available |
| Model calls | Via `client.models.generate()` | Direct provider SDK calls |
| Policy engine | Local `PolicyEngine` with checkpoints | Platform-side `evaluate_policy()` |
| Audit sink | Local sink + platform events | Platform events only |
| PII scanning | `scanPromptForPii()` from SDK | Implement with regex locally |
| Memory/quotas/secrets | Built-in namespaces | Not available (use external stores) |
| Agent runtime | `createAgentRuntime()` | Implement custom loop |
| Knowledge base | `createKBRegistry()` + RAG | Use external RAG solutions |
