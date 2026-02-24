# AI Governance SDK — State Patterns

Memory, data sources, quotas, secrets, prompts, audit sinks, OpenTelemetry, and compliance.

---

## Table of Contents

- [Memory Operations](#memory-operations)
- [Data Source Registration & Read](#data-source-registration--read)
- [Quota Enforcement](#quota-enforcement)
- [Secrets Resolution](#secrets-resolution)
- [Prompt Templates](#prompt-templates)
- [Composite Audit Sink](#composite-audit-sink)
- [OpenTelemetry](#opentelemetry)
- [Compliance Artifact & Replay](#compliance-artifact--replay)

---

## Memory Operations

```typescript
import { createMemoryRegistry, createInMemoryMemoryProvider } from '@arelis-ai/ai-governance-sdk';

const memoryRegistry = createMemoryRegistry();
memoryRegistry.register(createInMemoryMemoryProvider());

const client = createArelisClient({
  modelRegistry,
  policyEngine: createAllowAllEngine(),
  auditSink: createConsoleSink(),
  memoryRegistry,
});

// Write
const entry = await client.memory.write({
  context: ctx,
  scope: 'conversation',
  key: 'user_preferences',
  value: { theme: 'dark', language: 'en' },
  metadata: { ttlMs: 3_600_000 },
});

// Read
const stored = await client.memory.read({ context: ctx, scope: 'conversation', key: 'user_preferences' });
console.log(stored?.value);

// List all in scope
const all = await client.memory.list('conversation', ctx);

// Delete
await client.memory.delete({ context: ctx, scope: 'conversation', key: 'user_preferences' });
```

---

## Data Source Registration & Read

```typescript
import { createDataSourceRegistry } from '@arelis-ai/ai-governance-sdk';

const dataSourceRegistry = createDataSourceRegistry();

const client = createArelisClient({
  modelRegistry,
  policyEngine: createAllowAllEngine(),
  auditSink: createConsoleSink(),
  dataSourceRegistry,
});

// Register
await client.dataSources.register({
  descriptor: { id: 'crm', name: 'CRM', type: 'postgres', governance: { dataClass: 'confidential' } },
  provider: {
    async read(query, context) {
      return { data: [{ id: 1, name: 'Acme' }], metadata: { rowCount: 1 } };
    },
  },
});

// Read
const result = await client.dataSources.read({
  sourceId: 'crm',
  query: 'SELECT id, name FROM accounts LIMIT 10',
  context: ctx,
});
console.log(result.data);
```

---

## Quota Enforcement

```typescript
import { createInMemoryQuotaManager } from '@arelis-ai/ai-governance-sdk';

const client = createArelisClient({
  modelRegistry,
  policyEngine: createAllowAllEngine(),
  auditSink: createConsoleSink(),
  quotaManager: createInMemoryQuotaManager(),
});

// Check before expensive operation
const decision = await client.quotas.check(
  { type: 'org', id: 'org_123', period: 'day' },
  { tokensIn: 50_000, requestsCount: 1 },
);
// Use effect, not .allowed — createInMemoryQuotaManager does not set `allowed`
if (decision.effect === 'block') throw new Error('Quota exceeded');

// Commit actual usage after
await client.quotas.commit(
  { type: 'org', id: 'org_123', period: 'day' },
  { tokensIn: 48_231, tokensOut: 2_100, requestsCount: 1 },
);
```

---

## Secrets Resolution

```typescript
import { createEnvSecretResolver } from '@arelis-ai/ai-governance-sdk';

const client = createArelisClient({
  modelRegistry,
  policyEngine: createAllowAllEngine(),
  auditSink: createConsoleSink(),
  secretResolver: createEnvSecretResolver(),
});

const apiKey = await client.secrets.resolve('OPENAI_API_KEY', ctx);
```

---

## Prompt Templates

```typescript
import { createTemplateRegistry, computePromptHash } from '@arelis-ai/ai-governance-sdk';

const promptRegistry = createTemplateRegistry();

const client = createArelisClient({
  modelRegistry,
  policyEngine: createAllowAllEngine(),
  auditSink: createConsoleSink(),
  promptRegistry,
});

const template = await client.prompts.register({
  id: 'customer-greeting',
  version: '1.0.0',
  content: 'You are a friendly agent for {{company}}. Help {{customerName}}: {{question}}',
}, ctx);

const retrieved = client.prompts.get({ id: 'customer-greeting', version: '1.0.0' });
const hash = computePromptHash(retrieved!.content);
const allVersions = client.prompts.list('customer-greeting');
```

---

## Composite Audit Sink

```typescript
import { createCompositeSink, createConsoleSink, createMemorySink } from '@arelis-ai/ai-governance-sdk';

const memorySink = createMemorySink();

const client = createArelisClient({
  modelRegistry,
  policyEngine: createAllowAllEngine(),
  auditSink: createCompositeSink([   // <- array, not spread args
    createConsoleSink({ pretty: true }),
    memorySink,
    {
      async write(event) {
        await fetch('https://audit.acme.com/events', {
          method: 'POST',
          body: JSON.stringify(event),
          headers: { 'Content-Type': 'application/json' },
        });
      },
    },
  ]),
});

// Inspect events after operations
console.log(memorySink.events.filter(e => e.type === 'run.started'));
```

---

## OpenTelemetry

```typescript
import { createOTelAdapter } from '@arelis-ai/ai-governance-sdk';
import { trace, metrics } from '@opentelemetry/api';

const client = createArelisClient({
  modelRegistry,
  policyEngine: createAllowAllEngine(),
  auditSink: createConsoleSink(),
  telemetry: createOTelAdapter({
    tracer: trace.getTracer('arelis-sdk'),
    meter: metrics.getMeter('arelis-sdk'),
    prefix: 'arelis',
  }),
});
```

---

## Compliance Artifact & Replay

```typescript
// Request compliance artifact
const artifact = await client.compliance.requestArtifact({ runId: 'run_01HXYZ...' });

// List artifacts for a run
const artifacts = await client.compliance.getArtifacts('run_01HXYZ...');

// Verify artifact
const verification = await client.compliance.verifyArtifact({ artifact });
console.log(verification.verified, verification.evidence);

// Replay a run
const replay = await client.compliance.replayRun({ runId: 'run_01HXYZ...' });
console.log(replay.driftDetected, replay.driftDiagnostics);

// Standalone audit replay (no client needed)
import { replayAuditRun, traverseLineage } from '@arelis-ai/ai-governance-sdk';

const replayResult = await replayAuditRun({
  runId: 'run_01HXYZ...',
  events: storedAuditEvents,
  resolveData: async (ref) => fetchBlobFromStorage(ref),
});

const lineage = traverseLineage(targetEvent, allEvents);
```
