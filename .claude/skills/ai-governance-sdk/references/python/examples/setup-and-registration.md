# Setup and Registration

Initializing the Arelis unified client, registering AI systems, and loading
managed PII configuration from the platform.

> Extracted from the comprehensive Python governance demo. See [setup-and-registration.md](setup-and-registration.md) for initialization.

## SDK Imports

```python
from arelis import (
    create_arelis,
    GovernedInvokeInput,
    GovernedInvokeResult,
    GovernedAgentRunInput,
    GovernedAgentRunResult,
    GovernedAgentTool,
    AgentModelResponse,
    scan_prompt_for_pii,
    ScanPromptForPiiOptions,
    evaluate_pre_invocation_gate,
    EvaluatePreInvocationGateInput,
    with_governance_gate,
    WithGovernanceGateOptions,
    GetPiiConfigOptions,
    GovernanceContext,
    ActorRef,
    OrgRef,
    generate_run_id,
    GovernanceGateDeniedError,
    PolicyBlockedError,
    ArelisError,
    is_governance_gate_denied_error,
    is_policy_blocked_error,
    is_arelis_error,
)
```

## Unified Client Initialization

```python
def init_arelis(ai_system_id: str | None = None):
    """Initialize the unified Arelis client (singleton pattern).

    When aiSystemId is provided at config level, it is automatically forwarded
    through governed_invoke, agents.run, governance gate, platform events,
    proofs, risk evaluation, and MCP tool evaluation.
    """
    return create_arelis({
        "platform": {
            "apiKey": os.environ["ARELIS_API_KEY"],
            **({"baseUrl": os.environ["ARELIS_API_URL"]} if os.environ.get("ARELIS_API_URL") else {}),
        },
        **({"aiSystemId": ai_system_id} if ai_system_id else {}),
    })
```

## AI System Registration and Caching

```python
_ai_system_cache: dict[str, str] = {}


def ensure_ai_system(platform, model_id: str, provider: str) -> str:
    """Register an AI system if not already cached. Returns aiSystemId."""
    if model_id in _ai_system_cache:
        return _ai_system_cache[model_id]

    result = platform.aiSystems.list({"type": "model"})
    existing = result.get("data", [])
    match = next(
        (s for s in existing if s.get("modelRef") == model_id and s.get("status") == "active"),
        None,
    )
    if match:
        _ai_system_cache[model_id] = match["id"]
        return match["id"]

    record = platform.aiSystems.register({
        "name": model_id,
        "type": "model",
        "provider": provider,
        "modelRef": model_id,
        "description": f"Governed AI system for {model_id}",
        "metadata": {"registeredAt": now_iso(), "demo": True},
        "tags": ["governance-demo", provider],
    })
    _ai_system_cache[model_id] = record["id"]
    return record["id"]
```

## Managed PII Configuration from Platform

```python
async def demo_managed_pii_config(arelis) -> None:
    # Default namespace
    config = await arelis.governance.get_pii_config()

    # Custom namespace
    custom_config = await arelis.governance.get_pii_config(
        GetPiiConfigOptions(namespace="pii.strict")
    )
```

## Main Bootstrap Flow

```python
# 1. Bootstrap platform client for AI system registration
arelis = init_arelis()
platform = arelis.platform

# 2. Register AI systems
gemini_system_id = ensure_ai_system(platform, MODEL_GEMINI, "google")
claude_system_id = ensure_ai_system(platform, MODEL_CLAUDE, "anthropic")

# Reinitialize with default aiSystemId so it auto-propagates through
# governed_invoke, agents.run, gate telemetry, events, proofs, and risk.
arelis = init_arelis(ai_system_id=gemini_system_id)
platform = arelis.platform
```

**Key patterns:**

- `create_arelis` accepts an optional `aiSystemId` at config level that auto-propagates to all SDK calls
- Use `platform.aiSystems.list` + `platform.aiSystems.register` for idempotent registration
- Cache AI system IDs locally to avoid repeated lookups
- `GetPiiConfigOptions(namespace=...)` loads PII rules from a named platform namespace
- Reinitialize the client after registration to set the default `aiSystemId`
