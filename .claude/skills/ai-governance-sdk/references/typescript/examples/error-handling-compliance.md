# Error Handling and Compliance

Error type guards, governance gate errors, and audit replay for compliance artifacts.

> Extracted from the comprehensive TypeScript governance demo. See [setup-and-registration.md](setup-and-registration.md) for initialization.

## PolicyBlockedError with createDenyAllEngine

```typescript
import {
  createArelisClient,
  createModelRegistry,
  createMockProvider,
  createDenyAllEngine,
  createMemorySink,
  isPolicyBlockedError,
  isPolicyApprovalRequiredError,
  isEvaluationBlockedError,
  GovernanceGateDeniedError,
  createArelis,
  generateRunId,
  replayAuditRun,
} from '@arelis-ai/ai-governance-sdk';

const modelRegistry = createModelRegistry();
modelRegistry.register(createMockProvider({ supportedModels: ['mock-model'] }));

const blockedClient = createArelisClient({
  modelRegistry,
  policyEngine: createDenyAllEngine(),
  auditSink: createMemorySink(),
});

try {
  await blockedClient.models.generate({
    model: 'mock-model',
    request: { model: 'mock-model', messages: [{ role: 'user', content: 'test' }], context: ctx },
    context: ctx,
  });
} catch (err) {
  if (isPolicyBlockedError(err)) {
    console.log(`PolicyBlockedError caught: reason="${(err as { reason?: string }).reason}", code="${(err as { policyCode?: string }).policyCode}"`);
  }
}
```

## GovernanceGateDeniedError with governedInvoke

```typescript
try {
  const arelis = createArelis({
    platform: {
      apiKey: process.env.ARELIS_API_KEY!,
      ...(process.env.ARELIS_API_URL ? { baseUrl: process.env.ARELIS_API_URL } : {}),
    },
  });

  await arelis.governedInvoke({
    runId: generateRunId(),
    model: 'gemini-2.5-flash',
    prompt: 'SSN: 123-45-6789, email: test@test.com',
    denyMode: 'throw',
    invoke: async () => 'should not reach here',
  });
} catch (err) {
  if (err instanceof GovernanceGateDeniedError) {
    console.log(`GovernanceGateDeniedError caught: decision=${err.decision}`);
  }
}
```

## isPolicyApprovalRequiredError Guard

```typescript
// Type guard for approval-required errors
console.log('isPolicyApprovalRequiredError available:', typeof isPolicyApprovalRequiredError === 'function');

// Usage pattern:
// try { ... } catch (err) {
//   if (isPolicyApprovalRequiredError(err)) {
//     // handle approval flow (see low-level-runtime-advanced.md approval workflow)
//   }
// }
```

## replayAuditRun for Compliance Artifact

```typescript
const memorySink = createMemorySink();
// ... after running operations that populate the memory sink ...

const events = memorySink.events;
const eventTypes = [...new Set(events.map((e) => e.type))];

if (events.length > 0) {
  const firstRunEvent = events.find((e) => e.runId);
  if (firstRunEvent) {
    const runEvents = events.filter((e) => e.runId === firstRunEvent.runId);

    try {
      const replayResult = await replayAuditRun({
        runId: firstRunEvent.runId!,
        events: runEvents as any,
        resolveData: async () => 'resolved-data',
      });
      console.log(`Replay drift detected: ${replayResult.driftDetected}`);
    } catch (err) {
      console.log(`Replay: ${err instanceof Error ? err.message : 'completed with notes'}`);
    }
  }
}
```

**Key patterns:**

- Use `isPolicyBlockedError(err)` type guard instead of `instanceof` for reliable error detection.
- `createDenyAllEngine()` blocks all requests; useful for testing error handling paths.
- `denyMode: 'throw'` on `governedInvoke` raises `GovernanceGateDeniedError` with a `decision` property.
- `isPolicyApprovalRequiredError` and `isEvaluationBlockedError` are companion guards for other error types.
- `replayAuditRun` replays a run from memory sink events to detect drift; `resolveData` provides external data resolution.
- `createMemorySink()` captures all audit events in-memory for replay and inspection.
