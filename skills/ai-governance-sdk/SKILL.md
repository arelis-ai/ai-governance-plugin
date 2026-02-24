---
name: ai-governance-sdk
description: "Generates and reviews code using the Arelis AI Governance SDK for TypeScript (@arelis-ai/ai-governance-sdk) and Python (ai-governance-sdk). Covers createArelis orchestration, governedInvoke, agents.run, governance gates, managed PII config, platform events, causal graphs, policy engines, audit sinks, MCP, RAG, memory, quotas, and compliance. Triggers on: imports from @arelis-ai packages, from arelis import, GovernanceContext, createArelis, createArelisClient, create_arelis_platform, withGovernanceGate, governedInvoke, or AI Governance SDK questions."
---

# AI Governance SDK

Governed AI orchestration framework supporting **TypeScript** and **Python**. Every operation needs a **GovernanceContext**, emits **audit events**, and integrates with the **Arelis Platform** for risk, compliance, and causal lineage.

## Language Detection

Determine which SDK the user is working with:
- **TypeScript**: imports from `@arelis-ai/ai-governance-sdk`, uses `createArelis`, `governedInvoke`, `withGovernanceGate`, `ArelisPlatform`, `.ts`/`.tsx` files
- **Python**: `pip install ai-governance-sdk`, imports from `arelis` (e.g. `from arelis import create_arelis_platform`), `.py` files, FastAPI/Django/Flask

## Architecture Overview

| Aspect | TypeScript | Python |
|--------|-----------|--------|
| **Package** | `@arelis-ai/ai-governance-sdk` | `ai-governance-sdk` (PyPI: `pip install ai-governance-sdk`, import as `from arelis import ...`) |
| **Recommended entrypoint (v1.2.1+)** | `createArelis()` unified orchestration instance | `create_arelis_platform({...})` |
| **Local governance client** | `createArelisClient()` — model execution, policy enforcement, memory, quotas | Not available — call model providers directly |
| **Platform client** | `ArelisPlatform` / `new ArelisPlatform({...})` | `create_arelis_platform({...})` |
| **High-level model calls** | `arelis.governedInvoke()` with built-in gate + events + optional risk | Direct SDK calls (google-genai, anthropic, openai) |
| **High-level agent loop** | `arelis.agents.run()` with pre-gate, tool loop, graph, platform sync | Manual loop + platform calls |
| **Policy engine** | Local `PolicyEngine` with automatic checkpoints | Platform-side `evaluate_policy()` + local regex PII scanning |
| **Audit sink** | Local sink + platform events | Platform events only |

---

## TypeScript Quick Start

For SDK `1.2.1+`, start with the **unified orchestrator**:

```typescript
import {
  createArelis,
  type GovernedAgentTool,
} from '@arelis-ai/ai-governance-sdk';

const arelis = createArelis({
  platform: {
    apiKey: process.env.ARELIS_API_KEY!,
    ...(process.env.ARELIS_API_URL ? { baseUrl: process.env.ARELIS_API_URL } : {}),
    maxRetries: 3,
    timeout: 30_000,
  },
});

// Managed PII config (namespace defaults to 'pii.default')
const piiConfig = await arelis.governance.getPiiConfig();

const invoke = await arelis.governedInvoke({
  runId: `run-${crypto.randomUUID()}`,
  model: 'gemini-2.5-flash',
  prompt: 'Summarize AI governance controls.',
  denyMode: 'return',
  invoke: async (sanitizedPrompt) => callModel(sanitizedPrompt),
});

const tools: GovernedAgentTool[] = [
  { name: 'lookupRegulation', description: 'Find regulation details', schema: { type: 'object', properties: { regulationName: { type: 'string' } }, required: ['regulationName'] } },
];

const agent = await arelis.agents.run({
  runId: `run-agent-${crypto.randomUUID()}`,
  model: 'gemini-2.5-flash',
  prompt: 'Summarize EU AI Act obligations for high-risk systems.',
  tools,
  invokeModel: async ({ model, messages }) => invokeAgentModel({ model, messages }),
  executeToolCall: async ({ tool }) => runTool(tool.name, tool.args),
});
```

`createArelis` still supports advanced split usage by exposing `arelis.runtime` and `arelis.platform`.

### TS Unified Namespaces

| Namespace | Methods |
|-----------|---------|
| `arelis.governedInvoke` | `governedInvoke(...)` |
| `arelis.agents` | `run(...)` |
| `arelis.governance` | `getPiiConfig({ namespace? })` |
| `arelis.platform` | `events`, `governance`, `risk`, `replay`, `graphs`, `proofs`, `aiSystems` |

### TS Runtime Namespaces (`createArelisClient`)

| Namespace | Methods |
|-----------|---------|
| `client.models` | `generate()`, `generateStream()` |
| `client.agents` | `run()` |
| `client.knowledge` | `registerKB()`, `retrieve()`, `getRegistry()` |
| `client.mcp` | `registerServer()`, `discoverTools()`, `getRegistry()` |
| `client.memory` | `read()`, `write()`, `delete()`, `list()` |
| `client.dataSources` | `register()`, `read()`, `getRegistry()` |
| `client.approvals` | `approve()`, `reject()`, `list()`, `get()` |
| `client.evaluations` | `run()` |
| `client.quotas` | `check()`, `commit()` |
| `client.secrets` | `resolve()` |
| `client.prompts` | `register()`, `get()`, `list()` |
| `client.compliance` | `requestArtifact()`, `getArtifacts()`, `verifyArtifact()`, `replayRun()` |
| `client.governance` | `createGateEvaluator()` |

### CRITICAL: No client.policy

`ArelisClient` does **not** have a `client.policy` namespace. For custom checkpoints (`BeforeToolCall`, `AfterToolResult`), export the `PolicyEngine` directly and call `policyEngine.evaluate()`. See [typescript/governance-patterns.md](references/typescript/governance-patterns.md#custom-policy-checkpoint-evaluation-no-clientpolicy).

### ResultEnvelope\<T\>

Every `client.*` method returns:

```typescript
const { runId, output, usage, policy, warnings } = result;
```

---

## Python Quick Start

Python uses **platform client only** — call model providers directly for inference:

```python
import os
import uuid
from datetime import datetime
from arelis import create_arelis_platform

# Platform client (singleton)
platform = create_arelis_platform({
    "base_url": os.environ["ARELIS_API_URL"],
    "api_key": os.environ["ARELIS_API_KEY"],
    "max_retries": 2,
    "timeout": 15_000,
})

# Direct model call (e.g. Google Gemini)
from google import genai
client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
response = client.models.generate_content(model="gemini-2.5-flash", contents="Hello")

# Emit governance events
run_id = f"run-chat-{uuid.uuid4()}"
await platform.events.create({
    "runId": run_id,
    "aiSystemId": ai_system_id,
    "eventType": "model.invoked",
    "actor": {"type": "human", "id": "user_1"},
    "resource": {"type": "model", "id": "gemini-2.5-flash"},
    "action": "inference",
    "timestamp": datetime.utcnow().isoformat(),
    "metadata": {"responseLength": len(response.text)},
})
```

---

## GovernanceContext (required on every call)

See [shared/concepts.md](references/shared/concepts.md#governancecontext) for full field reference.

```typescript
// TypeScript
const ctx: GovernanceContext = {
  org: { id: 'org_123', name: 'Acme' },
  actor: { type: 'human', id: 'user_456', email: 'a@acme.com', roles: ['analyst'] },
  purpose: 'customer-support',
  environment: 'dev',
  sessionId: 'sess_abc',
  tags: { feature: 'chat' },
};
```

```python
# Python
ctx = {
    "org": {"id": "org_123", "name": "Acme"},
    "actor": {"type": "human", "id": "user_456", "email": "a@acme.com", "roles": ["analyst"]},
    "purpose": "customer-support",
    "environment": "dev",
    "session_id": "sess_abc",
    "tags": {"feature": "chat"},
}
```

---

## Key Conventions (TypeScript)

- Import only from `@arelis-ai/ai-governance-sdk` (umbrella package)
- Named exports only — no default exports
- Use `type` imports: `import type { GovernanceContext } from '...'`
- Factory functions return interfaces, never concrete classes
- `generateRunId()` mints ULID run IDs
- Use `createPolicyModeEngine(engine, 'monitor')` in dev/test
- Use `createMemorySink()` in tests to inspect emitted audit events
- `createCompositeSink` takes an **array**: `createCompositeSink([sinkA, sinkB])` — NOT spread args
- Custom `ModelProvider` streaming method must be named **`stream`** (not `generateStream`)
- `QuotaDecision.allowed` may be `undefined` — always guard with `decision.effect === 'block'`
- Prefer `createArelis({ platform })` for new integrations (SDK `1.2.1+`)
- `ArelisPlatform` base URL now falls back to `https://api.arelis.digital` when omitted
- Managed PII config: use `arelis.governance.getPiiConfig({ namespace? })` (default namespace: `pii.default`)
- `withGovernanceGate` accepts an `ArelisPlatform` directly (no custom evaluator required)
- Gate decisions include timings in `decision.metadata.timings` (`scanMs`, `policyEvalMs`, `totalMs`)
- Gate and orchestrator flows report non-fatal side-effect failures in `result.warnings` instead of throwing
- **Always `await` platform calls** — use `.catch()` to swallow errors in serverless runtimes
- **Always include `aiSystemId`** on every `platform.events.create()` call
- Next.js: add `@arelis-ai/ai-governance-sdk` to `serverExternalPackages` in `next.config.ts`
- Next.js: create `src/instrumentation.ts` with `globalThis.require` polyfill for ULID crypto
- Gemini 3: always pass `rawParts` verbatim from model response (preserves thoughtSignature)

## Key Conventions (Python)

- **Install**: `pip install ai-governance-sdk` (PyPI package name is `ai-governance-sdk`, NOT `arelis`)
- Import from `arelis`: `from arelis import create_arelis_platform`
- Platform client is the only Arelis client — no local governance client
- Call model providers (google-genai, anthropic, openai) directly
- Implement PII scanning locally with regex patterns before model calls
- Use `evaluate_policy()` on the platform for server-side policy evaluation
- Always `await` platform calls — use try/except to log and swallow errors
- Always include `aiSystemId` on every `events.create()` call
- Generate unique `runId` per request: `f"run-chat-{uuid.uuid4()}"`
- Store platform as module-level singleton
- Run full 8-step post-stream pipeline after every successful model call
- Use `start_causal_graph()` BEFORE `graphs.commit()` — this is the most common mistake
- Gemini 3: pass raw response parts back verbatim to preserve thoughtSignature fields

---

## Common Tasks (TypeScript)

| Task | Reference File |
|------|---------------|
| Singleton setup, Next.js integration, ReadableStream route | [typescript/setup-patterns.md](references/typescript/setup-patterns.md) |
| Basic model calls, streaming, structured output | [typescript/model-patterns.md](references/typescript/model-patterns.md) |
| Governance gates, PII, policy checkpoints, function calling | [typescript/governance-patterns.md](references/typescript/governance-patterns.md) |
| Platform events, risk, proofs, causal graphs, post-stream pipeline | [typescript/platform-pipeline.md](references/typescript/platform-pipeline.md) |
| Agent runtime, tools, MCP, KB RAG, approvals | [typescript/agent-tool-patterns.md](references/typescript/agent-tool-patterns.md) |
| Memory, quotas, secrets, data sources, OTel, compliance | [typescript/state-patterns.md](references/typescript/state-patterns.md) |
| Testing with mocks | [typescript/testing.md](references/typescript/testing.md) |
| Complete API reference | [typescript/api-reference.md](references/typescript/api-reference.md) |

## Common Tasks (Python)

| Task | Reference File |
|------|---------------|
| Installation, platform client, AI system registration, web frameworks | [python/setup-patterns.md](references/python/setup-patterns.md) |
| Direct model calls with governance wrapping, streaming | [python/model-patterns.md](references/python/model-patterns.md) |
| PII scanning, policy CRUD, BeforeToolCall/AfterToolResult | [python/governance-patterns.md](references/python/governance-patterns.md) |
| Events, risk, proofs, causal graphs, full pipeline | [python/platform-pipeline.md](references/python/platform-pipeline.md) |
| Governed agent loop with Gemini function calling | [python/agent-tool-patterns.md](references/python/agent-tool-patterns.md) |
| Pytest patterns, mocking platform client | [python/testing.md](references/python/testing.md) |
| Complete Python API surface | [python/api-reference.md](references/python/api-reference.md) |

## Shared Reference Files

Read these for language-agnostic concepts:

- [shared/platform-api.md](references/shared/platform-api.md) — platform namespaces, event shapes, AI system registration, common event types
- [shared/policies.md](references/shared/policies.md) — policy JSON rules, checkpoint concepts, enforcement modes, complete audit event type catalog (100+ types), DataRef shapes
- [shared/concepts.md](references/shared/concepts.md) — GovernanceContext fields, architecture differences, causal graphs, risk, proofs, PII scanning, post-stream pipeline overview

## Policy Engines (TypeScript)

```typescript
createAllowAllEngine()                                    // dev/testing
createDenyAllEngine()                                     // block everything
createPolicyModeEngine(baseEngine, 'monitor')             // evaluate + audit, never block
await loadPolicyEngineFromFile('./policy.json')            // from config file
```

PolicyDecision effects: `'allow'` | `'block'` | `'transform'` | `'require_approval'`

Checkpoints: `BeforePrompt` | `AfterModelOutput` | `BeforeToolCall` | `AfterToolResult` | `BeforePersist`

## Error Handling (TypeScript)

```typescript
import {
  isPolicyBlockedError, isPolicyApprovalRequiredError,
  isEvaluationBlockedError, GovernanceGateDeniedError,
} from '@arelis-ai/ai-governance-sdk';

try { await client.models.generate(input); }
catch (err) {
  if (isPolicyBlockedError(err))           { /* err.reason, err.runId */ }
  if (isPolicyApprovalRequiredError(err))  { /* err.approvalId, err.approvers */ }
  if (isEvaluationBlockedError(err))       { /* err.reason */ }
  if (err instanceof GovernanceGateDeniedError) { /* err.decision */ }
}
```

## Audit Sinks (TypeScript)

```typescript
createNoOpSink()                          // discard
createConsoleSink({ pretty: true })       // stdout
createMemorySink()                        // in-memory (testing) — .events array
createCompositeSink([sink1, sink2])       // fan-out — takes an ARRAY, not spread args
```

## End-to-End Examples

Complete working demos that cover the full governance lifecycle (PII scanning, policy gates, model calls, agent tool use, risk scoring, causal graphs, compliance proofs):

- [examples/test-platform-first-governance.ts](examples/test-platform-first-governance.ts) — TypeScript `1.2.1+` demo using `createArelis`, managed PII config, `governedInvoke`, `agents.run`, warnings, timings, and platform-first orchestration
- [examples/test-developer-value.py](examples/test-developer-value.py) — Python demo using `create_arelis_platform`, local PII regex scanning, direct google-genai + anthropic calls, governed agent loop with Gemini function calling

Use these as a reference when implementing any governance integration end-to-end.

## Validation Scripts

```bash
# TypeScript project validation
python .claude/skills/arelis-sdk/scripts/validate_governance_setup.py --project-dir . --lang ts

# Python project validation
python .claude/skills/arelis-sdk/scripts/validate_python_setup.py --project-dir .
```
