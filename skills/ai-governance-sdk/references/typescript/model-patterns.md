# AI Governance SDK — Model Patterns

Basic model calls, streaming, and structured output validation.

---

## Table of Contents

- [Platform-First governedInvoke](#platform-first-governedinvoke)
- [Basic Model Call](#basic-model-call)
- [Streaming](#streaming)
- [Structured Output Validation](#structured-output-validation)

---

## Platform-First governedInvoke

For SDK `1.2.1+`, prefer `createArelis(...).governedInvoke(...)` when you want pre-invocation gate + platform reporting in one call:

```typescript
import { createArelis } from '@arelis-ai/ai-governance-sdk';

const arelis = createArelis({
  platform: {
    apiKey: process.env.ARELIS_API_KEY!,
    ...(process.env.ARELIS_API_URL ? { baseUrl: process.env.ARELIS_API_URL } : {}),
  },
});

const result = await arelis.governedInvoke({
  runId: `run-${crypto.randomUUID()}`,
  model: 'gemini-2.5-flash',
  prompt: 'Summarize AI governance controls in two bullets.',
  denyMode: 'return',
  invoke: async (sanitizedPrompt) => callModel(sanitizedPrompt),
});

console.log(result.decision.metadata.timings.totalMs);
for (const warning of result.warnings ?? []) {
  console.warn(warning);
}
```

---

## Basic Model Call

```typescript
import {
  createArelisClient,
  createModelRegistry,
  createMockProvider,
  createAllowAllEngine,
  createConsoleSink,
  generateRunId,
  type GovernanceContext,
} from '@arelis-ai/ai-governance-sdk';

const modelRegistry = createModelRegistry();
modelRegistry.register(createMockProvider({
  id: 'mock',
  name: 'Mock Model Provider',
  supportedModels: ['mock-model'],
}));

const ctx: GovernanceContext = {
  org: { id: 'org-123', name: 'Example Org' },
  actor: { type: 'human', id: 'user-456', email: 'user@example.com', roles: ['developer'] },
  purpose: 'example-demonstration',
  environment: 'dev',
  sessionId: 'session-789',
};

const client = createArelisClient({
  modelRegistry,
  policyEngine: createAllowAllEngine(),
  auditSink: createConsoleSink({ pretty: true, timestamp: true }),
});

const result = await client.models.generate({
  model: 'mock-model',
  request: {
    model: 'mock-model',
    messages: [{ role: 'user', content: 'Hello, AI!' }],
    context: ctx,
    config: { maxTokens: 100, temperature: 0.7 },
  },
  context: ctx,
});

console.log('Run ID:', result.runId);
console.log('Output:', result.output.content);
```

---

## Streaming

```typescript
const { runId, stream } = await client.models.generateStream({
  model: 'mock-model',
  request: {
    model: 'mock-model',
    messages: [{ role: 'user', content: 'Stream this response' }],
    context: ctx,
  },
  context: ctx,
  streamOptions: { emitChunks: false },
});

let output = '';
for await (const chunk of stream) {
  if (chunk.type === 'content' && chunk.content) {
    output += chunk.content;
    process.stdout.write(chunk.content);
  }
}
console.log('\nRun ID:', runId);
```

---

## Structured Output Validation

```typescript
const result = await client.models.generate({
  model: 'mock-model',
  request: {
    model: 'mock-model',
    messages: [{ role: 'user', content: 'Extract entities as JSON' }],
    context: ctx,
  },
  context: ctx,
  outputSchema: {
    type: 'jsonSchema',
    schema: {
      type: 'object',
      required: ['entities', 'sentiment'],
      properties: {
        entities: {
          type: 'array',
          items: { type: 'object', properties: { name: { type: 'string' }, type: { type: 'string' } } },
        },
        sentiment: { type: 'string', enum: ['positive', 'negative', 'neutral'] },
      },
    },
  },
  outputValidationMode: 'block',  // throws if output doesn't match schema
});

const content = typeof result.output.content === 'string'
  ? result.output.content
  : JSON.stringify(result.output.content);
const parsed = JSON.parse(content);
```
