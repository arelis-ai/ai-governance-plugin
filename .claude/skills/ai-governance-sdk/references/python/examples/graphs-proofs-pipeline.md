# Causal Graphs, Compliance Proofs, and Post-Stream Pipeline

Building causal graphs, generating and verifying compliance proofs, and
running the full 8-step post-stream pipeline.

> Extracted from the comprehensive Python governance demo. See [setup-and-registration.md](setup-and-registration.md) for initialization.

## Causal Graph: Build Nodes and Edges

```python
def demo_causal_graph(platform, run_id: str, events: list[dict]) -> dict | None:
    # Build nodes from event log
    nodes = [
        {
            "id": ev.get("eventId", f"{run_id}-node-{i}"),
            "type": ev["eventType"],
            "data": {"timestamp": ev.get("timestamp", now_iso())},
        }
        for i, ev in enumerate(events)
    ]

    # Build sequential edges
    edges = [
        {"source": nodes[i - 1]["id"], "target": nodes[i]["id"], "type": "sequence"}
        for i in range(1, len(nodes))
    ]
```

## Causal Graph: Submit, Commit, and Query Lineage

```python
    # Submit causal graph (MUST precede commit)
    platform.replay.startCausalGraph({"runId": run_id, "nodes": nodes, "edges": edges})

    # Commit (ALWAYS LAST)
    commit = platform.graphs.commit(run_id)
    # commit["rootHash"] contains the Merkle root

    # Query lineage
    lineage = platform.graphs.lineage(run_id, nodes[0]["id"])
    # lineage["nodes"], lineage["edges"]
```

## Compliance Proof: Create and Verify

```python
def demo_compliance_proofs(platform, run_id: str, ai_system_id: str) -> dict | None:
    # Generate proof
    proof = platform.proofs.create({
        "runId": run_id,
        "aiSystemId": ai_system_id,
        "schemaVersion": "v1",
    })
    # proof["proofId"], proof["proofHash"], proof["layers"]

    # Verify proof
    verification = platform.proofs.verify({"proofId": proof["proofId"]})
    # verification["verified"] -- boolean
    for layer in verification.get("layers", []):
        status = "PASS" if layer.get("passed") else "FAIL"
        print(f"    {layer.get('name', '?')}: {status}")
```

## Post-Stream Pipeline (Full 8-Step)

```python
def demo_post_stream_pipeline(platform, ai_system_id: str) -> None:
    run_id = f"run-pipeline-{uuid.uuid4()}"
    actor = {"type": "human", "id": "demo-user"}
    timestamp = now_iso()
    total_output = "This is a simulated model output for the post-stream pipeline demo."

    # A. Policy decisions (from earlier gate)
    policy_decisions = [{"policyId": "pii-deny", "decision": "allow", "severity": "low"}]

    # B. Emit policy.evaluated event
    platform.events.create({
        "runId": run_id,
        "aiSystemId": ai_system_id,
        "eventType": "policy.evaluated",
        "actor": actor,
        "resource": {"type": "model", "id": MODEL_GEMINI},
        "action": "evaluate",
        "timestamp": timestamp,
        "metadata": {
            "checkpoints": ["BeforePrompt", "AfterModelOutput"],
            "decisionsCount": len(policy_decisions),
            "pii_detected": False,
        },
    })

    # C. Emit model.invoked + output.delivered
    platform.events.create({
        "runId": run_id,
        "aiSystemId": ai_system_id,
        "eventType": "model.invoked",
        "actor": actor,
        "resource": {"type": "model", "id": MODEL_GEMINI},
        "action": "inference",
        "timestamp": timestamp,
        "metadata": {"responseLength": len(total_output)},
    })
    platform.events.create({
        "runId": run_id,
        "aiSystemId": ai_system_id,
        "eventType": "output.delivered",
        "actor": actor,
        "resource": {"type": "model", "id": MODEL_GEMINI},
        "action": "deliver",
        "timestamp": timestamp,
        "metadata": {"outputLength": len(total_output), "containsPII": False},
    })

    # D. Post-stream policy evaluation (AfterModelOutput)
    eval_result = platform.governance.evaluatePolicy({
        "runId": run_id,
        "aiSystemId": ai_system_id,
        "checkpoint": {
            "content": {"pii_detected": True, "pii_types": ["email"], "pii_count": 1},
        },
    })

    # E. Risk evaluation
    risk = platform.risk.evaluate({
        "runId": run_id,
        "aiSystemId": ai_system_id,
        "policyDecisions": policy_decisions,
        "quotaState": {},
        "evaluationSignals": [],
        "explicitSignals": {"surface": "model", "outcome": "allowed"},
    })

    # F. Compliance proof
    proof = platform.proofs.create({
        "runId": run_id,
        "aiSystemId": ai_system_id,
        "schemaVersion": "v1",
    })

    # G. Causal graph (MUST precede commit)
    graph_events = [
        {"eventId": f"{run_id}-policy-evaluated", "eventType": "policy.evaluated"},
        {"eventId": f"{run_id}-model-invoked", "eventType": "model.invoked"},
        {"eventId": f"{run_id}-output-delivered", "eventType": "output.delivered"},
    ]
    nodes = [
        {"id": ev["eventId"], "type": ev["eventType"], "data": {"timestamp": timestamp}}
        for ev in graph_events
    ]
    edges = [
        {"source": graph_events[i - 1]["eventId"], "target": graph_events[i]["eventId"], "type": "sequence"}
        for i in range(1, len(graph_events))
    ]
    platform.replay.startCausalGraph({"runId": run_id, "nodes": nodes, "edges": edges})

    # H. Commit causal graph (ALWAYS LAST)
    commit = platform.graphs.commit(run_id)
```

**Key patterns:**

- Causal graph order: `startCausalGraph` MUST precede `graphs.commit`
- `graphs.commit` is ALWAYS the last step -- it seals the Merkle tree
- Nodes require `id`, `type`, and `data`; edges require `source`, `target`, and `type`
- `graphs.lineage(runId, nodeId)` returns the full lineage for a given node
- Proofs require `runId`, `aiSystemId`, and `schemaVersion`; verify with `proofs.verify({"proofId": ...})`
- Post-stream pipeline steps: A (policy decisions) -> B (policy event) -> C (model + output events) -> D (post-stream policy eval) -> E (risk) -> F (proof) -> G (causal graph) -> H (commit)
