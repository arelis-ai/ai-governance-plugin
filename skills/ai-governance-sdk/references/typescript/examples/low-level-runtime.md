# Low-Level Runtime (createArelisClient)

Full composition of the low-level client with model registry, custom policy engine, audit sinks, memory, quotas, prompt templates, and secrets.

> Extracted from the comprehensive TypeScript governance demo. See [setup-and-registration.md](setup-and-registration.md) for initialization.

## Model Registry and Mock Provider

```typescript
import {
  createArelisClient,
  createModelRegistry,
  createMockProvider,
  createPolicyModeEngine,
  createConsoleSink,
  createMemorySink,
  createCompositeSink,
  createMemoryRegistry,
  createInMemoryMemoryProvider,
  createToolRegistry,
  createKBRegistry,
  createMCPRegistry,
  createTemplateRegistry,
  createDataSourceRegistry,
  createInMemoryQuotaManager,
  createEnvSecretResolver,
  scanPromptForPii,
  computePromptHash,
  allowDecision,
  blockDecision,
  transformDecision,
  type PolicyEngine,
  type PolicyInput,
  type PolicyResult,
} from '@arelis-ai/ai-governance-sdk';

const modelRegistry = createModelRegistry();
modelRegistry.register(
  createMockProvider({
    id: 'mock',
    name: 'Mock Model Provider',
    supportedModels: ['mock-model'],
  }),
);
```

## Custom Policy Engine (BeforeToolCall / AfterToolResult)

```typescript
const customPolicyEngine: PolicyEngine = {
  async evaluate(input: PolicyInput): Promise<PolicyResult> {
    const { checkpoint, context, data } = input;

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
          decisions: [blockDecision('High-trust tool requires escalation', 'HIGH_TRUST_BLOCKED')],
          summary: { allowed: false, blockReason: 'Tool requires escalation approval' },
        };
      }
    }

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

const enforcedEngine = createPolicyModeEngine(customPolicyEngine, 'enforce');
```

## Composite Audit Sink

```typescript
const memorySink = createMemorySink();
const auditSink = createCompositeSink([
  createConsoleSink({ pretty: true, timestamp: true }),
  memorySink,
]);
```

## Full createArelisClient Composition

```typescript
const memoryRegistry = createMemoryRegistry();
memoryRegistry.register(createInMemoryMemoryProvider());

const toolRegistry = createToolRegistry({ allowOverwrite: false });
const kbRegistry = createKBRegistry();
const mcpRegistry = createMCPRegistry();
const promptRegistry = createTemplateRegistry();
const dataSourceRegistry = createDataSourceRegistry();

const client = createArelisClient({
  modelRegistry,
  policyEngine: enforcedEngine,
  auditSink,
  memoryRegistry,
  toolRegistry,
  kbRegistry,
  mcpRegistry,
  promptRegistry,
  dataSourceRegistry,
  quotaManager: createInMemoryQuotaManager(),
  secretResolver: createEnvSecretResolver(),
});
```

## Memory CRUD

```typescript
const memEntry = await client.memory.write({
  context: ctx,
  scope: 'conversation',
  key: 'user_preferences',
  value: { theme: 'dark', language: 'en', notifications: true },
  metadata: { ttlMs: 3_600_000 },
});

const readBack = await client.memory.read({ context: ctx, scope: 'conversation', key: 'user_preferences' });
const allConv = await client.memory.list('conversation', ctx);
await client.memory.delete({ context: ctx, scope: 'conversation', key: 'user_preferences' });
```

## Quotas (Check / Commit)

```typescript
const quotaDecision = await client.quotas.check(
  { type: 'user', id: 'user-demo', period: 'day' },
  { tokensIn: 50_000, requestsCount: 1 },
);

await client.quotas.commit(
  { type: 'user', id: 'user-demo', period: 'day' },
  { tokensIn: 48_231, tokensOut: 2_100, requestsCount: 1 },
);
```

## Prompt Templates (Register / Get / Hash)

```typescript
const template = await client.prompts.register({
  id: 'governance-check',
  version: '1.0.0',
  content: 'You are a compliance assistant for {{company}}. Analyze {{regulation}} requirements for {{system}}.',
}, ctx);

const retrieved = client.prompts.get({ id: 'governance-check', version: '1.0.0' });
const hash = computePromptHash(retrieved!.content);
const allTemplates = client.prompts.list('governance-check');
```

## Secrets Resolution

```typescript
try {
  const resolved = await client.secrets.resolve('GEMINI_API_KEY', ctx);
  console.log(`Secret resolved: GEMINI_API_KEY = ${resolved.slice(0, 8)}...`);
} catch {
  console.log('Secret resolution: env-based resolver active');
}
```

**Key patterns:**

- `createArelisClient` accepts all registries as optional; compose only what you need.
- `PolicyEngine.evaluate` receives `{ checkpoint, context, data }` and returns `{ decisions[], summary }`.
- Use `blockDecision()`, `allowDecision()`, `transformDecision()` helpers to build decisions.
- `createPolicyModeEngine(engine, 'enforce')` wraps a custom engine with enforcement mode.
- `createCompositeSink` fans out audit events to multiple sinks (console + memory).
- Memory supports `write`, `read`, `list`, `delete` with scope-based isolation.
- Quotas use `check` before invocation and `commit` after with actual usage.
