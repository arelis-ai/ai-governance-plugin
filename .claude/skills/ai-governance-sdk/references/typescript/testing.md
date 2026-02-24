# AI Governance SDK — Testing Patterns

Testing with mock providers and in-memory audit sinks.

---

## Table of Contents

- [Test Setup with Mock Provider](#test-setup-with-mock-provider)
- [Asserting Audit Events](#asserting-audit-events)
- [Testing Policy Blocks](#testing-policy-blocks)

---

## Test Setup with Mock Provider

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import {
  createArelisClient,
  createModelRegistry,
  createMockProvider,
  createAllowAllEngine,
  createMemorySink,
  type ArelisClient,
} from '@arelis-ai/ai-governance-sdk';

describe('MyFeature', () => {
  let client: ArelisClient;
  let auditSink: ReturnType<typeof createMemorySink>;

  const testCtx = {
    org: { id: 'test-org' },
    actor: { type: 'human' as const, id: 'u1' },
    purpose: 'test',
    environment: 'dev' as const,
  };

  beforeEach(() => {
    auditSink = createMemorySink();
    const modelRegistry = createModelRegistry();
    modelRegistry.register(createMockProvider({ supportedModels: ['mock-model'] }));

    client = createArelisClient({
      modelRegistry,
      policyEngine: createAllowAllEngine(),
      auditSink,
    });
  });
```

---

## Asserting Audit Events

```typescript
  it('emits lifecycle audit events', async () => {
    await client.models.generate({
      model: 'mock-model',
      request: { model: 'mock-model', messages: [{ role: 'user', content: 'test' }], context: testCtx },
      context: testCtx,
    });

    const types = auditSink.events.map(e => e.type);
    expect(types).toContain('run.started');
    expect(types).toContain('run.ended');
    expect(types).toContain('model.request');
    expect(types).toContain('model.response');
  });
```

---

## Testing Policy Blocks

```typescript
  it('blocks when policy denies', async () => {
    const blockedClient = createArelisClient({
      modelRegistry: client.models, // reuse registry
      policyEngine: createDenyAllEngine(),
      auditSink,
    });

    await expect(blockedClient.models.generate({
      model: 'mock-model',
      request: { model: 'mock-model', messages: [{ role: 'user', content: 'blocked' }], context: testCtx },
      context: testCtx,
    })).rejects.toThrow();
  });
});
```
