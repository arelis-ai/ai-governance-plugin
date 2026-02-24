# PII Scanning and Policy Creation

Local PII scanning with managed config and idempotent policy upsert on the platform.

> Extracted from the comprehensive TypeScript governance demo. See [setup-and-registration.md](setup-and-registration.md) for initialization.

## PII Scanning with Managed Config

```typescript
import { scanPromptForPii, ArelisPlatform } from '@arelis-ai/ai-governance-sdk';

// Fetch managed PII config from platform
const managedConfig = await arelis.governance.getPiiConfig({ namespace: 'pii.default' });

// Scan a sensitive prompt
const sensitivePrompt = 'My email is jane@acme.com, SSN 123-45-6789, call me at 555-867-5309';
const scan = scanPromptForPii(sensitivePrompt, { redactorConfig: managedConfig });

console.log(`PII detected: ${scan.hasPii}`);
console.log(`Findings (${scan.findings.length}):`);
for (const finding of scan.findings) {
  console.log(`  - ${finding.pattern ?? finding.type}: "${finding.original}"`);
}
```

## Clean Prompt Scan

```typescript
const cleanPrompt = 'Explain the EU AI Act risk categories.';
const cleanScan = scanPromptForPii(cleanPrompt);
console.log(`Clean prompt PII: ${cleanScan.hasPii} (findings: ${cleanScan.findings.length})`);
```

## Policy Creation with Idempotent Upsert

```typescript
async function ensurePolicy(platform: ArelisPlatform): Promise<string> {
  const policyKey = 'pii-deny-before-invocation';
  const listed = await platform.governance.policies.list({ search: policyKey });
  const existing = listed.data.find((p) => p.key === policyKey);

  if (existing) {
    console.log(`Policy already exists: ${existing.id} (key: ${policyKey})`);
    return existing.id;
  }

  const created = await platform.governance.policies.create({
    key: policyKey,
    name: 'PII Deny Before Model Invocation',
    description: 'Blocks model invocation when prompt-level PII is detected.',
    condition: { field: 'content.pii_detected', operator: 'eq', value: true },
    action: 'deny',
    severity: 'critical',
    priority: 1,
  });

  console.log(`Policy created: ${created.id}`);
  return created.id;
}
```

**Key patterns:**

- `scanPromptForPii` works locally with no network call; pass `redactorConfig` from managed config for consistent rules.
- The scan result exposes `hasPii`, `findings[]`, and each finding has `pattern`, `type`, and `original`.
- Policy upsert: list by `search: policyKey`, match on `p.key`, only create if not found.
- `condition` uses `{ field, operator, value }` format; `field: 'content.pii_detected'` matches the checkpoint payload.
- `severity` and `priority` control enforcement ordering; `'critical'` + `priority: 1` ensures this policy runs first.
