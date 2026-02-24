# AI Governance SDK — Governance Patterns

Governance gates, policy engines, custom policy checkpoint evaluation, governed function calling, and error handling.

---

## Table of Contents

- [Pre-Invocation Governance Gate](#pre-invocation-governance-gate-pii--platform-policy)
- [Custom Policy Checkpoint Evaluation](#custom-policy-checkpoint-evaluation-no-clientpolicy)
- [Governance Gate Helpers (Standalone)](#governance-gate-helpers-standalone)
- [Governed Function Calling (Gemini)](#governed-function-calling-gemini)
- [NDJSON Streaming Protocol](#ndjson-streaming-protocol)
- [Error Handling](#error-handling)

---

## Pre-Invocation Governance Gate (PII + Platform Policy)

**CRITICAL**: Always wrap model invocation with `withGovernanceGate`. This enforces prompt PII scan and policy evaluation **before** model execution.

### Recommended (SDK 1.2.1+): pass `ArelisPlatform` directly

`withGovernanceGate` now accepts `ArelisPlatform` directly as the source. In this mode it:
- evaluates pre-invocation governance using the platform client,
- surfaces timing diagnostics at `decision.metadata.timings` (`scanMs`, `policyEvalMs`, `totalMs`),
- auto-emits `governance.gate.evaluated` and `governance.gate.outcome` platform telemetry events,
- returns non-fatal side-effect failures in `warnings` instead of failing invocation.

```typescript
import { withGovernanceGate } from '@arelis-ai/ai-governance-sdk';

const gate = await withGovernanceGate(
  platform, // ArelisPlatform
  {
    runId,
    prompt: lastUserContent,
    model: MODEL_ID,
    actor: ctx.actor,
    context: ctx,
    policyIds: [policyId],
  },
  async () => {
    const { stream } = await client.models.generateStream({ ... });
    let output = '';
    for await (const chunk of stream) {
      if (chunk.type === 'content' && chunk.content) output += chunk.content;
    }
    return output;
  },
  { denyMode: 'return' }, // 'return' => gate.invoked=false, 'throw' => GovernanceGateDeniedError
);

const timings = gate.decision.metadata.timings;
console.log(`scan=${timings.scanMs} policy=${timings.policyEvalMs} total=${timings.totalMs}`);
for (const warning of gate.warnings ?? []) {
  console.warn('[governance warning]', warning);
}
```

### Managed PII config retrieval

Use managed regex/redaction config from the platform namespace when you need explicit local scans:

```typescript
import { scanPromptForPii } from '@arelis-ai/ai-governance-sdk';

const piiConfig = await platform.governance.getPiiConfig({ namespace: 'pii.default' });
const pii = scanPromptForPii(lastUserContent, { redactorConfig: piiConfig });
```

If `namespace` is omitted, it defaults to `pii.default`.

### Advanced pattern: custom evaluator with `createGovernanceGateEvaluator`

Use this only when you need custom context resolution or custom policy mapping logic:

```typescript
import {
  createGovernanceGateEvaluator,
  withGovernanceGate,
  scanPromptForPii,
} from '@arelis-ai/ai-governance-sdk';

const gateEvaluator = createGovernanceGateEvaluator({
  resolveContext: async (partial) => ({
    org: partial?.org ?? ctx.org,
    actor: partial?.actor ?? ctx.actor,
    purpose: partial?.purpose ?? ctx.purpose,
    environment: partial?.environment ?? ctx.environment,
  }),
  evaluatePolicy: async (input) => {
    const inputMessages = Array.isArray(input.data.input) ? input.data.input : [];
    const prompt = (inputMessages[0] as { content?: string } | undefined)?.content ?? '';
    const pii = scanPromptForPii(prompt);
    const piiTypes = [...new Set(pii.findings.map((f) => f.pattern ?? f.type))];

    const evalResult = await platform.governance.evaluatePolicy({
      runId: input.runId,
      checkpoint: { content: { pii_detected: pii.hasPii, pii_types: piiTypes, pii_count: pii.findings.length } },
    });

    const decisions = (evalResult.decisions as { decision: string; policyId: string; metadata?: { policyName?: string } }[]).map((d) =>
      d.decision === 'deny'
        ? { effect: 'block' as const, reason: `Denied by ${d.metadata?.policyName ?? d.policyId}`, code: `PII_DENY_${d.policyId}` }
        : { effect: 'allow' as const },
    );

    const firstBlock = decisions.find((d) => d.effect === 'block');
    return { decisions, summary: firstBlock ? { allowed: false, blockReason: firstBlock.reason } : { allowed: true } };
  },
});
```

### Handle deny results

If `gate.invoked` is `false`, the model call was skipped and you should return a blocked response path (optionally adding a `model_invocation_blocked` event).

### Platform policy rule format

```json
{
  "key": "pii-deny-before-invocation",
  "name": "PII Deny Before Model Invocation",
  "condition": { "field": "content.pii_detected", "operator": "eq", "value": true },
  "action": "deny",
  "severity": "critical",
  "priority": 1
}
```

Create this policy via `platform.governance.policies.create()` at startup (idempotent — check `policies.list()` first).

### Why not manual `scanPromptForPii` + `evaluatePolicy`?

**Do not** manually wire scan + evaluate + branch logic for normal pre-invocation checks. That bypasses:
- consistent gate result shape,
- built-in deny behavior handling (`return` / `throw`),
- timing diagnostics,
- automatic gate telemetry events,
- warning capture for non-fatal side-effect failures.

---

## Custom Policy Checkpoint Evaluation (no client.policy)

The `ArelisClient` only runs policy evaluation internally during `generate()` / `generateStream()` calls for the built-in `BeforePrompt` and `AfterModelOutput` checkpoints. For custom checkpoints like `BeforeToolCall` and `AfterToolResult`, you must call the `PolicyEngine` directly.

**Step 1:** Export your policy engine from the governance module:

```typescript
// src/lib/governance.ts
export const chatbotPolicyEngine: PolicyEngine = {
  async evaluate(input: PolicyInput): Promise<PolicyResult> {
    const { checkpoint, context, data } = input;

    // BeforeToolCall: PII scan on tool arguments + trust level check
    if (checkpoint === 'BeforeToolCall') {
      const toolData = data as { toolName?: string; args?: Record<string, unknown>; trustLevel?: string };
      const serializedArgs = JSON.stringify(toolData.args ?? {});
      const piiResult = scanPromptForPii(serializedArgs);
      if (piiResult.hasPii && context.environment === 'prod') {
        return {
          decisions: [blockDecision('PII detected in tool arguments', 'TOOL_ARGS_PII')],
          summary: { allowed: false, blockReason: 'Tool call blocked: PII in arguments' },
        };
      }
      if (toolData.trustLevel === 'high' && context.environment === 'prod') {
        return {
          decisions: [blockDecision('High-trust tool requires escalation', 'HIGH_TRUST_TOOL_BLOCKED')],
          summary: { allowed: false, blockReason: 'Tool requires escalation approval' },
        };
      }
    }

    // AfterToolResult: scan tool output for credential patterns
    if (checkpoint === 'AfterToolResult') {
      const outputStr = JSON.stringify((data as { output?: unknown })?.output ?? '');
      if (/(?:api[_-]?key|secret|password|bearer\s+token|access[_-]?token)\s*[:=]\s*\S{8,}/i.test(outputStr)) {
        return {
          decisions: [transformDecision('Credential pattern detected in tool output')],
          summary: { allowed: true, warnings: ['Tool output contained credential-like patterns'] },
        };
      }
    }

    return { decisions: [allowDecision()], summary: { allowed: true } };
  },
};
```

**Step 2:** Call the policy engine directly from your API route:

```typescript
const { chatbotPolicyEngine } = await import('@/lib/governance');

const policyResult = await chatbotPolicyEngine.evaluate({
  checkpoint: 'BeforeToolCall',
  context: ctx,
  data: { toolName: fc.name, args: fc.args, trustLevel: 'medium' },
});

const isBlocked = policyResult.summary && !policyResult.summary.allowed;
if (isBlocked) {
  const reason = (policyResult.summary as { blockReason?: string }).blockReason ?? 'Blocked by policy';
  // Handle blocked tool call...
}

const afterResult = await chatbotPolicyEngine.evaluate({
  checkpoint: 'AfterToolResult',
  context: ctx,
  data: { output: toolResult },
});
const warnings = (afterResult.summary as { warnings?: string[] })?.warnings ?? [];
```

**Why not `client.policy.evaluate()`?** The `ArelisClient` applies policies automatically during model generation calls. For tool-level governance outside the model call path, the policy engine must be invoked directly. This is by design — tool calls happen in a custom loop controlled by your application code, not by the SDK's internal model pipeline.

---

## Governance Gate Helpers (Standalone)

For simpler cases or external LLM calls not using `createGovernanceGateEvaluator`:

```typescript
import {
  withGovernanceGate,
  scanPromptForPii,
  evaluatePreInvocationGate,
  createArelis,
  generateRunId,
  GovernanceGateDeniedError,
} from '@arelis-ai/ai-governance-sdk';

const arelis = createArelis({
  platform: {
    apiKey: process.env.ARELIS_API_KEY!,
    ...(process.env.ARELIS_API_URL ? { baseUrl: process.env.ARELIS_API_URL } : {}),
  },
});

// 1. Scan for PII
const pii = scanPromptForPii('Call me at 555-123-4567');
console.log(pii.hasPii, pii.findings);

// 2. Evaluate pre-invocation gate
const gate = await evaluatePreInvocationGate(arelis.platform!, {
  runId: generateRunId(),
  prompt: 'User query',
  model: 'gemini-2.5-flash',
  actor: ctx.actor,
  context: ctx,
});
if (gate.decision === 'deny') console.log('Denied:', gate.reasons);

// 3. Wrap external LLM call with governance
const result = await withGovernanceGate(
  arelis.platform!,
  { prompt: 'query', model: 'gpt-4', actor: ctx.actor, context: ctx },
  async () => myExternalLlmCall('query'),
  { denyMode: 'return' },  // or 'throw'
);

console.log(result.decision.metadata.timings.totalMs);
for (const warning of result.warnings ?? []) {
  console.warn(warning);
}

if (!result.invoked) {
  console.log('Gate denied invocation');
}
```

---

## Governed Function Calling (Gemini)

When using Gemini function calling with governance, every tool execution must be wrapped in policy checkpoints. The pattern uses a custom `generateWithTools()` method on the Gemini provider, a function calling loop in the API route, and NDJSON streaming to the client.

### Gemini Provider Extension

Extend your custom Gemini provider with `generateWithTools()` for non-streaming function call detection. Use an intersection type (not `extends`) because `ModelProvider` doesn't define the `id` property that providers include at runtime:

```typescript
import type { FunctionDeclaration } from '@google/genai';
import type { ModelProvider } from '@arelis-ai/ai-governance-sdk';

export interface FunctionCallPart {
  name: string;
  args: Record<string, unknown>;
}

export interface GenerateWithToolsResult {
  text: string | null;
  functionCalls: FunctionCallPart[];
  /** Raw parts from the model response — must be sent back verbatim to preserve thoughtSignature fields required by Gemini 3. */
  rawParts: Record<string, unknown>[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number };
}

// IMPORTANT: Use intersection type, not `interface extends ModelProvider`
export type GeminiProviderWithTools = ModelProvider & {
  generateWithTools(
    model: string,
    toolDeclarations: FunctionDeclaration[],
    contents: { role: string; parts: Record<string, unknown>[] }[],
  ): Promise<GenerateWithToolsResult>;
};
```

### Tool Declarations with Trust Levels

```typescript
import type { FunctionDeclaration, Type } from '@google/genai';

export const TOOL_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: 'schedule_meeting',
    description: 'Schedule a meeting with attendees',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        title: { type: 'STRING' as Type, description: 'Meeting title' },
        // ...
      },
      required: ['title', 'date', 'time', 'attendees'],
    },
  },
];

export const TOOL_TRUST_LEVELS: Record<string, 'low' | 'medium' | 'high'> = {
  search_knowledge_base: 'low',
  run_compliance_check: 'low',
  get_user_info: 'medium',
  schedule_meeting: 'medium',
};
```

### Function Calling Loop with Governance Gates

```typescript
const MAX_TOOL_ITERATIONS = 5;

for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
  const response = await provider.generateWithTools(MODEL_ID, TOOL_DECLARATIONS, contents);

  if (response.functionCalls.length === 0) {
    sendJson({ type: 'text', content: response.text ?? '' });
    return response.text ?? '';
  }

  const functionResponseParts: Record<string, unknown>[] = [];

  for (const fc of response.functionCalls) {
    sendJson({ type: 'tool_call', name: fc.name, args: fc.args });

    // BeforeToolCall governance checkpoint (call policy engine directly!)
    const trustLevel = TOOL_TRUST_LEVELS[fc.name] ?? 'low';
    const policyResult = await chatbotPolicyEngine.evaluate({
      checkpoint: 'BeforeToolCall',
      context: ctx,
      data: { toolName: fc.name, args: fc.args, trustLevel },
    });

    if (policyResult.summary && !policyResult.summary.allowed) {
      sendJson({ type: 'tool_result', name: fc.name, success: false, decision: 'blocked', summary: reason });
      await platform.events.create({ runId, aiSystemId, eventType: 'tool.call_blocked', ... });
      functionResponseParts.push({ functionResponse: { name: fc.name, response: { error: '...' } } });
    } else {
      const toolResult = await executeTool(fc.name, fc.args);
      const afterResult = await chatbotPolicyEngine.evaluate({
        checkpoint: 'AfterToolResult', context: ctx, data: { output: toolResult },
      });
      sendJson({ type: 'tool_result', name: fc.name, success: toolResult.success, decision: 'allowed', summary: '...' });
      await Promise.all([
        platform.events.create({ runId, aiSystemId, eventType: 'tool.call', ... }),
        platform.events.create({ runId, aiSystemId, eventType: 'tool.result', ... }),
      ]);
      functionResponseParts.push({ functionResponse: { name: fc.name, response: toolResult.data } });
    }
  }

  // IMPORTANT: Push raw parts from the model response verbatim.
  // Gemini 3 "thinking" models include thoughtSignature fields on functionCall parts.
  // These MUST be preserved — reconstructing parts manually strips them and causes a 400 error.
  // See: https://ai.google.dev/gemini-api/docs/thought-signatures
  contents.push({ role: 'model', parts: response.rawParts });
  contents.push({ role: 'user', parts: functionResponseParts });
}
```

> **Gemini 3 thought signatures**: When using `gemini-3-*` models with function calling, the API response includes `thoughtSignature` fields on `functionCall` parts. You **must** pass these back verbatim in the conversation history. The `rawParts` field on `GenerateWithToolsResult` contains the unmodified parts array from `candidates[0].content.parts`. Never reconstruct parts manually (e.g. `.map(fc => ({ functionCall: { name, args } }))`) — this strips thought signatures and produces a `400 INVALID_ARGUMENT` error.

See [setup-patterns.md — Next.js ReadableStream Route Pattern](setup-patterns.md#nextjs-readablestream-route-pattern) for the complete route implementation.

### Tool Call Audit Events

Three event types for tool governance:
- `tool.call` — emitted when a tool is successfully invoked (action: `'invoke'`)
- `tool.result` — emitted after tool execution completes (action: `'result'`)
- `tool.call_blocked` — emitted when governance blocks a tool call (action: `'blocked_by_policy'`)

Include `toolName` and `trustLevel` in metadata. Resource type should be `'tool'` with the tool name as the ID.

---

## NDJSON Streaming Protocol

When function calling is enabled, the API route streams newline-delimited JSON instead of plain text. Set `Content-Type: application/x-ndjson; charset=utf-8`.

```
{"type":"text","content":"Here's what I found..."}
{"type":"tool_call","name":"search_knowledge_base","args":{"query":"GDPR"}}
{"type":"tool_result","name":"search_knowledge_base","success":true,"decision":"allowed","summary":"Completed successfully"}
{"type":"error","message":"Something went wrong"}
```

**Backward compatibility**: When `enableToolCalling` is not set in the request body, preserve the existing plain-text streaming path. The client should check `Content-Type` for `ndjson` to determine parsing mode.

### NDJSON Response Headers

```typescript
return new Response(readable, {
  headers: {
    'Content-Type': enableToolCalling
      ? 'application/x-ndjson; charset=utf-8'
      : 'text/plain; charset=utf-8',
    'Cache-Control': 'no-cache',
    'X-Accel-Buffering': 'no',
  },
});
```

### Client-Side NDJSON Parsing

```typescript
const isNdjson = res.headers.get('Content-Type')?.includes('ndjson');
let lineBuffer = '';

if (isNdjson) {
  lineBuffer += chunk;
  const lines = lineBuffer.split('\n');
  lineBuffer = lines.pop() ?? '';

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed.type === 'text') fullText += parsed.content ?? '';
      else if (parsed.type === 'tool_call') toolCalls.push({ name: parsed.name, args: parsed.args, decision: 'allowed' });
      else if (parsed.type === 'tool_result') { /* update matching tool call */ }
      else if (parsed.type === 'error') fullText += parsed.message ?? '';
    } catch {
      fullText += trimmed;
    }
  }
} else {
  fullText += chunk;  // Plain text backward compat
}
```

---

## Error Handling

```typescript
import {
  isPolicyBlockedError,
  isPolicyApprovalRequiredError,
  isEvaluationBlockedError,
  GovernanceGateDeniedError,
  type ArelisClient,
  type GenerateInput,
} from '@arelis-ai/ai-governance-sdk';

async function safeGenerate(client: ArelisClient, input: GenerateInput) {
  try {
    return await client.models.generate(input);
  } catch (err) {
    if (isPolicyBlockedError(err)) {
      console.error('Policy blocked:', err.reason, err.policyCode, err.runId);
      return null;
    }
    if (isPolicyApprovalRequiredError(err)) {
      return { needsApproval: true, approvalId: err.approvalId, approvers: err.approvers };
    }
    if (isEvaluationBlockedError(err)) {
      console.error('Evaluation blocked:', err.reason);
      return null;
    }
    if (err instanceof GovernanceGateDeniedError) {
      console.error('Gate denied:', err.decision.reasons);
      return null;
    }
    throw err;
  }
}
```
