# Python SDK — Platform Pipeline

Events, risk assessment, compliance proofs, and causal graphs.

---

## Full Post-Stream Pipeline

After every successful model call, execute these 8 steps sequentially:

```python
from datetime import datetime

async def run_post_stream_pipeline(
    platform,
    run_id: str,
    ai_system_id: str,
    actor: dict,
    model_id: str,
    total_output: str,
    pii_result: dict,
    ctx: dict,
):
    """Execute the full 8-step post-stream governance pipeline."""
    timestamp = datetime.utcnow().isoformat()
    pii_types = list({f["type"] for f in pii_result.get("findings", [])})

    # A. Extract policy decisions (from local state in Python)
    policy_decisions = []  # Populate from your pre-invocation gate result

    # B. Emit policy.evaluated event
    try:
        await platform.events.create({
            "runId": run_id,
            "aiSystemId": ai_system_id,
            "eventType": "policy.evaluated",
            "actor": actor,
            "resource": {"type": "model", "id": model_id},
            "action": "evaluate",
            "timestamp": timestamp,
            "metadata": {
                "checkpoints": ["BeforePrompt", "AfterModelOutput"],
                "decisionsCount": len(policy_decisions),
                "pii_detected": pii_result.get("has_pii", False),
                "pii_types": pii_types,
            },
        })
    except Exception as e:
        print(f"[Arelis] policy.evaluated event failed: {e}")

    # C. Emit model.invoked + output.delivered events
    try:
        await platform.events.create({
            "runId": run_id,
            "aiSystemId": ai_system_id,
            "eventType": "model.invoked",
            "actor": actor,
            "resource": {"type": "model", "id": model_id},
            "action": "inference",
            "timestamp": timestamp,
            "metadata": {
                "responseLength": len(total_output),
                "purpose": ctx.get("purpose"),
                "environment": ctx.get("environment"),
            },
        })
        await platform.events.create({
            "runId": run_id,
            "aiSystemId": ai_system_id,
            "eventType": "output.delivered",
            "actor": actor,
            "resource": {"type": "model", "id": model_id},
            "action": "deliver",
            "timestamp": timestamp,
            "metadata": {"outputLength": len(total_output), "containsPII": False},
        })
    except Exception as e:
        print(f"[Arelis] Failed to emit platform events: {e}")

    # D. Post-stream policy evaluation (AfterModelOutput)
    try:
        await platform.governance.evaluate_policy({
            "runId": run_id,
            "checkpoint": {
                "type": "AfterModelOutput",
                "content": {"output_length": len(total_output)},
            },
        })
    except Exception as e:
        print(f"[Arelis] Post-stream evaluatePolicy failed: {e}")

    # E. Risk evaluation
    try:
        await platform.risk.evaluate({
            "runId": run_id,
            "aiSystemId": ai_system_id,
            "policyDecisions": policy_decisions,
        })
    except Exception as e:
        print(f"[Arelis] risk.evaluate failed: {e}")

    # F. Compliance proof
    try:
        await platform.proofs.create({
            "runId": run_id,
            "aiSystemId": ai_system_id,
            "schemaVersion": "v1",
        })
    except Exception as e:
        print(f"[Arelis] proofs.create failed: {e}")

    # G. Causal graph (MUST precede commit)
    graph_events = [
        {"eventId": f"{run_id}-policy-evaluated", "eventType": "policy.evaluated", "action": "evaluate"},
        {"eventId": f"{run_id}-model-invoked", "eventType": "model.invoked", "action": "inference"},
        {"eventId": f"{run_id}-output-delivered", "eventType": "output.delivered", "action": "deliver"},
    ]
    nodes = [
        {"id": ev["eventId"], "type": ev["eventType"], "data": {"action": ev["action"], "timestamp": timestamp}}
        for ev in graph_events
    ]
    edges = [
        {"source": graph_events[i - 1]["eventId"], "target": graph_events[i]["eventId"], "type": "sequence"}
        for i in range(1, len(graph_events))
    ]
    try:
        await platform.replay.start_causal_graph({"runId": run_id, "nodes": nodes, "edges": edges})
    except Exception as e:
        print(f"[Arelis] startCausalGraph failed: {e}")

    # H. Commit causal graph (ALWAYS LAST)
    try:
        await platform.graphs.commit(run_id)
    except Exception as e:
        print(f"[Arelis] graphs.commit failed: {e}")
```

---

## Event Reporting Conventions

- **Always `await`** platform calls — use try/except to swallow errors
- **Always include `aiSystemId`** on every `events.create()` call
- **Generate unique `runId`** per request: `f"run-chat-{uuid.uuid4()}"`
- **Store platform as module-level singleton**
- Log errors but never surface them to users

---

## Adding Tool Events to Causal Graph

For agent loops with tool calls, extend the graph with tool nodes:

```python
# After tool execution, add to graph_events list:
graph_events.append({
    "eventId": f"{run_id}-tool-call-{tool_name}",
    "eventType": "tool.call",
    "action": "invoke",
})
graph_events.append({
    "eventId": f"{run_id}-tool-result-{tool_name}",
    "eventType": "tool.result",
    "action": "complete",
})
```
