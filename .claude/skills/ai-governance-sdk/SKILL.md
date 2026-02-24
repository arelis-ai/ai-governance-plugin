---
name: ai-governance-sdk
description: "Generates and reviews code using the Arelis AI Governance SDK for TypeScript (@arelis-ai/ai-governance-sdk) and Python (ai-governance-sdk). Covers createArelis / create_arelis orchestration, governedInvoke / governed_invoke, agents.run, governance gates, managed PII config, platform events, causal graphs, policy engines, audit sinks, MCP, RAG, memory, quotas, and compliance. Triggers on: imports from @arelis-ai packages, from arelis import, GovernanceContext, createArelis, create_arelis, createArelisClient, create_arelis_platform, withGovernanceGate, with_governance_gate, governedInvoke, governed_invoke, or AI Governance SDK questions."
---

# AI Governance SDK

Governed AI orchestration framework supporting **TypeScript** and **Python**. Every operation needs a **GovernanceContext**, emits **audit events**, and integrates with the **Arelis Platform** for risk, compliance, and causal lineage.

## Language Detection

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
| **Local governance client** | `createArelisClient()` | Not available |
| **Policy engine** | Local `PolicyEngine` with checkpoints | Platform-side `evaluate_policy()` + managed PII |
| **Audit sink** | Local sink + platform events | Platform events only |

---

## TypeScript Quick Start

```typescript
import { createArelis, type GovernedAgentTool } from '@arelis-ai/ai-governance-sdk';

const arelis = createArelis({
  platform: {
    apiKey: process.env.ARELIS_API_KEY!,
    ...(process.env.ARELIS_API_URL ? { baseUrl: process.env.ARELIS_API_URL } : {}),
  },
  aiSystemId, // optional: auto-propagated to all SDK surfaces
});

const result = await arelis.governedInvoke({
  model: 'gemini-2.5-flash',
  prompt: 'Summarize AI governance controls.',
  denyMode: 'return',
  invoke: async (sanitizedPrompt) => callModel(sanitizedPrompt),
});
```

## Python Quick Start

```python
from arelis import create_arelis, GovernedInvokeInput

arelis = create_arelis({
    "platform": {
        "apiKey": os.environ["ARELIS_API_KEY"],
        **({"baseUrl": os.environ["ARELIS_API_URL"]} if os.environ.get("ARELIS_API_URL") else {}),
    },
    "aiSystemId": ai_system_id,  # optional: auto-propagated
})

result = await arelis.governed_invoke(GovernedInvokeInput(
    model="gemini-2.5-flash",
    prompt="Summarize AI governance controls.",
    invoke=lambda sanitized: call_model(sanitized),
    deny_mode="return",
))
```

---

## GovernanceContext (required on every call)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `org` | `{ id, name }` | yes | Organization |
| `actor` | `{ type, id, email?, roles? }` | yes | Who — `human` \| `service` \| `agent` |
| `purpose` | `string` | yes | Why — e.g. `customer-support`, `chat` |
| `environment` | `string` | yes | Where — `dev` \| `staging` \| `prod` |
| `session_id` | `string` | no | Session grouping |
| `tags` | `dict/object` | no | Arbitrary key-value tags |

## aiSystemId Propagation

Optional `aiSystemId` set at config level is auto-forwarded through all platform-managed surfaces: `governedInvoke`, `agents.run`, governance gate telemetry, `events.create`, `evaluatePolicy`, `risk.evaluate`, `proofs.create`, and MCP evaluations.

**Precedence**: per-call > `createArelis({ aiSystemId })` > `platform: { aiSystemId }` > omitted.

**Compatibility**: `evaluatePolicy` retries once without `aiSystemId` on HTTP 400 for backward compat.

---

## Key Conventions (TypeScript)

- Import only from `@arelis-ai/ai-governance-sdk`; named exports only, `type` imports for types
- Prefer `createArelis({ platform, aiSystemId })` — SDK auto-forwards to all surfaces
- `ArelisPlatform` base URL defaults to `https://api.arelis.digital`
- `withGovernanceGate` accepts `ArelisPlatform` directly; gate decisions include `timings`
- Non-fatal failures surface in `result.warnings`; **always `await` platform calls**
- `createCompositeSink` takes an **array** — NOT spread args
- `ArelisClient` has NO `client.policy` — export `PolicyEngine` directly for custom checkpoints

## Key Conventions (Python)

- **Install**: `pip install ai-governance-sdk` (NOT `arelis`); import from `arelis`
- Prefer `create_arelis` + `governed_invoke` — handles PII, policy, events, risk automatically
- `governed_invoke` accepts sync or async `invoke`; `deny_mode="return"` (default) or `"throw"`
- Platform calls are synchronous — do NOT `await`; use try/except to swallow errors
- `source=arelis.platform` (not `arelis`) for gate functions
- Valid platform actions: `"allow"`, `"deny"`, `"warn"`, `"escalate"`
- `startCausalGraph()` BEFORE `graphs.commit()`

---

## TypeScript Reference Files

| Task | Reference | Examples |
|------|-----------|----------|
| Singleton setup, AI system registration | [setup-patterns.md](references/typescript/setup-patterns.md) | [examples/setup-and-registration.md](references/typescript/examples/setup-and-registration.md) |
| Next.js integration, ReadableStream | [setup-nextjs.md](references/typescript/setup-nextjs.md) | — |
| governedInvoke, model calls | [model-patterns.md](references/typescript/model-patterns.md) | [examples/governed-invoke.md](references/typescript/examples/governed-invoke.md) |
| PII scanning, policy creation | [governance-patterns.md](references/typescript/governance-patterns.md) | [examples/pii-and-policy.md](references/typescript/examples/pii-and-policy.md) |
| Governance gates (standalone) | [governance-patterns.md](references/typescript/governance-patterns.md) | [examples/governance-gate.md](references/typescript/examples/governance-gate.md) |
| Function calling, NDJSON streaming | [governance-function-calling.md](references/typescript/governance-function-calling.md) | — |
| agents.run, multi-step tool loops | [agent-tool-patterns.md](references/typescript/agent-tool-patterns.md) | [examples/agents-run.md](references/typescript/examples/agents-run.md) |
| Platform events, risk, proofs, graphs | [platform-pipeline.md](references/typescript/platform-pipeline.md) | [examples/platform-pipeline.md](references/typescript/examples/platform-pipeline.md) |
| Memory, quotas, secrets, OTel | [state-patterns.md](references/typescript/state-patterns.md) | [examples/low-level-runtime.md](references/typescript/examples/low-level-runtime.md) |
| Low-level runtime, agent runtime, MCP, KB RAG | [api-reference-runtime.md](references/typescript/api-reference-runtime.md) | [examples/low-level-runtime-advanced.md](references/typescript/examples/low-level-runtime-advanced.md) |
| Error handling, compliance replay | [api-reference-utilities.md](references/typescript/api-reference-utilities.md) | [examples/error-handling-compliance.md](references/typescript/examples/error-handling-compliance.md) |
| Testing with mocks | [testing.md](references/typescript/testing.md) | — |
| API reference (core types) | [api-reference-core.md](references/typescript/api-reference-core.md) | — |
| API reference (platform) | [api-reference-platform.md](references/typescript/api-reference-platform.md) | — |

## Python Reference Files

| Task | Reference | Examples |
|------|-----------|----------|
| Installation, create_arelis, web frameworks | [setup-patterns.md](references/python/setup-patterns.md) | [examples/setup-and-registration.md](references/python/examples/setup-and-registration.md) |
| governed_invoke, Gemini/Claude/OpenAI | [model-patterns.md](references/python/model-patterns.md) | [examples/governed-invoke.md](references/python/examples/governed-invoke.md) |
| PII scanning, BeforeToolCall/AfterToolResult | [governance-patterns.md](references/python/governance-patterns.md) | [examples/pii-and-policy.md](references/python/examples/pii-and-policy.md) |
| Governance gates (standalone + manual) | [governance-patterns.md](references/python/governance-patterns.md) | [examples/governance-gate.md](references/python/examples/governance-gate.md) |
| agents.run, governed agent loop | [agent-tool-patterns.md](references/python/agent-tool-patterns.md) | [examples/agents-run.md](references/python/examples/agents-run.md) |
| Platform policy CRUD | [governance-patterns.md](references/python/governance-patterns.md) | [examples/policy-crud.md](references/python/examples/policy-crud.md) |
| Events, evaluatePolicy, risk | [platform-pipeline.md](references/python/platform-pipeline.md) | [examples/platform-events-risk.md](references/python/examples/platform-events-risk.md) |
| Causal graphs, proofs, post-stream pipeline | [platform-pipeline.md](references/python/platform-pipeline.md) | [examples/graphs-proofs-pipeline.md](references/python/examples/graphs-proofs-pipeline.md) |
| MCP, quotas, error handling | [api-reference.md](references/python/api-reference.md) | [examples/mcp-quotas-errors.md](references/python/examples/mcp-quotas-errors.md) |
| Testing with mocks | [testing.md](references/python/testing.md) | — |

## Shared Reference Files

- [shared/platform-api.md](references/shared/platform-api.md) — platform namespaces, event shapes, AI system registration
- [shared/policies.md](references/shared/policies.md) — policy rules, checkpoints, enforcement modes, 100+ audit event types
- [shared/concepts.md](references/shared/concepts.md) — GovernanceContext, causal graphs, risk, proofs, PII scanning
