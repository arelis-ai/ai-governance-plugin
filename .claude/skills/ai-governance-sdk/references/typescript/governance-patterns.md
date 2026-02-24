# AI Governance SDK — Governance Patterns

Governance gates, policy engines, custom policy checkpoint evaluation, and error handling.

---

## Table of Contents

- [Pre-Invocation Governance Gate](#pre-invocation-governance-gate-pii--platform-policy)
- [Custom Policy Checkpoint Evaluation](#custom-policy-checkpoint-evaluation-no-clientpolicy)
- [Governance Gate Helpers (Standalone)](#governance-gate-helpers-standalone)
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
