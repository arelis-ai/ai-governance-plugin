# governedInvoke

Run model inference through the governance gate with automatic PII scanning, policy evaluation, risk scoring, and telemetry.

> Extracted from the comprehensive TypeScript governance demo. See [setup-and-registration.md](setup-and-registration.md) for initialization.

## Blocked Scenario (PII in Prompt)

```typescript
import { GoogleGenAI } from '@google/genai';

const gemini = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
const model = 'gemini-2.5-flash';

// aiSystemId is inherited from createArelis config default
const blockedResult = await arelis.governedInvoke({
  runId: `run-blocked-${crypto.randomUUID()}`,
  model,
  prompt: 'My SSN is 423-91-0482 and my email is john.smith@acmecorp.com. Help file taxes.',
  policyIds: [policyId],
  context: { environment: 'dev', purpose: 'blocked-demo' },
  denyMode: 'return',
  invoke: async (sanitizedPrompt) => {
    const completion = await gemini.models.generateContent({ model, contents: sanitizedPrompt });
    return completion.text ?? '';
  },
});

console.log(`Decision: ${blockedResult.decision.decision} | Invoked: ${blockedResult.invoked}`);
console.log(`PII findings: ${blockedResult.decision.pii.findings.length}`);
console.log(`Timings: scan=${blockedResult.decision.metadata.timings.scanMs}ms, policy=${blockedResult.decision.metadata.timings.policyEvalMs}ms, total=${blockedResult.decision.metadata.timings.totalMs}ms`);
if (blockedResult.warnings?.length) {
  console.log(`Warnings: ${blockedResult.warnings.join(', ')}`);
}
```

## Allowed Scenario (Clean Prompt)

```typescript
const allowedResult = await arelis.governedInvoke({
  runId: `run-allowed-${crypto.randomUUID()}`,
  model,
  prompt: 'Explain three key AI governance controls for regulated industries.',
  policyIds: [policyId],
  context: { environment: 'dev', purpose: 'allowed-demo' },
  denyMode: 'return',
  invoke: async (sanitizedPrompt) => {
    const completion = await gemini.models.generateContent({ model, contents: sanitizedPrompt });
    return completion.text ?? '';
  },
});

console.log(`Decision: ${allowedResult.decision.decision} | Invoked: ${allowedResult.invoked}`);
if (allowedResult.result) {
  console.log(`Response: "${allowedResult.result}"`);
}
if (allowedResult.risk) {
  console.log(`Risk: action=${allowedResult.risk.action}, score=${allowedResult.risk.score}`);
}
```

## Claude Provider with Per-Call aiSystemId Override

```typescript
if (process.env.ANTHROPIC_API_KEY) {
  const anthropicModule = (await import('@anthropic-ai/sdk')) as {
    default: new (input: { apiKey: string }) => {
      messages: {
        create: (input: {
          model: string;
          max_tokens: number;
          messages: Array<{ role: 'user'; content: string }>;
        }) => Promise<{ content: Array<{ type: string; text?: string }> }>;
      };
    };
  };
  const anthropic = new anthropicModule.default({ apiKey: process.env.ANTHROPIC_API_KEY });

  // Per-call aiSystemId override (routes events to a different AI system)
  const claudeResult = await arelis.governedInvoke({
    runId: `run-claude-${crypto.randomUUID()}`,
    model: 'claude-sonnet-4-5-20250929',
    aiSystemId: aiSystemId, // explicit override (same value here, but could differ)
    prompt: 'What are three practical controls to reduce AI agent compliance risk?',
    policyIds: [policyId],
    context: { environment: 'dev', purpose: 'claude-demo' },
    denyMode: 'return',
    invoke: async (sanitizedPrompt) => {
      const message = await anthropic.messages.create({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 300,
        messages: [{ role: 'user', content: sanitizedPrompt }],
      });
      return message.content.find((b) => b.type === 'text')?.text ?? '';
    },
  });

  console.log(`Decision: ${claudeResult.decision.decision} | Invoked: ${claudeResult.invoked}`);
  if (claudeResult.result) console.log(`Response: "${claudeResult.result}"`);
}
```

**Key patterns:**

- `denyMode: 'return'` returns a result object with `invoked: false` on denial; `'throw'` raises `GovernanceGateDeniedError`.
- The `invoke` callback receives the sanitized (PII-redacted) prompt; the original prompt is never forwarded.
- `aiSystemId` from `createArelis` config auto-propagates; pass `aiSystemId` per-call to override.
- Result fields: `invoked`, `decision` (with `pii`, `metadata.timings`), `result`, `risk`, `warnings`.
- The SDK auto-emits telemetry events (`governance.gate.evaluated`, `model.request`, `model.response`) with `aiSystemId`.
