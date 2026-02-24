# AI Governance SDK — API Reference: Core

All imports from the umbrella package:

```typescript
import { ... } from '@arelis-ai/ai-governance-sdk';
```

---

## Table of Contents

- [Package Installation](#package-installation)
- [createArelis (Unified Orchestrator)](#createarelis-unified-factory)
- [Unified Orchestration Types](#unified-orchestration)
- [GovernanceContext](#governancecontext)

---

## Package Installation

```bash
npm install @arelis-ai/ai-governance-sdk
```

---

## Client Creation

### createArelis (unified factory)

```typescript
function createArelis(config: CreateArelisConfig): ArelisInstance

type CreateArelisConfig = {
  runtime?: ClientConfig;
  platform?: ArelisPlatformConfig;
};

type ArelisInstance = {
  runtime?: ArelisClient;
  platform?: ArelisPlatform;
  governedInvoke<T>(input: GovernedInvokeInput<T>): Promise<GovernedInvokeResult<T>>;
  agents: {
    run<T = unknown>(input: GovernedAgentRunInput<T>): Promise<GovernedAgentRunResult<T>>;
  };
  governance: {
    getPiiConfig(input?: { namespace?: string }): Promise<ManagedPiiConfig>;
  };
};
```

### Version Guidance

- `createArelis` is the recommended TypeScript entrypoint for SDK `1.2.1+`
- Keep `createArelisClient` for advanced low-level runtime composition and legacy integrations

---

## Unified Orchestration

```typescript
type ManagedPiiConfig = {
  detectEmails?: boolean;
  detectPhones?: boolean;
  detectApiKeys?: boolean;
  customPatterns?: Array<{ name: string; type?: string; pattern: RegExp }>;
};

type GovernedInvokeInput<T> = {
  runId?: string;
  model: string;
  prompt: string;
  policyIds?: string[];
  context?: GovernanceContext | Partial<GovernanceContext>;
  denyMode?: 'throw' | 'return';
  invoke: (sanitizedPrompt: string) => Promise<T>;
};

type GovernedInvokeResult<T> = {
  runId: string;
  invoked: boolean;
  decision: {
    decision: 'allow' | 'deny';
    pii: PromptPiiScanResult;
    metadata: { timings: { scanMs: number; policyEvalMs: number; totalMs: number } };
  };
  result?: T;
  risk?: { action: string; score: number };
  warnings?: string[]; // non-fatal side-effect failures
};

type GovernedAgentRunInput<T> = {
  runId?: string;
  model: string;
  prompt: string;
  tools?: GovernedAgentTool[];
  policyIds?: string[];
  context?: GovernanceContext | Partial<GovernanceContext>;
  maxSteps?: number;
  invokeModel: (input: { model: string; messages: AgentConversationMessage[] }) => Promise<AgentModelResponse>;
  executeToolCall: (input: { tool: { id: string; name: string; args: Record<string, unknown> } }) => Promise<unknown>;
  mapOutput?: (input: { finalResponse: AgentModelResponse; steps: GovernedAgentStep[] }) => T;
};

type GovernedAgentRunResult<T> = {
  runId: string;
  status: string;
  output?: T;
  decision: { decision: 'allow' | 'deny'; metadata?: { timings?: { scanMs: number; policyEvalMs: number; totalMs: number } } };
  steps: GovernedAgentStep[];
  events: Array<Record<string, unknown>>;
  graph: { nodes: Array<Record<string, unknown>>; edges: Array<Record<string, unknown>> };
  platformEvents?: Array<Record<string, unknown>>;
  proof?: Record<string, unknown>;
  risk?: { action: string; score: number };
  warnings?: string[]; // non-fatal side-effect failures
};
```

### GovernedAgentTool

```typescript
type GovernedAgentTool = {
  name: string;
  description: string;
  schema: Record<string, unknown>;
};
```

### GovernanceContext

```typescript
type GovernanceContext = {
  org: { id: string; name: string };
  actor: { type: string; id: string; roles?: string[] };
  purpose: string;
  environment: 'prod' | 'dev' | 'staging' | 'test';
  sessionId?: string;
  tags?: Record<string, string>;
};
```
