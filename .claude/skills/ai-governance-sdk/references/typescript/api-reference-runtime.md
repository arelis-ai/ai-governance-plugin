# AI Governance SDK — API Reference: Runtime

All imports from the umbrella package:

```typescript
import { ... } from '@arelis-ai/ai-governance-sdk';
```

---

## Table of Contents

- [createArelisClient](#createarelisclient)
- [ArelisClient Full Interface](#arelisclient-full-interface)
- [Core Input Types](#core-input-types)
- [Registry Factories](#registry-factories)
- [Model Provider](#model-provider)
- [Policy Engine](#policy-engine)
- [Audit Sink](#audit-sink)
- [Telemetry](#telemetry)
- [DataRef Utilities](#dataref-utilities)

---

## createArelisClient

```typescript
function createArelisClient(config: ClientConfig): ArelisClient

type ClientConfig = {
  modelRegistry: ModelRegistry;           // required
  policyEngine: PolicyEngine;             // required
  auditSink: AuditSink;                   // required
  telemetry?: Telemetry;
  contextResolver?: ContextResolver;
  toolRegistry?: ToolRegistry;
  mcpRegistry?: MCPRegistry;
  kbRegistry?: KBRegistry;
  promptRegistry?: TemplateRegistry;
  memoryRegistry?: MemoryRegistry;
  dataSourceRegistry?: DataSourceRegistry;
  quotaManager?: QuotaManager;
  evaluators?: Evaluator[];
  approvalStore?: ApprovalStore;
  secretResolver?: SecretResolver;
  redactor?: Redactor;
  policyCompilation?: PolicyCompilationConfig;
  compliance?: ComplianceConfig;
  extensions?: ClientExtensionsConfig;
};
```

---

## ArelisClient Full Interface

```typescript
interface ArelisClient {
  models: {
    generate(input: GenerateInput): Promise<ResultEnvelope<ModelResponse>>;
    generateStream(input: GenerateStreamInput): Promise<{ runId: string; stream: AsyncIterable<StreamChunk> }>;
  };

  agents: {
    run<T = unknown>(input: AgentRunInput): Promise<AgentResult<T>>;
  };

  knowledge: {
    registerKB(input: RegisterKBInput): Promise<void>;
    retrieve(input: RetrieveInput): Promise<RetrievalResult>;
    getRegistry(): KBRegistry;
  };

  mcp: {
    registerServer(input: RegisterMCPServerInput): Promise<ToolDiscoveryFullResult>;
    discoverTools(input: DiscoverMCPToolsInput): Promise<ToolDiscoveryFullResult>;
    getRegistry(): MCPRegistry;
  };

  memory: {
    read(input: MemoryReadInput): Promise<MemoryEntry | undefined>;
    write(input: MemoryWriteInput): Promise<MemoryEntry>;
    delete(input: MemoryDeleteInput): Promise<boolean>;
    list(scope: MemoryScope, context: GovernanceContext | Partial<GovernanceContext>): Promise<MemoryEntry[]>;
  };

  dataSources: {
    register(input: DataSourceRegisterInput): Promise<void>;
    read(input: DataSourceReadInput): Promise<DataSourceResult>;
    getRegistry(): DataSourceRegistry;
  };

  approvals: {
    approve(input: ApprovalResolveInput): Promise<void>;
    reject(input: ApprovalResolveInput): Promise<void>;
    list(status?: 'pending' | 'approved' | 'rejected'): Promise<unknown[]>;
    get(approvalId: string): Promise<unknown | undefined>;
  };

  evaluations: {
    run(input: EvaluationInput, evaluators?: Evaluator[]): Promise<EvaluationRunResult>;
  };

  quotas: {
    check(key: QuotaKey, proposed: Partial<QuotaUsage>): Promise<QuotaDecision>;
    commit(key: QuotaKey, actual: QuotaUsage): Promise<void>;
  };

  secrets: {
    resolve(ref: string, context?: GovernanceContext | Partial<GovernanceContext>): Promise<string>;
  };

  prompts: {
    register(input: PromptTemplateInput, context: GovernanceContext | Partial<GovernanceContext>): Promise<PromptTemplate>;
    get(query: PromptTemplateQuery): PromptTemplate | undefined;
    list(id?: string): PromptTemplate[];
  };

  compliance: {
    requestArtifact(input: ComplianceProofRequest): Promise<ComplianceArtifact | ProofJob>;
    getArtifacts(runId: string): Promise<ComplianceArtifact[]>;
    verifyArtifact(input: ComplianceVerificationInput): Promise<ProofVerificationResult>;
    replayRun(input: ComplianceReplayInput): Promise<AuditReplayResultWithSnapshot>;
  };

  governance: {
    createGateEvaluator(): GovernanceGateEvaluator;
  };
}
```

---

## Core Input Types

### GenerateInput

```typescript
type GenerateInput = {
  model: string;
  request: ModelRequest;
  context: GovernanceContext | Partial<GovernanceContext>;
  options?: GenerateOptions;
  grounding?: GroundingInput;
  promptTemplate?: PromptTemplateRef | PromptTemplate;
  dataClass?: DataClass;
  requiredResidency?: 'EU' | 'US' | 'APAC';
  outputSchema?: OutputSchema;
  outputValidationMode?: OutputValidationMode;  // 'warn' | 'block'
  evaluators?: Evaluator[];
};
```

### GenerateStreamInput

```typescript
type GenerateStreamInput = GenerateInput & {
  streamOptions?: { emitChunks?: boolean; abortOnSensitive?: boolean };
};
```

### OutputSchema

```typescript
type OutputSchema =
  | { type: 'jsonSchema'; schema: Record<string, unknown> }
  | { type: 'zod'; schema: { safeParse: (v: unknown) => { success: boolean; error?: { message: string } } } };
```

### ModelRequest / ModelResponse / StreamChunk

```typescript
type ModelRequest = {
  model: string;
  messages: ModelMessage[];
  context: GovernanceContext;
  config?: ModelConfig;   // maxTokens, temperature, etc.
};

type ModelResponse = {
  model: string;
  content: string | Record<string, unknown>;
  finishReason?: FinishReason;
  usage: ModelUsage;
};

type StreamChunk = {
  type: 'content' | 'usage' | 'error';
  content?: string;
  usage?: Partial<ModelUsage>;
  error?: { message: string; code?: string };
};
```

### AgentRunInput

```typescript
type AgentRunInput = {
  agent: AgentRuntime;
  input: unknown;
  limits?: Partial<AgentLimits>;
  context: GovernanceContext | Partial<GovernanceContext>;
};
```

### MemoryScope

```typescript
type MemoryScope = 'conversation' | 'session' | 'user' | 'org' | 'global';
```

### QuotaKey / QuotaUsage

```typescript
type QuotaKey = { type: 'org' | 'user' | 'team' | 'model'; id: string; period?: 'hour' | 'day' | 'month' };
type QuotaUsage = { tokensIn?: number; tokensOut?: number; costUsd?: number; requestsCount?: number };
// WARNING: `allowed` may be undefined when using createInMemoryQuotaManager() with no configured limits.
// Always use `effect === 'block'` as the authoritative guard — do NOT rely solely on `!decision.allowed`.
type QuotaDecision = { allowed?: boolean; effect: 'allow' | 'limit' | 'block'; applied?: QuotaUsage; remaining?: QuotaUsage };
```

---

## Registry Factories

```typescript
createModelRegistry(): ModelRegistry
createToolRegistry(options?: ToolRegistryOptions): ToolRegistry
createMCPRegistry(): MCPRegistry
createKBRegistry(): KBRegistry
createTemplateRegistry(): TemplateRegistry
createMemoryRegistry(): MemoryRegistry
createDataSourceRegistry(): DataSourceRegistry
```

---

## Model Provider

```typescript
interface ModelProvider {
  id: string;
  supportsModel(modelId: string): boolean;
  supportedModels(): string[];
  generate(request: ModelRequest, options?: GenerateOptions): Promise<ModelResponse>;
  stream?(request: ModelRequest, options?: GenerateOptions): AsyncIterable<StreamChunk>; // ← must be "stream", NOT "generateStream"
  estimateTokens?(request: ModelRequest): Promise<number>;
}
// supportsStreaming(provider) checks typeof provider.stream === 'function'
// Naming it generateStream, streamResponse, etc. will cause "does not support streaming" at runtime

// Built-in factories
createMockProvider(options?: MockProviderOptions): ModelProvider
createFixedResponseProvider(response: string): ModelProvider
createFailingProvider(): ModelProvider

// Capability checks
supportsStreaming(provider: ModelProvider): boolean
supportsTokenEstimation(provider: ModelProvider): boolean
supportsImageGeneration(provider: ModelProvider): boolean
supportsAudioGeneration(provider: ModelProvider): boolean
supportsVideoGeneration(provider: ModelProvider): boolean
supportsImageToText(provider: ModelProvider): boolean
supportsAudioToText(provider: ModelProvider): boolean
supportsVideoToText(provider: ModelProvider): boolean
// + supportsImageToAudio, supportsImageToVideo, supportsAudioToImage,
//   supportsAudioToVideo, supportsVideoToImage, supportsVideoToAudio
```

External providers (separate packages):
- `@arelis-ai/governance-providers-azure-openai`
- `@arelis-ai/governance-providers-aws-bedrock`
- `@arelis-ai/governance-providers-google-vertex`
- `@arelis-ai/governance-providers-huggingface`

---

## Policy Engine

```typescript
interface PolicyEngine {
  evaluate(input: PolicyInput): Promise<PolicyResult>;
}

type PolicyInput = {
  checkpoint: PolicyCheckpoint;
  context: GovernanceContext;
  runId: string;
  data: GovernanceGatePolicyData;
};

type PolicyResult = {
  decisions: PolicyDecision[];
  summary: PolicySummary & { allowed: boolean; blockReason?: string; approvers?: string[] };
  policyVersion?: string;
};

type PolicyDecision = {
  effect: 'allow' | 'block' | 'transform' | 'require_approval';
  reason?: string;
  code?: string;
  approvers?: string[];
};

type PolicyCheckpoint = 'BeforePrompt' | 'AfterModelOutput' | 'BeforeToolCall' | 'AfterToolResult' | 'BeforePersist';
type PolicyEnforcementMode = 'enforce' | 'monitor' | 'off';
```

### Policy Factories

```typescript
createAllowAllEngine(): PolicyEngine
createDenyAllEngine(): PolicyEngine
createPolicyModeEngine(mode: PolicyEnforcementMode): PolicyEngine
createPolicyModeEngine(baseEngine: PolicyEngine, mode: PolicyEnforcementMode | PolicyModeResolver): PolicyEngine

// Decision builders (for custom engines)
allowDecision(): PolicyDecision
blockDecision(reason: string, code?: string): PolicyDecision
transformDecision(reason: string): PolicyDecision
requireApprovalDecision(reason: string, approvers: string[]): PolicyDecision

// From config files
createJsonPolicyCompiler(): PolicyCompiler
createPolicyEngineFromConfig(config: PolicyConfigFile): PolicyEngine
loadPolicyEngineFromFile(filePath: string): PolicyEngine
parsePolicyConfig(data: unknown): PolicyConfigFile
loadPolicyConfigFile(filePath: string): PolicyConfigFile
compilePolicy(compiler: PolicyCompiler, source: PolicyCompilationInput): PolicyCompilationResult
```

---

## Audit Sink

```typescript
interface AuditSink {
  write(event: AuditEvent): Promise<void>;
  flush?(): Promise<void>;
}

createNoOpSink(): AuditSink
createConsoleSink(options?: { pretty?: boolean; timestamp?: boolean; filter?: (e: AuditEvent) => boolean }): AuditSink
createMemorySink(config?: MemorySinkConfig): AuditSink   // has .events array
createCompositeSink(sinks: AuditSink[]): AuditSink       // ← takes a single ARRAY arg, not spread
createCausalGraphAuditSink(baseSink: AuditSink, graphStore: CausalGraphStore): AuditSink
```

---

## Telemetry

```typescript
createNoOpTelemetry(): Telemetry
createOTelAdapter(config: { tracer: Tracer; meter?: Meter; prefix?: string }): Telemetry

interface Telemetry {
  startSpan(name: string, attributes?: SpanAttributes): SpanHandle;
  contextAttributes(context: GovernanceContext): Record<string, unknown>;
}
```

---

## DataRef Utilities

```typescript
createInlineRef(content: string): DataRef
createBlobRef(blobId: string): DataRef
createHashRef(hash: string, algorithm?: string): DataRef
createDataRef(input: InlineRef | BlobRef | HashRef): DataRef
hashSha256(data: string): string
isInlineRef(ref: DataRef): ref is InlineRef
isBlobRef(ref: DataRef): ref is BlobRef
isHashRef(ref: DataRef): ref is HashRef
getInlineValue(ref: DataRef): string | undefined
serializeDataRef(ref: DataRef): string
deserializeDataRef(serialized: string): DataRef
```
