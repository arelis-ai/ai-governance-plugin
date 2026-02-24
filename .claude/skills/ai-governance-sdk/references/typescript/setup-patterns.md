# AI Governance SDK — Setup Patterns

Setup, singleton initialization, AI system registration, and platform event reporting.

---

## Table of Contents

- [Governance Module Singleton](#governance-module-singleton-libgovernancets)
- [Unified Orchestrator Singleton](#unified-orchestrator-singleton-createarelis)
- [AI System Registration](#ai-system-registration)
- [Platform Event Reporting](#platform-event-reporting)

---

## Governance Module Singleton (lib/governance.ts)

The canonical pattern for server-side apps: export both clients as singletons initialized at request time.

```typescript
import {
  createArelisClient,
  createModelRegistry,
  createPolicyModeEngine,
  createConsoleSink,
  createMemorySink,
  createCompositeSink,
  ArelisPlatform,
  type ArelisClient,
} from '@arelis-ai/ai-governance-sdk';
import { createGeminiProvider } from './gemini-provider'; // your custom provider

let _client: ArelisClient | null = null;
let _platform: ArelisPlatform | null = null;

export function getGovernanceClient(): ArelisClient {
  if (_client) return _client;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set');

  const modelRegistry = createModelRegistry();
  modelRegistry.register(createGeminiProvider(apiKey));

  const enforcementMode = process.env.NODE_ENV === 'production' ? 'enforce' : 'monitor';

  _client = createArelisClient({
    modelRegistry,
    policyEngine: createPolicyModeEngine(myPolicyEngine, enforcementMode),
    auditSink: createCompositeSink([
      createConsoleSink({ pretty: true, timestamp: true }),
      createMemorySink(),
    ]),
  });

  return _client;
}

export function getArelisPlatform(): ArelisPlatform {
  if (_platform) return _platform;

  const apiKey = process.env.ARELIS_API_KEY;
  if (!apiKey) throw new Error('ARELIS_API_KEY is not set');

  _platform = new ArelisPlatform({
    apiKey,
    ...(process.env.ARELIS_API_URL ? { baseUrl: process.env.ARELIS_API_URL } : {}),
    maxRetries: 2,
    timeout: 15_000,
  });
  return _platform;
}
```

---

## Unified Orchestrator Singleton (`createArelis`)

Use this pattern for SDK `1.2.1+` when you want `governedInvoke`, `agents.run`, and managed PII config from one instance.

```typescript
import { createArelis } from '@arelis-ai/ai-governance-sdk';

let _arelis: ReturnType<typeof createArelis> | null = null;

export function getArelis() {
  if (_arelis) return _arelis;

  const apiKey = process.env.ARELIS_API_KEY;
  if (!apiKey) throw new Error('ARELIS_API_KEY is not set');

  _arelis = createArelis({
    platform: {
      apiKey,
      ...(process.env.ARELIS_API_URL ? { baseUrl: process.env.ARELIS_API_URL } : {}),
      maxRetries: 3,
      timeout: 30_000,
    },
    // Optional: set default aiSystemId that auto-propagates through governedInvoke,
    // agents.run, governance gate, platform events, proofs, risk, and MCP evaluations.
    // Can be overridden per-call on governedInvoke({ aiSystemId }) or agents.run({ aiSystemId }).
    aiSystemId: process.env.ARELIS_AI_SYSTEM_ID,
  });

  return _arelis;
}
```

`ARELIS_API_URL` is optional; when omitted, SDK defaults to `https://api.arelis.digital`.

---

## AI System Registration

Every model must be registered as an AI system on the Arelis Platform before emitting events. This is idempotent — check if the system already exists, register only if needed, and cache the `aiSystemId`.

```typescript
import type { ArelisPlatform } from '@arelis-ai/ai-governance-sdk';

let _aiSystemId: string | null = null;

async function ensureAiSystemRegistered(
  platform: ArelisPlatform,
  modelId: string,
): Promise<string> {
  if (_aiSystemId) return _aiSystemId;

  const { data: existing } = await platform.aiSystems.list({ type: 'model' });
  const match = existing.find((s) => s.modelRef === modelId && s.status === 'active');
  if (match) {
    _aiSystemId = match.id;
    return _aiSystemId;
  }

  const record = await platform.aiSystems.register({
    name: modelId,
    type: 'model',
    provider: 'google',        // adjust per provider
    modelRef: modelId,
    description: `AI system for ${modelId}`,
    metadata: { registeredAt: new Date().toISOString() },
  });

  _aiSystemId = record.id;
  return _aiSystemId;
}
```

### AiSystemInput fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | yes | Display name in the Arelis dashboard |
| `type` | `AiSystemType` | yes | `'model'` \| `'agent'` \| `'pipeline'` \| `'tool_chain'` |
| `provider` | `string` | no | Provider name (`'google'`, `'openai'`, `'anthropic'`, etc.) |
| `modelRef` | `string` | no | Model identifier (e.g. `'gemini-3-flash-preview'`) |
| `version` | `string` | no | Version tag |
| `description` | `string` | no | Human-readable description |
| `config` | `Record<string, unknown>` | no | Arbitrary configuration |
| `metadata` | `Record<string, unknown>` | no | Arbitrary metadata |
| `tags` | `string[]` | no | Searchable tags |

---

## Platform Event Reporting

Emit events to the Arelis governance dashboard after every model interaction. **Always include `aiSystemId`** so events are linked to the registered AI system.

**IMPORTANT:** Always `await` platform event calls. In serverless runtimes (Next.js App Router, Vercel Functions, AWS Lambda) the process can terminate as soon as the response is sent, killing any unawaited (`void`) promises before they reach the Arelis Platform. Use `.catch()` to swallow errors so they never surface to users, but log them for debugging.

```typescript
const platform = getArelisPlatform();
const runId = `run-chat-${crypto.randomUUID()}`;
const actorId = userId ?? 'anonymous';

// Ensure the model is registered as an AI system (idempotent, cached)
const aiSystemId = await ensureAiSystemRegistered(platform, MODEL_ID);

// After successful generation
await Promise.all([
  platform.events.create({
    runId,
    aiSystemId,
    eventType: 'model.invoked',
    actor: { type: 'human', id: actorId },
    resource: { type: 'model', id: MODEL_ID },
    action: 'inference',
    timestamp: new Date().toISOString(),
    metadata: {
      responseLength: totalOutput.length,
      sessionId: ctx.sessionId,
      purpose: ctx.purpose,
      environment: ctx.environment,
      conversationId: conversationId ?? null,
    },
  }),
  platform.events.create({
    runId,
    aiSystemId,
    eventType: 'output.delivered',
    actor: { type: 'human', id: actorId },
    resource: { type: 'model', id: MODEL_ID },
    action: 'deliver',
    timestamp: new Date().toISOString(),
    metadata: { outputLength: totalOutput.length, containsPII: false },
  }),
]).catch((err) => console.error('[Arelis] Failed to emit platform events:', err));

// After policy block
await platform.events.create({
  runId,
  aiSystemId,
  eventType: 'model_invocation_blocked',
  actor: { type: 'human', id: actorId },
  resource: { type: 'model', id: MODEL_ID },
  action: 'blocked_by_policy',
  timestamp: new Date().toISOString(),
  metadata: { reason: blockedReason, policyType: 'governance' },
}).catch((err) => console.error('[Arelis] Failed to emit blocked event:', err));

// After evaluation block
await platform.events.create({
  runId,
  aiSystemId,
  eventType: 'model_invocation_blocked',
  actor: { type: 'human', id: actorId },
  resource: { type: 'model', id: MODEL_ID },
  action: 'blocked_by_evaluation',
  timestamp: new Date().toISOString(),
  metadata: { reason: evalReason, policyType: 'evaluation' },
}).catch((err) => console.error('[Arelis] Failed to emit evaluation-blocked event:', err));

// Agent tool call + result
await platform.events.create({
  runId,
  aiSystemId,
  eventType: 'tool.call',
  actor: { type: 'agent', id: agentId },
  resource: { type: 'tool', id: toolName },
  action: 'invoke',
  timestamp: new Date().toISOString(),
  metadata: { toolName, args, step: stepNumber },
});
const toolResult = executeToolCall(toolName, args);
await platform.events.create({
  runId,
  aiSystemId,
  eventType: 'tool.result',
  actor: { type: 'agent', id: agentId },
  resource: { type: 'tool', id: toolName },
  action: 'complete',
  timestamp: new Date().toISOString(),
  metadata: { toolName, success: !('error' in toolResult), resultKeys: Object.keys(toolResult) },
});
```
