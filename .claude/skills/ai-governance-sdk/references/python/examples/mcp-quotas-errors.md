# MCP, Quotas, Error Handling, Approvals, and Exports

MCP server registration, quota monitoring, typed error guards, approval
workflow events, and export/replay templates.

> Extracted from the comprehensive Python governance demo. See [setup-and-registration.md](setup-and-registration.md) for initialization.

## MCP Server Registration and Tool Discovery

```python
# Register MCP server
server = platform.mcpServers.create({
    "name": "compliance-tools-mcp",
    "url": "https://mcp.example.com/compliance",
    "description": "MCP server providing compliance checking tools",
    "metadata": {"version": "1.0", "capabilities": ["tool-use"]},
})
server_id = server.get("id", "unknown")

# List MCP servers
servers = platform.mcpServers.list({})

# Discover tools
tools = platform.mcpServers.listTools(server_id)

# Health check
health = platform.mcpServers.healthCheck(server_id)
```

## Quota Monitoring and Usage Reporting

```python
# Check usage
usage = platform.usage.get({})

# Usage history
history = platform.usage.history({})

# Billing summary
billing = platform.billing.summary({})

# Telemetry usage report
platform.telemetry.reportUsage({
    "metrics": {
        "governed_invoke_calls": 15,
        "agent_runs": 3,
        "events_emitted": 42,
        "proofs_generated": 5,
    },
    "timestamp": now_iso(),
})
```

## Error Handling with Typed Guards

```python
from arelis import (
    GovernedInvokeInput,
    GovernanceGateDeniedError,
    is_governance_gate_denied_error,
    is_policy_blocked_error,
    is_arelis_error,
)

try:
    await arelis.governed_invoke(GovernedInvokeInput(
        model=MODEL_GEMINI,
        prompt="SSN 111-22-3333 -- process this.",
        invoke=lambda s: "UNREACHABLE",
        deny_mode="throw",
    ))
except GovernanceGateDeniedError as e:
    print(f"  GovernanceGateDeniedError caught:")
    print(f"    is_governance_gate_denied_error: {is_governance_gate_denied_error(e)}")
    print(f"    is_policy_blocked_error: {is_policy_blocked_error(e)}")
    print(f"    is_arelis_error: {is_arelis_error(e)}")
except Exception as e:
    print(f"  Caught: {type(e).__name__}: {e}")
    print(f"    is_arelis_error: {is_arelis_error(e)}")
```

## Approval Workflow Events

```python
run_id = f"run-approval-{uuid.uuid4()}"

# Emit approval.requested event
platform.events.create({
    "runId": run_id,
    "aiSystemId": ai_system_id,
    "eventType": "approval.requested",
    "actor": {"type": "agent", "id": "compliance-agent"},
    "resource": {"type": "tool", "id": "financial-report-generator"},
    "action": "request_approval",
    "timestamp": now_iso(),
    "metadata": {
        "approvalId": f"appr_{uuid.uuid4().hex[:8]}",
        "approvers": ["cfo@acme.com", "compliance@acme.com"],
        "reason": "Financial reporting tool requires approval in prod",
        "context": {"purpose": "financial-reporting", "environment": "prod"},
    },
})

# List approvals
approvals = platform.approvals.list({})
```

## Export and Replay Templates

```python
# Create export
export = platform.exports.create({
    "type": "events",
    "format": "json",
    "filters": {"eventType": "model.invoked"},
})

# List exports
exports = platform.exports.list({})

# Replay templates
templates = platform.replay.listTemplates({})
```

**Key patterns:**

- MCP lifecycle: `mcpServers.create` -> `mcpServers.listTools` -> `mcpServers.healthCheck`
- Quota APIs: `usage.get`, `usage.history`, `billing.summary`
- `telemetry.reportUsage` submits aggregated SDK usage metrics
- Error hierarchy: `ArelisError` > `GovernanceGateDeniedError`, `PolicyBlockedError`
- Type guard functions: `is_governance_gate_denied_error(e)`, `is_policy_blocked_error(e)`, `is_arelis_error(e)`
- `deny_mode="throw"` raises `GovernanceGateDeniedError` with `.decision` on the exception
- Approval events use `eventType: "approval.requested"` with approver metadata
- Exports support `"type": "events"` with `"format": "json"` and optional filters
- `replay.listTemplates` retrieves saved replay configurations
