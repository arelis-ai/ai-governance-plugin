# Governance Gate

Use `evaluatePreInvocationGate` for direct gate evaluation and `withGovernanceGate` to wrap external LLM calls.

> Extracted from the comprehensive TypeScript governance demo. See [setup-and-registration.md](setup-and-registration.md) for initialization.

## evaluatePreInvocationGate

```typescript
import {
  evaluatePreInvocationGate,
  withGovernanceGate,
  generateRunId,
} from '@arelis-ai/ai-governance-sdk';

const preGate = await evaluatePreInvocationGate(platform, {
  runId: generateRunId(),
  prompt: 'My credit card is 4111-1111-1111-1111',
  model: 'gemini-2.5-flash',
  aiSystemId,
  actor: ctx.actor,
  context: ctx,
});

console.log(`Pre-gate decision: ${preGate.decision}`);
if (preGate.decision === 'deny') {
  console.log(`Reasons: ${JSON.stringify(preGate.reasons)}`);
}
```

## withGovernanceGate Wrapping External Call

```typescript
const gateResult = await withGovernanceGate(
  platform,
  {
    runId: generateRunId(),
    prompt: 'Summarize best practices for AI model monitoring.',
    model: 'gemini-2.5-flash',
    aiSystemId,
    actor: ctx.actor,
    context: ctx,
  },
  async () => {
    // Simulated external LLM call
    return 'Model monitoring requires drift detection, performance metrics, and bias audits.';
  },
  { denyMode: 'return' },
);

console.log(`Gate invoked: ${gateResult.invoked}`);
console.log(`Decision: ${gateResult.decision.decision}`);
console.log(`Timings: total=${gateResult.decision.metadata.timings.totalMs}ms`);
if (gateResult.result) {
  console.log(`Result: "${gateResult.result}"`);
}
for (const warning of gateResult.warnings ?? []) {
  console.warn(`Warning: ${warning}`);
}
```

**Key patterns:**

- `evaluatePreInvocationGate` returns `{ decision, reasons }` without invoking any model.
- `withGovernanceGate` wraps an arbitrary async function; the callback only runs if the gate allows.
- Both accept `aiSystemId` to forward to platform policy evaluation and telemetry.
- Gate telemetry events (`governance.gate.evaluated`, `governance.gate.outcome`) are auto-emitted with `aiSystemId`.
- Use `{ denyMode: 'return' }` to get a result object or `{ denyMode: 'throw' }` to raise `GovernanceGateDeniedError`.
