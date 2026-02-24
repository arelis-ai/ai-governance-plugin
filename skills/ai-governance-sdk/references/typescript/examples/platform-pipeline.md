# Platform Pipeline

Manual platform operations: events, policy evaluation, risk scoring, compliance proofs, and causal graphs.

> Extracted from the comprehensive TypeScript governance demo. See [setup-and-registration.md](setup-and-registration.md) for initialization.

## Platform Events (Create + Batch Pattern)

```typescript
const runId = `run-pipeline-${crypto.randomUUID()}`;
const actorId = 'user-demo';

// Batch multiple event creation calls with Promise.all
await Promise.all([
  platform.events.create({
    runId, aiSystemId,
    eventType: 'model.invoked',
    actor: { type: 'human', id: actorId },
    resource: { type: 'model', id: 'gemini-2.5-flash' },
    action: 'inference',
    timestamp: new Date().toISOString(),
    metadata: { responseLength: 512, sessionId: ctx.sessionId, purpose: ctx.purpose, environment: ctx.environment },
  }),
  platform.events.create({
    runId, aiSystemId,
    eventType: 'policy.evaluated',
    actor: { type: 'human', id: actorId },
    resource: { type: 'model', id: 'gemini-2.5-flash' },
    action: 'evaluate',
    timestamp: new Date().toISOString(),
    metadata: { checkpoints: ['BeforePrompt', 'AfterModelOutput'], decisionsCount: 2, enforcementMode: 'enforce', pii_detected: false },
  }),
  // Additional event types: 'output.delivered', 'governance.gate.evaluated', etc.
]).catch((err) => console.error('[Arelis] Failed to emit events:', err));
```

## Platform Policy Evaluation (evaluatePolicy)

```typescript
// PII scenario — aiSystemId forwarded; compatibility fallback retries without it on HTTP 400
const policyEvalPii = await platform.governance.evaluatePolicy({
  runId,
  aiSystemId,
  checkpoint: {
    content: { pii_detected: true, pii_types: ['ssn', 'email'], pii_count: 2 },
  },
}).catch((err) => {
  console.error('[Arelis] evaluatePolicy (PII) failed:', err);
  return null;
});

if (policyEvalPii) {
  for (const d of policyEvalPii.decisions ?? []) {
    const decision = (d as { decision: string }).decision;
    const name = (d as { metadata?: { policyName?: string } }).metadata?.policyName ?? (d as { policyId: string }).policyId;
    console.log(`  - ${decision} (${name})`);
  }
}

// Clean scenario
const policyEvalClean = await platform.governance.evaluatePolicy({
  runId: `${runId}-clean`,
  aiSystemId,
  checkpoint: {
    content: { pii_detected: false, pii_types: [], pii_count: 0 },
  },
});
```

## Risk Evaluation (Low / Medium / High)

```typescript
const riskScenarios = [
  {
    label: 'Low risk',
    runId: `${runId}-low`,
    quotaState: { usageRatio: 0.1 },
    evaluationSignals: [{ name: 'output_check', value: 0.01, severity: 'low' as const }],
    explicitSignals: { surface: 'model', outcome: 'allowed' },
  },
  {
    label: 'Medium risk',
    runId: `${runId}-med`,
    quotaState: { usageRatio: 0.75 },
    evaluationSignals: [
      { name: 'pii_detected', value: 1, severity: 'high' as const },
      { name: 'toxicity_score', value: 0.6, severity: 'medium' as const },
    ],
    explicitSignals: { surface: 'model', outcome: 'blocked' },
  },
  {
    label: 'High risk',
    runId: `${runId}-high`,
    quotaState: { usageRatio: 0.95 },
    evaluationSignals: [
      { name: 'pii_detected', value: 1, severity: 'high' as const },
      { name: 'credential_leak', value: 1, severity: 'high' as const },
      { name: 'toxicity_score', value: 0.92, severity: 'high' as const },
      { name: 'prompt_injection', value: 0.95, severity: 'high' as const },
    ],
    explicitSignals: { surface: 'model', outcome: 'blocked', environment: 'prod' },
  },
];

for (const scenario of riskScenarios) {
  const riskResult = await platform.risk.evaluate({
    runId: scenario.runId,
    aiSystemId,
    policyDecisions: [],
    quotaState: scenario.quotaState,
    evaluationSignals: scenario.evaluationSignals,
    explicitSignals: scenario.explicitSignals,
  }).catch((err) => {
    console.warn(`[Arelis] risk.evaluate (${scenario.label}): ${err instanceof Error ? err.message : String(err)}`);
    return null;
  });

  if (riskResult) {
    console.log(`${scenario.label}: action=${riskResult.action}, score=${riskResult.score}`);
  }
}
```

## Compliance Proof (Create + Verify)

```typescript
const proof = await platform.proofs.create({
  runId,
  aiSystemId,
  schemaVersion: 'v1',
}).catch((err) => {
  console.error('[Arelis] proofs.create failed:', err);
  return null;
});

if (proof) {
  const proofId = 'proofId' in proof ? proof.proofId : 'jobId' in proof ? proof.jobId : null;

  if (proofId && 'proofId' in proof) {
    const verification = await platform.proofs.verify({ proofId }).catch(() => null);
    if (verification) {
      console.log(`Proof verified: ${verification.verified}`);
    }
  }
}
```

## Causal Graph (startCausalGraph + commit)

```typescript
const graphEvents = [
  { eventId: `${runId}-policy-evaluated`, eventType: 'policy.evaluated', action: 'evaluate' },
  { eventId: `${runId}-model-invoked`, eventType: 'model.invoked', action: 'inference' },
  { eventId: `${runId}-output-delivered`, eventType: 'output.delivered', action: 'deliver' },
];

const nodes = graphEvents.map((ev) => ({
  id: ev.eventId,
  type: ev.eventType,
  data: { action: ev.action, timestamp: new Date().toISOString() } as Record<string, unknown>,
}));

const edges: { source: string; target: string; type: string }[] = [];
for (let i = 1; i < graphEvents.length; i++) {
  edges.push({
    source: graphEvents[i - 1].eventId,
    target: graphEvents[i].eventId,
    type: 'sequence',
  });
}

// CRITICAL: startCausalGraph BEFORE commit
await platform.replay.startCausalGraph({ runId, nodes, edges });

// Seal the graph (MUST be last)
const commitResult = await platform.graphs.commit(runId);
if (commitResult) {
  console.log(`Graph committed: rootHash=${commitResult.rootHash?.slice(0, 16)}...`);
}
```

**Key patterns:**

- Use `Promise.all` to batch independent event creation calls for performance.
- Every event requires `runId`, `aiSystemId`, `eventType`, `actor`, `resource`, `action`, and `timestamp`.
- `evaluatePolicy` accepts `checkpoint.content` with arbitrary fields matched against policy conditions.
- Risk evaluation uses `evaluationSignals` (with `severity`) and `quotaState` (with `usageRatio`) to compute scores.
- Proof creation requires `runId`, `aiSystemId`, and `schemaVersion`; verify with the returned `proofId`.
- Causal graph: call `startCausalGraph` with nodes/edges first, then `graphs.commit(runId)` to seal it.
