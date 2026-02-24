# AI Governance SDK — Setup Patterns

Setup, singleton initialization, AI system registration, platform event reporting, and Next.js integration.

---

## Table of Contents

- [Governance Module Singleton](#governance-module-singleton-libgovernancets)
- [Unified Orchestrator Singleton](#unified-orchestrator-singleton-createarelis)
- [AI System Registration](#ai-system-registration)
- [Platform Event Reporting](#platform-event-reporting)
- [Next.js App Router Integration](#nextjs-app-router-integration)
- [Next.js ReadableStream Route Pattern](#nextjs-readablestream-route-pattern)

---

## Governance Module Singleton (lib/governance.ts)

The canonical pattern for Next.js: export both clients as singletons initialized at request time.

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

---

## Next.js App Router Integration

The SDK uses ULID internally, which requires crypto. Turbopack's ESM server runtime has no `require`, so ULID's Node.js crypto path silently fails unless you add two things:

### 1. `next.config.ts` — prevent re-bundling

```typescript
const nextConfig: NextConfig = {
  serverExternalPackages: [
    '@arelis-ai/ai-governance-sdk',
    // add any sub-packages from @arelis-ai/* if installed separately
  ],
};
```

### 2. `src/instrumentation.ts` — polyfill `require` before first import

```typescript
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    if (typeof (globalThis as Record<string, unknown>).require === 'undefined') {
      const { createRequire } = await import('node:module');
      Object.defineProperty(globalThis, 'require', {
        value: createRequire(process.cwd() + '/dummy.js'),
        writable: true, configurable: true, enumerable: false,
      });
    }
  }
}
```

This file runs at server startup before any route handles a request. ULID's `detectPrng()` checks `typeof require !== "undefined"` — once `globalThis.require` is set, `require('crypto')` succeeds.

---

## Next.js ReadableStream Route Pattern

Complete API route using `withGovernanceGate` for pre-invocation PII policy enforcement, dynamic imports, per-request `runId`, governance streaming, and full post-stream pipeline. Guard the controller against double-close (client disconnects) and early returns.

**Key architecture**: `withGovernanceGate` wraps the streaming model call. For SDK `1.2.1+`, pass `ArelisPlatform` directly to get automatic gate telemetry events, timing diagnostics, and warning capture.

```typescript
export const dynamic = 'force-dynamic';

import type { GovernanceContext } from '@arelis-ai/ai-governance-sdk';

const MODEL_ID = 'your-model';

export async function POST(req: Request) {
  const { messages, sessionId, userId, conversationId } = await req.json();

  // Dynamic imports defer SDK evaluation until request time
  const { getGovernanceClient, getArelisPlatform, ensureAiSystemRegistered, extractPolicyDecisions } =
    await import('@/lib/governance');
  const {
    isPolicyBlockedError, isPolicyApprovalRequiredError, isEvaluationBlockedError,
    withGovernanceGate,
  } = await import('@arelis-ai/ai-governance-sdk');

  const client = getGovernanceClient();
  const platform = getArelisPlatform();
  const runId = `run-chat-${crypto.randomUUID()}`;
  const actorId = userId ?? 'anonymous';

  const ctx: GovernanceContext = {
    org: { id: 'your-org', name: 'Your Org' },
    actor: { type: 'human', id: actorId, roles: ['user'] },
    purpose: 'chat',
    environment: process.env.NODE_ENV === 'production' ? 'prod' : 'dev' as 'prod' | 'dev',
    sessionId: sessionId ?? `session-${Date.now()}`,
    tags: { feature: 'chat', ...(conversationId ? { conversationId } : {}) },
  };

  const modelMessages = messages.map((m: { role: string; content: string }) => ({
    role: m.role,
    content: m.content,
  }));

  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      // Guard helpers — tolerate client disconnects and double-close
      const send = (text: string) => {
        try { controller.enqueue(encoder.encode(text)); } catch { /* disconnected */ }
      };
      const close = () => {
        try { controller.close(); } catch { /* already closed */ }
      };

      try {
        // Quota check — use effect, not .allowed (may be undefined)
        const quota = await client.quotas.check(
          { type: 'user', id: actorId, period: 'day' },
          { requestsCount: 1 },
        );
        if ((quota as { effect: string }).effect === 'block') {
          send('Quota exceeded.');
          return;  // finally will close
        }

        // Ensure model is registered as an AI system (idempotent, cached)
        const aiSystemId = await ensureAiSystemRegistered(platform, MODEL_ID);

        // ── Governance gate wraps the streaming model call ──────────────
        const lastUserContent = messages[messages.length - 1]?.content ?? '';

        const gate = await withGovernanceGate(
          platform,
          {
            runId,
            prompt: lastUserContent,
            model: MODEL_ID,
            actor: ctx.actor,
            context: ctx,
          },
          async () => {
            const { stream } = await client.models.generateStream({
              model: MODEL_ID,
              request: { model: MODEL_ID, messages: modelMessages, context: ctx },
              context: ctx,
              streamOptions: { emitChunks: true, abortOnSensitive: true },
            });

            let output = '';
            for await (const chunk of stream) {
              if (chunk.type === 'content' && chunk.content) {
                output += chunk.content;
                send(chunk.content);
              } else if (chunk.type === 'error') {
                send(`[Error: ${chunk.error?.message}]`);
                break;
              }
            }
            return output;
          },
          { denyMode: 'return' },
        );
        const timings = gate.decision.metadata.timings;
        console.log('[Arelis] gate timings ms', timings);
        for (const warning of gate.warnings ?? []) {
          console.warn('[Arelis] governance warning:', warning);
        }

        // ── Handle gate denial ──────────────────────────────────────────
        const piiResult = gate.decision.pii;
        const piiTypes = [...new Set(piiResult.findings.map((f: { pattern?: string; type: string }) => f.pattern ?? f.type))];

        if (!gate.invoked) {
          send('Unable to process this request. PII was detected in your message.');
          await platform.events.create({
            runId, aiSystemId,
            eventType: 'model_invocation_blocked',
            actor: { type: 'human', id: actorId },
            resource: { type: 'model', id: MODEL_ID },
            action: 'blocked_by_policy',
            timestamp: new Date().toISOString(),
            metadata: {
              pii_types: piiTypes,
              pii_count: piiResult.findings.length,
              policy_decision: gate.decision.decision,
            },
          }).catch((e) => console.error('[Arelis] Failed to emit PII blocked event:', e));
          return;
        }

        const totalOutput = gate.result ?? '';

        // ── Full Governance Post-Stream Pipeline ────────────────────────
        // See platform-pipeline.md for detailed explanation of each step.

        // A. Extract policy decisions (sync, from audit sink)
        const policyDecisions = extractPolicyDecisions(runId);

        // B. Emit policy.evaluated event
        await platform.events.create({
          runId, aiSystemId,
          eventType: 'policy.evaluated',
          actor: { type: 'human', id: actorId },
          resource: { type: 'model', id: MODEL_ID },
          action: 'evaluate',
          timestamp: new Date().toISOString(),
          metadata: {
            checkpoints: ['BeforePrompt', 'AfterModelOutput', 'BeforePersist'],
            decisionsCount: policyDecisions.length,
            decisions: policyDecisions,
            enforcementMode: process.env.NODE_ENV === 'production' ? 'enforce' : 'monitor',
            pii_detected: piiResult.hasPii,
            pii_types: piiTypes,
          },
        }).catch(err => console.error('[Arelis] policy.evaluated event failed:', err));

        // C. Emit model.invoked + output.delivered events
        await Promise.all([
          platform.events.create({
            runId, aiSystemId,
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
            },
          }),
          platform.events.create({
            runId, aiSystemId,
            eventType: 'output.delivered',
            actor: { type: 'human', id: actorId },
            resource: { type: 'model', id: MODEL_ID },
            action: 'deliver',
            timestamp: new Date().toISOString(),
            metadata: { outputLength: totalOutput.length, containsPII: false },
          }),
        ]).catch(err => console.error('[Arelis] Failed to emit platform events:', err));

        // Steps D–H: evaluatePolicy, risk, proofs, causal graph, commit
        // See platform-pipeline.md for full implementation of each step.
        // D. await platform.governance.evaluatePolicy({ runId, checkpoint: { type: 'AfterModelOutput', ... } })
        // E. await platform.risk.evaluate({ runId, aiSystemId, policyDecisions, ... })
        // F. await platform.proofs.create({ runId, aiSystemId, schemaVersion: 'v1' })
        // G. await platform.replay.startCausalGraph({ runId, nodes, edges }) — BEFORE commit
        // H. await platform.graphs.commit(runId) — MUST be last

      } catch (err) {
        // Handle policy blocks, approval requirements, evaluation blocks
        // See governance-patterns.md for full error handling pattern
        if (isPolicyBlockedError(err)) {
          send(`Policy blocked this request. ${(err as { reason?: string }).reason ?? ''}`);
        } else if (isPolicyApprovalRequiredError(err)) {
          send('This request requires administrator approval.');
        } else if (isEvaluationBlockedError(err)) {
          send(`Blocked by safety evaluation: ${(err as { reason?: string }).reason ?? ''}`);
        } else {
          send(`Error: ${err instanceof Error ? err.message : 'Unknown'}`);
        }
        // Emit model_invocation_blocked event for policy/evaluation blocks
      } finally {
        close();
      }
    },
  });

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
      'X-Governance-Enabled': 'true',
      'X-Governance-Model': MODEL_ID,
    },
  });
}
```
