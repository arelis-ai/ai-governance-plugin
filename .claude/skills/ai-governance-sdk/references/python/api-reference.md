# Python SDK — API Reference

Complete API surface for the `arelis` Python package.

---

## Installation

```bash
pip install ai-governance-sdk
```

---

## Unified Client (Recommended)

```python
from arelis import create_arelis

arelis = create_arelis({
    "platform": {
        "apiKey": "ak_sandbox_...",                # ARELIS_API_KEY
        "baseUrl": "https://api.arelis.digital",   # optional, this is the default
    },
    # Optional: set default aiSystemId that auto-propagates through governed_invoke,
    # agents.run, governance gate, platform events, proofs, risk, and MCP evaluations.
    # Can be overridden per-call via GovernedInvokeInput(ai_system_id=...).
    "aiSystemId": "ais_...",                       # optional
})
```

### Unified Namespaces

| Namespace | Methods | Description |
|-----------|---------|-------------|
| `arelis.governed_invoke()` | `governed_invoke(GovernedInvokeInput)` | High-level orchestrated model invocation |
| `arelis.agents.run()` | `run(GovernedAgentRunInput)` | Multi-step governed agent loop |
| `arelis.governance.get_pii_config()` | `get_pii_config(GetPiiConfigOptions?)` | Managed PII config from platform |
| `arelis.platform` | All platform namespaces | Low-level platform API access |
| `arelis.runtime` | `ArelisClient` or `None` | Local runtime client (if configured) |

---

### governed_invoke

```python
from arelis import GovernedInvokeInput, GovernedInvokeResult

result: GovernedInvokeResult = await arelis.governed_invoke(GovernedInvokeInput(
    model=str,                              # required — model identifier
    prompt=str,                             # required — the prompt/input to send
    invoke=Callable[[str], Any],            # required — sync or async callable
    run_id=str | None,                      # optional — auto-generated if omitted
    actor=ActorRef | None,                  # optional — {"type": "human", "id": "user_1"}
    context=GovernanceContext | None,        # optional — org, purpose, environment
    policy_ids=list[str] | None,            # optional — specific policies to evaluate
    ai_system_id=str | None,               # optional — overrides config default
    pii_namespace=str | None,               # optional — PII config namespace
    deny_mode="return" | "throw" | None,    # optional — default: "return"
    include_risk=bool | None,               # optional — default: True
))
```

**Orchestration steps** (all automatic):
1. Generates `run_id` if not provided
2. Loads PII config from platform (`pii_namespace` or default)
3. Redacts PII from prompt using managed config
4. Evaluates pre-invocation governance gate
5. If denied: returns `invoked=False` (or raises `GovernanceGateDeniedError` if `deny_mode="throw"`)
6. If allowed: calls `invoke(sanitized_prompt)`
7. Reports events to platform (request, response/error, blocked)
8. Evaluates risk based on policy decisions
9. Returns `GovernedInvokeResult`

### GovernedInvokeResult

```python
result.run_id: str                              # unique run identifier
result.invoked: bool                            # whether the model was actually invoked
result.decision: PreInvocationGateDecision      # policy decision details
result.sanitized_prompt: str                    # PII-redacted prompt
result.result: T | None                         # model response (None if denied)
result.risk: RiskEvaluationResponse | None      # risk assessment result
result.warnings: list[str] | None               # non-fatal warnings during execution
```

### PreInvocationGateDecision

```python
decision.run_id: str
decision.decision: "allow" | "deny"
decision.pii: PromptPiiScanResult               # {has_pii, findings}
decision.policy: PolicySummaryInfo               # {allowed, decisions, summary}
decision.metadata: PreInvocationGateMetadata     # {policy_ids, actor, model, timings}
decision.reasons: list[str]
decision.codes: list[str]
```

---

### agents.run

```python
from arelis import GovernedAgentRunInput, GovernedAgentRunResult, GovernedAgentTool

result: GovernedAgentRunResult = await arelis.agents.run(GovernedAgentRunInput(
    model=str,                                          # required
    prompt=str,                                         # required
    tools=list[GovernedAgentTool],                      # required
    invoke_model=Callable[[dict], Any],                 # required — sync or async
    execute_tool_call=Callable[[dict], Any],            # required — sync or async
    run_id=str | None,                                  # optional
    actor=ActorRef | None,                              # optional
    context=GovernanceContext | None,                    # optional
    policy_ids=list[str] | None,                        # optional
    ai_system_id=str | None,                            # optional — overrides config default
    pii_namespace=str | None,                           # optional
    deny_mode="return" | "throw" | None,                # optional
    max_steps=int | None,                               # optional — default: 8
    include_risk=bool | None,                           # optional
    proof_schema_version=str | None,                    # optional
    map_output=Callable[[dict], TOutput] | None,        # optional
))
```

### GovernedAgentRunResult

```python
result.run_id: str
result.status: GovernedAgentRunStatus           # completion status
result.decision: PreInvocationGateDecision      # gate decision
result.sanitized_prompt: str
result.steps: list[GovernedAgentStep]           # step-by-step execution trace
result.events: list[AuditEvent]                 # local audit events
result.graph: CausalGraph                       # causal lineage graph
result.output: TOutput | None                   # final output (via map_output)
result.platform_events: list[EventRecord] | None
result.platform_graph: CausalGraphResponse | None
result.proof: GovernedProofResult | None        # {request, record}
result.risk: RiskEvaluationResponse | None
result.warnings: list[str] | None
```

### GovernedAgentTool

```python
from arelis import GovernedAgentTool

tool = GovernedAgentTool(
    name="search_kb",
    description="Search knowledge base",
    schema={"type": "object", "properties": {"query": {"type": "string"}}, "required": ["query"]},
)
```

---

### governance.get_pii_config

```python
from arelis import GetPiiConfigOptions

config = await arelis.governance.get_pii_config(GetPiiConfigOptions(namespace="pii.default"))
# Returns: RedactorConfig with detect_emails, detect_phones, etc.
```

---

## Standalone Governance Functions

These functions can be used independently without `create_arelis`:

### scan_prompt_for_pii

```python
from arelis import scan_prompt_for_pii, ScanPromptForPiiOptions

result = scan_prompt_for_pii("Contact john@example.com or call 555-123-4567")
# result.has_pii = True
# result.findings = [PromptPiiFinding(type="email", ...), PromptPiiFinding(type="phone", ...)]

# With options
result = scan_prompt_for_pii(text, ScanPromptForPiiOptions(
    detect_emails=True,
    detect_phones=True,
    detect_ssns=True,
    detect_credit_cards=True,
    redactor=None,            # optional custom redactor
    redactor_config=None,     # optional redactor config
))
```

### evaluate_pre_invocation_gate

```python
from arelis import evaluate_pre_invocation_gate, EvaluatePreInvocationGateInput, ActorRef

decision = await evaluate_pre_invocation_gate(
    source=arelis.platform,  # ArelisPlatform instance (use arelis.platform or create_arelis_platform())
    input=EvaluatePreInvocationGateInput(
        prompt="User prompt here",
        actor=ActorRef(type="human", id="user_1"),
        run_id="run-123",           # optional
        model="gemini-2.5-flash",   # optional
        ai_system_id="ais_...",     # optional — forwarded to platform policy evaluation
        policy_ids=["policy-1"],    # optional
        context=ctx,                # optional
    ),
    options=ScanPromptForPiiOptions(),  # optional
)
# Returns: PreInvocationGateDecision
```

### with_governance_gate

```python
from arelis import with_governance_gate, WithGovernanceGateOptions, ActorRef

result = await with_governance_gate(
    source=arelis.platform,  # ArelisPlatform instance
    input=EvaluatePreInvocationGateInput(
        prompt="User prompt",
        actor=ActorRef(type="human", id="user_1"),
        ai_system_id="ais_...",  # optional — forwarded to gate telemetry events
    ),
    invoke=lambda: call_model(prompt),
    options=WithGovernanceGateOptions(
        deny_mode="return",       # "return" or "throw"
        detect_emails=True,
        detect_phones=True,
        detect_ssns=True,
        detect_credit_cards=True,
    ),
)
# Returns: WithGovernanceGateResult[T] — {run_id, invoked, decision, result, warnings}
```

### create_governance_gate_evaluator

```python
from arelis import create_governance_gate_evaluator

evaluator = create_governance_gate_evaluator(
    evaluate_policy=my_policy_eval_fn,
    resolve_context=my_context_resolver,      # optional
    get_policy_metadata=my_metadata_fn,       # optional
)
```

---

## Error Types

```python
from arelis import (
    ArelisError,
    PolicyBlockedError,
    PolicyApprovalRequiredError,
    EvaluationBlockedError,
    GovernanceGateDeniedError,
    ProviderError,
    ToolError,
    ArelisTimeoutError,
    ArelisApiError,
    # Guard functions
    is_arelis_error,
    is_policy_blocked_error,
    is_policy_approval_required_error,
    is_evaluation_blocked_error,
    is_governance_gate_denied_error,
    is_provider_error,
    is_tool_error,
    is_arelis_timeout_error,
)
```

---

## Platform Client (Low-Level)

```python
from arelis import create_arelis_platform

platform = create_arelis_platform({
    "baseUrl": "https://api.arelis.digital",  # ARELIS_API_URL
    "apiKey": "ak_sandbox_...",                # ARELIS_API_KEY
    "max_retries": 2,                           # default: 3
    "timeout": 15_000,                          # ms, default: 30_000
})
```

### Platform Namespaces

| Namespace | Key Methods |
|-----------|-------------|
| `platform.events` | `create()`, `createBatch()`, `list()`, `get()`, `count()` |
| `platform.aiSystems` | `register()`, `list()`, `get()`, `update()`, `archive()`, `setDefault()`, `summary()` |
| `platform.governance` | `evaluatePolicy()`, `getPiiConfig()`, `listPolicyEvaluations()`, `getSnapshot()` |
| `platform.governance.policies` | `create()`, `list()`, `get()`, `update()`, `delete()`, `restore()`, `createVersion()`, `listVersions()`, `activateVersion()`, `transition()`, `rollback()`, `simulate()`, `bulkSimulate()`, `impact()` |
| `platform.risk` | `evaluate()`, `getConfig()`, `updateConfig()`, `listDecisions()`, `simulate()`, `saveDraft()`, `clearDraft()`, `publishDraft()`, `rollbackConfig()` |
| `platform.graphs` | `list()`, `get()`, `commit()`, `lineage()` |
| `platform.replay` | `start()`, `startCausalGraph()`, `get()`, `list()`, `createTemplate()`, `listTemplates()`, `compare()` |
| `platform.proofs` | `create()`, `get()`, `verify()`, `list()` |
| `platform.exports` | `create()`, `list()`, `get()`, `download()` |
| `platform.jobs` | `list()`, `get()`, `retry()` |
| `platform.approvals` | `list()`, `resolve()`, `getConfig()`, `updateConfig()` |
| `platform.mcpServers` | `create()`, `list()`, `get()`, `update()`, `archive()`, `createTool()`, `listTools()`, `refreshTools()`, `healthCheck()`, `linkSystem()` |
| `platform.apiKeys` | `create()`, `list()`, `update()`, `revoke()`, `rotate()` |
| `platform.usage` | `get()`, `history()` |
| `platform.billing` | `summary()` |
| `platform.telemetry` | `reportUsage()`, `submitAttestation()`, `listReports()`, `listChallenges()` |

### events.create

```python
platform.events.create({
    "runId": str,           # required
    "aiSystemId": str,      # required
    "eventType": str,       # required (e.g. "model.invoked")
    "actor": {"type": str, "id": str},
    "resource": {"type": str, "id": str},
    "action": str,
    "timestamp": str,       # ISO 8601
    "metadata": dict,       # optional
})
```

### governance.evaluatePolicy

```python
result = platform.governance.evaluatePolicy({
    "runId": str,
    "aiSystemId": str,       # optional — routes to specific AI system
    "checkpoint": {
        "content": dict,    # e.g. {"pii_detected": True, "pii_types": [...]}
    },
})
# Returns: {"decisions": [{"decision": "allow"|"deny", "policyId": str, "metadata": dict}]}
```

### risk.evaluate

```python
result = platform.risk.evaluate({
    "runId": str,
    "aiSystemId": str,
    "policyDecisions": list[dict],
    "quotaState": dict,              # optional
    "evaluationSignals": list[dict], # optional
    "explicitSignals": dict,         # optional
})
# Returns: {"id": str, "runId": str, "action": str, "score": float, "factors": [...]}
```

### replay.startCausalGraph / graphs.commit

```python
# Start causal graph (MUST be called BEFORE graphs.commit)
platform.replay.startCausalGraph({
    "runId": str,
    "nodes": [{"id": str, "type": str, "data": dict}, ...],
    "edges": [{"source": str, "target": str, "type": "sequence"}, ...],
})

# Commit (ALWAYS LAST)
result = platform.graphs.commit(run_id)
# Returns: {"rootHash": str}
```

### proofs

```python
result = platform.proofs.create({
    "runId": str,
    "aiSystemId": str,
    "schemaVersion": "v1",
})
# Returns: {"proofId": str, "proofHash": str, "layers": [...], ...}

verification = platform.proofs.verify({"proofId": str})
# Returns: {"verified": bool, "evidence": dict}
```

---

## Core Types

```python
from arelis import (
    GovernanceContext,
    ActorRef,
    OrgRef,
    ResultEnvelope,
    RunWarning,
    generate_run_id,
)
```

### GovernanceContext

```python
GovernanceContext(
    org=OrgRef(id="org_123", name="Acme"),
    actor=ActorRef(type="human", id="user_1", email="a@acme.com", roles=["analyst"]),
    purpose="customer-support",
    environment="dev",        # "dev" | "staging" | "prod"
    session_id="sess_abc",    # optional
    tags={"feature": "chat"}, # optional
)
```

---

## Key Differences from TypeScript SDK

| Feature | TypeScript | Python |
|---------|-----------|--------|
| Unified orchestrator | `createArelis()` + `governedInvoke()` | `create_arelis()` + `governed_invoke()` |
| Agent orchestrator | `arelis.agents.run()` | `arelis.agents.run()` |
| Managed PII config | `arelis.governance.getPiiConfig()` | `arelis.governance.get_pii_config()` |
| Governance gate | `withGovernanceGate()` | `with_governance_gate()` |
| PII scanning | `scanPromptForPii()` | `scan_prompt_for_pii()` |
| Local governance client | `createArelisClient()` | Not available |
| Model calls | Via `client.models.generate()` | Direct provider SDK calls in `invoke` callable |
| Local policy engine | `PolicyEngine` with checkpoints | Platform-side `evaluatePolicy()` |
| Audit sink | Local sink + platform | Platform events only |
| Memory/quotas/secrets | Built-in namespaces | Not available (use external stores) |
| Naming convention | camelCase | snake_case (camelCase aliases available) |
