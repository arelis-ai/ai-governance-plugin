---
name: ai-governance-sdk
description: "Generates and reviews code using the Arelis AI Governance SDK for TypeScript (@arelis-ai/ai-governance-sdk) and Python (ai-governance-sdk). Covers createArelis / create_arelis orchestration, governedInvoke / governed_invoke, agents.run, governance gates, managed PII config, platform events, causal graphs, policy engines, audit sinks, MCP, RAG, memory, quotas, and compliance. Triggers on: imports from @arelis-ai packages, from arelis import, GovernanceContext, createArelis, create_arelis, createArelisClient, create_arelis_platform, withGovernanceGate, with_governance_gate, governedInvoke, governed_invoke, or AI Governance SDK questions."
---

# AI Governance SDK

Governed AI orchestration framework supporting **TypeScript** and **Python**. Every operation needs a **GovernanceContext**, emits **audit events**, and integrates with the **Arelis Platform** for risk, compliance, and causal lineage.

## Language Detection

Determine which SDK the user is working with:
- **TypeScript**: imports from `@arelis-ai/ai-governance-sdk`, uses `createArelis`, `governedInvoke`, `withGovernanceGate`, `ArelisPlatform`, `.ts`/`.tsx` files
- **Python**: `pip install ai-governance-sdk`, imports from `arelis` (e.g. `from arelis import create_arelis, GovernedInvokeInput`), `.py` files, FastAPI/Django/Flask

## Architecture Overview

| Aspect | TypeScript | Python |
|--------|-----------|--------|
| **Package** | `@arelis-ai/ai-governance-sdk` | `ai-governance-sdk` (PyPI), import as `from arelis import ...` |
| **Recommended entrypoint** | `createArelis()` | `create_arelis()` |
| **High-level model calls** | `arelis.governedInvoke()` | `arelis.governed_invoke()` |
| **High-level agent loop** | `arelis.agents.run()` | `arelis.agents.run()` |
| **Managed PII config** | `arelis.governance.getPiiConfig()` | `arelis.governance.get_pii_config()` |
| **Governance gate** | `withGovernanceGate()` | `with_governance_gate()` |
| **PII scanning** | `scanPromptForPii()` | `scan_prompt_for_pii()` |
| **Platform client** | `ArelisPlatform` / `arelis.platform` | `create_arelis_platform()` / `arelis.platform` |
| **Local governance client** | `createArelisClient()` | Not available — call model providers directly |
| **Policy engine** | Local `PolicyEngine` with automatic checkpoints | Platform-side `evaluate_policy()` + managed PII config |
| **Audit sink** | Local sink + platform events | Platform events only |

Both SDKs share the same platform API surface. The Python SDK now has feature parity with TypeScript for unified orchestration (`governed_invoke`, `agents.run`, governance gates, managed PII).

---

## TypeScript Quick Start

See [typescript/setup-patterns.md](references/typescript/setup-patterns.md) for full setup and [typescript/model-patterns.md](references/typescript/model-patterns.md) for `governedInvoke` details.

```typescript
import { createArelis, type GovernedAgentTool } from '@arelis-ai/ai-governance-sdk';

const arelis = createArelis({
  platform: {
    apiKey: process.env.ARELIS_API_KEY!,
    ...(process.env.ARELIS_API_URL ? { baseUrl: process.env.ARELIS_API_URL } : {}),
  },
});

const result = await arelis.governedInvoke({
  runId: `run-${crypto.randomUUID()}`,
  model: 'gemini-2.5-flash',
  prompt: 'Summarize AI governance controls.',
  denyMode: 'return',
  invoke: async (sanitizedPrompt) => callModel(sanitizedPrompt),
});
```

### TS Unified Namespaces

| Namespace | Methods |
|-----------|---------|
| `arelis.governedInvoke` | `governedInvoke(...)` |
| `arelis.agents` | `run(...)` |
| `arelis.governance` | `getPiiConfig({ namespace? })` |
| `arelis.platform` | `events`, `governance`, `risk`, `replay`, `graphs`, `proofs`, `aiSystems` |

### TS Runtime Namespaces (`createArelisClient`)

See [typescript/api-reference.md](references/typescript/api-reference.md) for complete namespace and method reference.

### CRITICAL: No client.policy

`ArelisClient` does **not** have a `client.policy` namespace. For custom checkpoints (`BeforeToolCall`, `AfterToolResult`), export the `PolicyEngine` directly and call `policyEngine.evaluate()`. See [typescript/governance-patterns.md](references/typescript/governance-patterns.md#custom-policy-checkpoint-evaluation-no-clientpolicy).

---

## Python Quick Start

See [python/setup-patterns.md](references/python/setup-patterns.md) for full setup and [python/model-patterns.md](references/python/model-patterns.md) for `governed_invoke` details.

```python
from arelis import create_arelis, GovernedInvokeInput

arelis = create_arelis({
    "platform": {
        "apiKey": os.environ["ARELIS_API_KEY"],
        **({"baseUrl": os.environ["ARELIS_API_URL"]} if os.environ.get("ARELIS_API_URL") else {}),
    }
})

result = await arelis.governed_invoke(GovernedInvokeInput(
    model="gemini-2.5-flash",
    prompt="Summarize AI governance controls.",
    invoke=lambda sanitized: call_model(sanitized),
    deny_mode="return",
))
```

### Python Unified Namespaces

| Namespace | Methods |
|-----------|---------|
| `arelis.governed_invoke()` | High-level orchestrated model invocation |
| `arelis.agents.run()` | Multi-step governed agent loop |
| `arelis.governance.get_pii_config()` | Managed PII config from platform |
| `arelis.platform` | `events`, `governance`, `risk`, `replay`, `graphs`, `proofs`, `ai_systems` |

### Python Standalone Functions

| Function | Description |
|----------|-------------|
| `scan_prompt_for_pii(prompt, options?)` | Local PII scanning (email, phone, SSN, credit card) |
| `evaluate_pre_invocation_gate(source, input, options?)` | Pre-invocation policy evaluation |
| `with_governance_gate(source, input, invoke, options?)` | Gate + invoke wrapper |
| `create_governance_gate_evaluator(...)` | Custom evaluator factory |

See [python/api-reference.md](references/python/api-reference.md) for the complete API surface and type definitions.

---

## GovernanceContext (required on every call)

See [shared/concepts.md](references/shared/concepts.md#governancecontext) for full field reference.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `org` | `{ id, name }` | yes | Organization |
| `actor` | `{ type, id, email?, roles? }` | yes | Who — `human` \| `service` \| `agent` |
| `purpose` | `string` | yes | Why — e.g. `customer-support`, `chat` |
| `environment` | `string` | yes | Where — `dev` \| `staging` \| `prod` |
| `session_id` | `string` | no | Session grouping |
| `tags` | `dict/object` | no | Arbitrary key-value tags |

---

## Key Conventions (TypeScript)

- Import only from `@arelis-ai/ai-governance-sdk` (umbrella package)
- Named exports only — no default exports; use `type` imports for types
- Prefer `createArelis({ platform })` for new integrations (SDK `1.2.1+`)
- `ArelisPlatform` base URL defaults to `https://api.arelis.digital` when omitted
- Managed PII config: `arelis.governance.getPiiConfig({ namespace? })` (default: `pii.default`)
- `withGovernanceGate` accepts an `ArelisPlatform` directly
- Gate decisions include timings in `decision.metadata.timings` (`scanMs`, `policyEvalMs`, `totalMs`)
- Non-fatal side-effect failures surface in `result.warnings` instead of throwing
- **Always `await` platform calls** — use `.catch()` in serverless runtimes
- **Always include `aiSystemId`** on every `platform.events.create()` call
- `createCompositeSink` takes an **array** — NOT spread args
- Next.js: add package to `serverExternalPackages`; create `src/instrumentation.ts` polyfill
- Gemini 3: always pass `rawParts` verbatim (preserves thoughtSignature)

See [typescript/setup-patterns.md](references/typescript/setup-patterns.md) and [typescript/governance-patterns.md](references/typescript/governance-patterns.md) for detailed patterns.

## Key Conventions (Python)

- **Install**: `pip install ai-governance-sdk` (PyPI name is `ai-governance-sdk`, NOT `arelis`)
- Import from `arelis`: `from arelis import create_arelis, GovernedInvokeInput`
- **Prefer `create_arelis` + `governed_invoke`** — handles PII redaction, policy gate, event reporting, and risk automatically
- `governed_invoke` accepts sync or async `invoke` callable; SDK handles both
- `deny_mode="return"` (default) returns `invoked=False`; `deny_mode="throw"` raises `GovernanceGateDeniedError`
- `GovernedInvokeResult` includes: `run_id`, `invoked`, `decision`, `sanitized_prompt`, `result`, `risk`, `warnings`
- `agents.run()` provides multi-step governed agent loops with tool execution, causal graph, and proof generation
- `governance.get_pii_config()` fetches managed PII configuration from the platform
- `create_arelis_platform` is still available for low-level manual orchestration
- Always `await` platform calls — use try/except to log and swallow errors
- For manual pipeline: `start_causal_graph()` BEFORE `graphs.commit()`
- Gemini 3: pass raw response parts verbatim to preserve thoughtSignature fields

See [python/model-patterns.md](references/python/model-patterns.md) and [python/api-reference.md](references/python/api-reference.md) for detailed patterns and full type definitions.

---

## Common Tasks (TypeScript)

| Task | Reference File |
|------|---------------|
| Singleton setup, Next.js integration, ReadableStream route | [typescript/setup-patterns.md](references/typescript/setup-patterns.md) |
| governedInvoke, basic model calls, streaming, structured output | [typescript/model-patterns.md](references/typescript/model-patterns.md) |
| Governance gates, PII, policy checkpoints, function calling | [typescript/governance-patterns.md](references/typescript/governance-patterns.md) |
| Platform events, risk, proofs, causal graphs, post-stream pipeline | [typescript/platform-pipeline.md](references/typescript/platform-pipeline.md) |
| Agent runtime, tools, MCP, KB RAG, approvals | [typescript/agent-tool-patterns.md](references/typescript/agent-tool-patterns.md) |
| Memory, quotas, secrets, data sources, OTel, compliance | [typescript/state-patterns.md](references/typescript/state-patterns.md) |
| Testing with mocks | [typescript/testing.md](references/typescript/testing.md) |
| Complete API reference | [typescript/api-reference.md](references/typescript/api-reference.md) |

## Common Tasks (Python)

| Task | Reference File |
|------|---------------|
| Installation, create_arelis, singleton patterns, web frameworks | [python/setup-patterns.md](references/python/setup-patterns.md) |
| governed_invoke, model calls with Gemini/Claude/OpenAI, streaming | [python/model-patterns.md](references/python/model-patterns.md) |
| PII scanning, policy CRUD, governance gates, BeforeToolCall/AfterToolResult | [python/governance-patterns.md](references/python/governance-patterns.md) |
| Events, risk, proofs, causal graphs, post-stream pipeline | [python/platform-pipeline.md](references/python/platform-pipeline.md) |
| Governed agent loop with Gemini function calling | [python/agent-tool-patterns.md](references/python/agent-tool-patterns.md) |
| Pytest patterns, mocking platform client | [python/testing.md](references/python/testing.md) |
| Complete Python API surface and type definitions | [python/api-reference.md](references/python/api-reference.md) |

## Shared Reference Files

- [shared/platform-api.md](references/shared/platform-api.md) — platform namespaces, event shapes, AI system registration, common event types
- [shared/policies.md](references/shared/policies.md) — policy JSON rules, checkpoint concepts, enforcement modes, complete audit event type catalog (100+ types), DataRef shapes
- [shared/concepts.md](references/shared/concepts.md) — GovernanceContext fields, architecture differences, causal graphs, risk, proofs, PII scanning, post-stream pipeline overview

## Policy Engines (TypeScript)

See [typescript/governance-patterns.md](references/typescript/governance-patterns.md) for full policy engine patterns.

PolicyDecision effects: `'allow'` | `'block'` | `'transform'` | `'require_approval'`

Checkpoints: `BeforePrompt` | `AfterModelOutput` | `BeforeToolCall` | `AfterToolResult` | `BeforePersist` | `BeforeOperation` | `BeforeProvision` | `BeforeDestroy` | `BeforeConfigChange` | `BeforeAuth` | `BeforeAgentStep`

## Error Handling

See [typescript/api-reference.md](references/typescript/api-reference.md) for TypeScript error types and [python/api-reference.md](references/python/api-reference.md) for Python error types.

Both SDKs provide typed error classes: `PolicyBlockedError`, `PolicyApprovalRequiredError`, `EvaluationBlockedError`, `GovernanceGateDeniedError`, `ProviderError`, `ToolError`, `ArelisTimeoutError` — with corresponding `is_*_error()` guard functions.

## End-to-End Examples

Complete working demos covering the full governance lifecycle:

- [examples/test-platform-first-governance.ts](examples/test-platform-first-governance.ts) — TypeScript: `createArelis`, managed PII config, `governedInvoke`, `agents.run`, warnings, timings
- [examples/test-developer-value.py](examples/test-developer-value.py) — Python: `create_arelis`, `governed_invoke`, direct google-genai + anthropic calls, governed agent loop

## Validation Scripts

```bash
# TypeScript project validation
python .claude/skills/arelis-sdk/scripts/validate_governance_setup.py --project-dir . --lang ts

# Python project validation
python .claude/skills/arelis-sdk/scripts/validate_python_setup.py --project-dir .
```
