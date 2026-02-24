# AI Governance SDK — API Reference

All imports from the umbrella package:

```typescript
import { ... } from '@arelis-ai/ai-governance-sdk';
```

---

## Table of Contents

- [Client Creation](#client-creation)
- [Unified Orchestration](#unified-orchestration)
- [ArelisClient Full Interface](#arelisclient-full-interface)
- [Core Input Types](#core-input-types)
- [Registry Factories](#registry-factories)
- [Model Provider](#model-provider)
- [Policy Engine](#policy-engine)
- [Audit Sink](#audit-sink)
- [Telemetry](#telemetry)
- [Knowledge Base](#knowledge-base)
- [MCP](#mcp)
- [Agents](#agents)
- [Tools](#tools)
- [Memory](#memory)
- [Quotas](#quotas)
- [Secrets](#secrets)
- [Evaluations](#evaluations)
- [Prompt Templates](#prompt-templates)
- [Governance Gate Helpers](#governance-gate-helpers)
- [Event Bridge Helpers](#event-bridge-helpers)
- [Error Classes & Guards](#error-classes--guards)
- [Compliance](#compliance)
- [Extension Contracts](#extension-contracts)
- [ID Generation](#id-generation)

---

## Client Creation

### createArelisClient

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

### ArelisPlatform / createArelisPlatform

Sends audit events, risk evaluations, causal graphs, and compliance proofs to the hosted Arelis governance dashboard. Used by both `createArelis({ platform })` and split `createArelisClient` setups.

```typescript
// Class constructor (preferred)
new ArelisPlatform(config: ArelisPlatformConfig): ArelisPlatform

// Factory function alias
function createArelisPlatform(config: ArelisPlatformConfig): ArelisPlatform

interface ArelisPlatformConfig {
  baseUrl?: string;     // optional — defaults to 'https://api.arelis.digital'
  apiKey: string;       // required — ARELIS_API_KEY env var (ak_sandbox_... or ak_prod_...)
  maxRetries?: number;  // default: 3
  timeout?: number;     // ms, default: 30_000
}
```

#### ArelisPlatform Namespaces

```typescript
interface ArelisPlatform {
  events: {
    create(input: AuditEventInput): Promise<CreateEventResponse>;
    // AuditEventInput: { runId, eventType, actor, resource, action, timestamp, metadata?, aiSystemId? }
  };
  aiSystems: {
    register(input: AiSystemInput): Promise<AiSystemRecord>;
    list(params?: ListAiSystemsParams): Promise<ListAiSystemsResponse>;
    get(systemId: string): Promise<AiSystemRecord>;
    update(systemId: string, input: AiSystemUpdateInput): Promise<AiSystemRecord>;
    archive(systemId: string): Promise<AiSystemRecord>;
    setDefault(systemId: string): Promise<AiSystemRecord>;
    summary(systemId: string, params?: AiSystemSummaryParams): Promise<AiSystemSummary>;
  };
  governance: {
    policies: {
      list(params?: { search?: string }): Promise<{ data: PolicyRecord[] }>;
      create(input: CreatePolicyInput): Promise<PolicyRecord>;
    };
    getPiiConfig(input?: { namespace?: string }): Promise<ManagedPiiConfig>;
    // namespace defaults to 'pii.default'; customPatterns are compiled to RegExp entries
    evaluatePolicy(input: PolicyEvaluateInput): Promise<PolicyEvaluateResponse>;
  };
  risk: {
    evaluate(input: RuntimeRiskInput): Promise<RiskEvaluationResponse>;
    // RuntimeRiskInput: { runId, policyDecisions, quotaState, evaluationSignals }
    // RiskEvaluationResponse: { action, score, deterministicInputsHash }
  };
  graphs: {
    commit(runId: string): Promise<GraphCommitResponse>;    // { rootHash }
    lineage(runId: string, nodeId: string): Promise<GraphLineageResponse>;  // { nodes, edges }
  };
  replay: {
    startCausalGraph(input: CausalGraphReplayRequest): Promise<AsyncJobResponse>;
    // CRITICAL: Must be called BEFORE graphs.commit() — without it, commit fails
    // because no causal graph exists to seal.
    //
    // CausalGraphReplayRequest: {
    //   runId: string;
    //   nodes: { id: string; type: string; data: Record<string, unknown> }[];
    //   edges: { source: string; target: string; type: string }[];
    // }
    //
    // Build nodes from recorded events (policy.evaluated, model.invoked,
    // output.delivered, tool.call, tool.result, etc.) and connect them with
    // "sequence" edges in temporal order. Then call graphs.commit(runId) to
    // seal the graph with a SHA-256 rootHash.
    start(request: ReplayRequest): Promise<AsyncJobResponse>;
    get(replayId: string): Promise<ReplayResultResponse>;
    list(params?: ReplayListParams): Promise<ReplayListResponse>;
    createTemplate(input: ReplayTemplateInput): Promise<ReplayTemplate>;
    listTemplates(params?: { runId?: string; cursor?: string; limit?: number }): Promise<ReplayTemplateListResponse>;
    getTemplate(templateId: string): Promise<ReplayTemplate>;
  };
  proofs: {
    create(input: ComplianceProofRequest): Promise<CreateProofResponse | AsyncJobResponse>;
    verify(input: { proofId: string }): Promise<VerifyProofResponse>;
  };
}

// ── AI System Types ──────────────────────────────────────────────────────────

type AiSystemType = 'model' | 'agent' | 'pipeline' | 'tool_chain';
type AiSystemStatus = 'active' | 'archived' | 'deprecated';

interface AiSystemInput {
  name: string;                          // display name in dashboard
  type: AiSystemType;                    // required
  provider?: string;                     // e.g. 'google', 'openai', 'anthropic'
  modelRef?: string;                     // model identifier string
  version?: string;
  description?: string;
  config?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  tags?: string[];
}

interface AiSystemUpdateInput {
  name?: string;
  type?: AiSystemType;
  provider?: string | null;
  modelRef?: string | null;
  version?: string | null;
  status?: AiSystemStatus;
  description?: string | null;
  config?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  tags?: string[] | null;
}

interface AiSystemRecord {
  id: string;                            // use as aiSystemId in events
  slug: string;
  name: string;
  type: AiSystemType;
  provider: string | null;
  modelRef: string | null;
  version: string | null;
  status: AiSystemStatus;
  isDefault: boolean;
  description: string | null;
  config: unknown;
  metadata: unknown;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

interface ListAiSystemsParams {
  type?: AiSystemType;
  status?: AiSystemStatus;
  provider?: string;
}

interface ListAiSystemsResponse {
  data: AiSystemRecord[];
  nextCursor: string | null;
}

interface AiSystemSummaryParams {
  start?: string;                        // ISO date
  end?: string;                          // ISO date
}

interface AiSystemSummary {
  aiSystem: { id: string; name: string; type: string };
  period: { start: string; end: string };
  events: { total: number; byType: Record<string, number> };
  risk: { totalDecisions: number; byLevel: Record<string, number> };
  proofs: { total: number };
}
```

#### Singleton initialization (module-level)

```typescript
let _platform: ArelisPlatform | null = null;

export function getArelisPlatform(): ArelisPlatform {
  if (_platform) return _platform;
  const apiKey = process.env.ARELIS_API_KEY;
  if (!apiKey) throw new Error('ARELIS_API_KEY is not set');
  _platform = new ArelisPlatform({
    apiKey,
    ...(process.env.ARELIS_API_URL ? { baseUrl: process.env.ARELIS_API_URL } : {}),
    maxRetries: 2,
    timeout: 15_000,
  });
  return _platform;
}
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

### DataRef Utilities

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

## Knowledge Base

```typescript
createKBRegistry(): KBRegistry
createKBRetriever(registry: KBRegistry): KBRetriever
createGroundingHelper(): GroundingHelper
createMemoryKBProvider(options: { kbId: string; documents: Array<{ id: string; text: string; title?: string; metadata?: Record<string, unknown> }>; embedFn?: EmbedFunction; scoringOptions?: MemoryKBScoringOptions }): KBProvider
applyGrounding(helper: GroundingHelper, grounding: GroundingInput, request: ModelRequest, runId: string, context: GovernanceContext): Promise<GroundingResult>
mergeRetrievalResults(...results: RetrievalResult[]): RetrievalResult
HybridScorer   // class for custom scoring

type KnowledgeBaseDescriptor = {
  id: string;
  name: string;
  provider: string;
  governance?: KBGovernanceConfig;   // dataClass, approvedForPurposes, sensitivity
  connection: Record<string, unknown>;
};
```

---

## MCP

```typescript
createMCPRegistry(): MCPRegistry
createStdioMCPTransport(config: { command: string; args?: string[] }): MCPTransport
createHttpMCPTransport(config: { baseUrl: string }): MCPTransport
createMockMCPTransport(options: MockMCPTransportOptions): MCPTransport
discoverTools(transport: MCPTransport, options?: ToolDiscoveryOptions): Promise<ToolDiscoveryFullResult>
getMCPToolName(serverId: string, toolName: string): string
parseMCPToolName(fullName: string): { serverId: string; toolName: string } | null

type MCPServerDescriptor = {
  id: string; name: string;
  transport: MCPTransportConfig;   // { type: 'stdio' | 'http' | 'mock'; url?; command?; args? }
  governance?: { allowedTools?: string[]; deniedTools?: string[]; approvedForPurposes?: string[] };
  tags?: Record<string, string>;
};
```

---

## Agents

```typescript
// Unified orchestrator agents loop (recommended in v1.2.1+)
type GovernedAgentTool = {
  name: string;
  description: string;
  schema: Record<string, unknown>;
};

arelis.agents.run<T = unknown>(input: GovernedAgentRunInput<T>): Promise<GovernedAgentRunResult<T>>

// Low-level runtime APIs (manual plan/execute/observe loop)
createAgentRuntime(options: {
  config: AgentConfig;
  handlers: AgentHandlers;
  onStep?: (step: AgentStep) => Promise<void>;
}): AgentRuntime
createInMemoryAgentMemory(): AgentMemory

type AgentConfig = {
  agentId: string; name: string; description?: string;
  systemPrompt: string;
  limits: { maxSteps: number; maxTimeMs: number };
  context: GovernanceContext;
  tools: string[];
};

type AgentHandlers = {
  plan(input: unknown, step: AgentStep): Promise<AgentPlan>;
  execute(plan: AgentPlan, step: AgentStep): Promise<AgentExecution>;
  observe(execution: AgentExecution, step: AgentStep): Promise<AgentObservation>;
};

type AgentResult<T = unknown> = {
  runId: string; agentId: string; status: AgentRunStatus;
  totalSteps: number; totalDurationMs: number;
  output: T; steps: AgentStep[]; error?: string;
};
```

---

## Tools

```typescript
createToolRegistry(options?: ToolRegistryOptions): ToolRegistry
createToolRunner(registry: ToolRegistry): ToolRunner
invokeTool(tool: ToolDefinition, args: unknown, context: ToolContext): Promise<unknown>
validateArguments(args: unknown, schema: JsonSchema): { valid: boolean; errors?: string[] }

type ToolDefinition<Args = unknown, Result = unknown> = {
  name: string; description: string; schema: JsonSchema;
  permissions?: ToolPermissions;   // scopes, allowedActorTypes, allowedEnvironments
  tags?: string[];
  handler: (args: Args, context: ToolContext) => Promise<Result>;
};
```

---

## Memory

```typescript
createMemoryRegistry(): MemoryRegistry
createInMemoryMemoryProvider(): MemoryProvider

type MemoryScope = 'conversation' | 'session' | 'user' | 'org' | 'global';
type MemoryEntry = { scope: MemoryScope; key: string; value: unknown; metadata?: Record<string, unknown>; createdAt?: Date; updatedAt?: Date };
```

---

## Quotas

```typescript
createInMemoryQuotaManager(): QuotaManager
```

---

## Secrets

```typescript
createEnvSecretResolver(): SecretResolver
resolveSecretValue(resolver: SecretResolver, ref: string, options: { context?: GovernanceContext; runId?: string }): Promise<SecretResolution>
getSecretRedactionPatterns(): RedactionPattern[]
```

---

## Evaluations

```typescript
runEvaluations(input: EvaluationInput, evaluators: Evaluator[]): Promise<EvaluationRunResult>
deriveEvaluationEffect(result: EvaluationRunResult): 'allow' | 'warn' | 'block'

type EvaluationRunResult = { runId: string; results: EvaluationResult[]; summary: { totalEvaluators: number; passed: number; warnings: number; failures: number } };
```

---

## Prompt Templates

```typescript
createTemplateRegistry(): TemplateRegistry
computePromptHash(content: string): string
```

---

## Governance Gate Helpers

```typescript
scanPromptForPii(prompt: string, options?: ScanPromptForPiiOptions): PromptPiiScanResult
evaluatePreInvocationGate(source: GovernanceGateSource, input: EvaluatePreInvocationGateInput, options?: ScanPromptForPiiOptions): Promise<PreInvocationGateDecision>
withGovernanceGate<T>(source: GovernanceGateSource, input: EvaluatePreInvocationGateInput, fn: () => Promise<T>, options?: WithGovernanceGateOptions): Promise<WithGovernanceGateResult<T>>
createGovernanceGateEvaluator(options: { evaluatePolicy; resolveContext?; getPolicyMetadata? }): GovernanceGateEvaluator
GovernanceGateDeniedError   // class, has .decision property

type GovernanceGateSource = GovernanceGateEvaluator | ArelisPlatform | ArelisClient
type WithGovernanceGateResult<T> = {
  runId: string;
  invoked: boolean;
  decision: {
    decision: 'allow' | 'deny';
    pii: PromptPiiScanResult;
    metadata: { timings: { scanMs: number; policyEvalMs: number; totalMs: number } };
  };
  result?: T;
  warnings?: string[]; // non-fatal side-effect failures
}
// When source is ArelisPlatform, gate telemetry events are emitted automatically:
// governance.gate.evaluated and governance.gate.outcome.
```

---

## Event Bridge Helpers

```typescript
// SDK exports helper(s) that map local audit-style events into
// platform.events.create-compatible payloads.
// Use these bridge helpers when syncing local audit streams to platform events.
```

Use bridge helpers when forwarding local sink/audit events to `platform.events.create(...)` to preserve event naming and metadata shape.

---

## Error Classes & Guards

```typescript
// Errors (all extend ArelisError which has runId, context, code, type)
PolicyBlockedError              // .reason, .policyCode
PolicyApprovalRequiredError     // .reason, .approvers, .approvalId
EvaluationBlockedError          // .reason
GovernanceGateDeniedError       // .decision (extends Error, not ArelisError)

// Type guards
isPolicyBlockedError(error: unknown): error is PolicyBlockedError
isPolicyApprovalRequiredError(error: unknown): error is PolicyApprovalRequiredError
isEvaluationBlockedError(error: unknown): error is EvaluationBlockedError
```

---

## Compliance

```typescript
replayAuditRun(input: AuditReplayInput): Promise<AuditReplayResult>
replayCausalGraph(input: CausalGraphReplayRequest): Promise<CausalGraph>
traverseLineage(event: AuditEvent, events: AuditEvent[]): AuditEvent[]
createCausalGraphCommitment(...): CausalGraphCommitment
assessPolicyRisk(input: RuntimeRiskInput): number
HashProofProvider    // class — SHA-256 hash chain proof
SnarkjsProofProvider // class — ZK-SNARK proof (requires snarkjs)
```

---

## Extension Contracts

```typescript
type ExtensionCapabilityFlag = 'composed_proofs' | 'risk_routing' | 'snapshot_replay' | 'causal_lineage';
EXTENSION_NAMESPACE_CONTRACTS: Record<ExtensionId, ExtensionNamespaceContract>
extensionContractById(id: ExtensionId): ExtensionNamespaceContract | undefined
detectExtensionContractCollisions(extensions: ClientExtensionsConfig): ExtensionCollision[]
```

---

## ID Generation

```typescript
generateRunId(): string      // 'run_' + ULID
defaultContextResolver(partial: Partial<GovernanceContext>): Promise<GovernanceContext>
```
