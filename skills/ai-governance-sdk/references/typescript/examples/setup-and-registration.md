# Setup and AI System Registration

Bootstrap the Arelis platform, register an AI system idempotently, and create the unified orchestrator with a default `aiSystemId`.

> Extracted from the comprehensive TypeScript governance demo. See [setup-and-registration.md](setup-and-registration.md) for initialization.

## Imports

```typescript
import {
  createArelis,
  scanPromptForPii,
  ArelisPlatform,
  type GovernanceContext,
} from '@arelis-ai/ai-governance-sdk';
```

## Governance Context

```typescript
const ctx: GovernanceContext = {
  org: { id: 'org-demo', name: 'Governance Demo Org' },
  actor: { type: 'human', id: 'user-demo', email: 'demo@example.com', roles: ['developer'] },
  purpose: 'comprehensive-demo',
  environment: 'dev',
  sessionId: `session-${Date.now()}`,
  tags: { demo: 'comprehensive' },
};
```

## AI System Registration (Idempotent)

```typescript
const MODEL_ID = 'gemini-2.5-flash';
const bootstrapPlatform = new ArelisPlatform({
  apiKey: process.env.ARELIS_API_KEY!,
  ...(process.env.ARELIS_API_URL ? { baseUrl: process.env.ARELIS_API_URL } : {}),
});

let aiSystemId: string;

const { data: existing } = await bootstrapPlatform.aiSystems.list({ type: 'model' });
const match = existing.find((s) => s.modelRef === MODEL_ID && s.status === 'active');

if (match) {
  aiSystemId = match.id;
} else {
  const record = await bootstrapPlatform.aiSystems.register({
    name: MODEL_ID,
    type: 'model',
    provider: 'google',
    modelRef: MODEL_ID,
    description: `Governance demo model: ${MODEL_ID}`,
    metadata: { registeredAt: new Date().toISOString() },
    tags: ['demo', 'comprehensive'],
  });
  aiSystemId = record.id;
}
```

## Create Unified Orchestrator

```typescript
const arelis = createArelis({
  platform: {
    apiKey: process.env.ARELIS_API_KEY!,
    ...(process.env.ARELIS_API_URL ? { baseUrl: process.env.ARELIS_API_URL } : {}),
    maxRetries: 3,
    timeout: 30_000,
  },
  aiSystemId,
});

const platform = arelis.platform!;
```

## Fetch System Summary

```typescript
const summary = await platform.aiSystems.summary(aiSystemId).catch(() => null);
if (summary) {
  console.log(`System summary: ${summary.events.total} events, ${summary.proofs.total} proofs`);
}
```

## Managed PII Config Retrieval

```typescript
const managedConfig = await arelis.governance.getPiiConfig({ namespace: 'pii.default' });

const sensitivePrompt = 'My email is jane@acme.com, SSN 123-45-6789, call me at 555-867-5309';
const scan = scanPromptForPii(sensitivePrompt, { redactorConfig: managedConfig });

console.log(`PII detected: ${scan.hasPii}`);
for (const finding of scan.findings) {
  console.log(`  - ${finding.pattern ?? finding.type}: "${finding.original}"`);
}
```

**Key patterns:**

- Use `ArelisPlatform` directly for bootstrap registration before creating the orchestrator.
- AI system registration is idempotent: list first, match by `modelRef` + `status`, only register if missing.
- Pass `aiSystemId` at `createArelis` config level so it auto-propagates to all SDK operations.
- `arelis.platform!` gives access to the underlying platform client for direct API calls.
- Managed PII config is fetched from the platform via `arelis.governance.getPiiConfig` and passed to `scanPromptForPii`.
