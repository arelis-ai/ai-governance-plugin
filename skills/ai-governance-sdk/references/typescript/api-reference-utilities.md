# AI Governance SDK — API Reference: Utilities

All imports from the umbrella package:

```typescript
import { ... } from '@arelis-ai/ai-governance-sdk';
```

---

## Table of Contents

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
