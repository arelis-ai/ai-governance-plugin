# AI Governance SDK — Next.js Integration

Next.js App Router configuration, polyfills, and streaming route patterns for the AI Governance SDK.

---

## Table of Contents

- [Next.js App Router Integration](#nextjs-app-router-integration)
- [Next.js ReadableStream Route Pattern](#nextjs-readablestream-route-pattern)

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
