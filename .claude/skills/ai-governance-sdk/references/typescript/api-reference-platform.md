# AI Governance SDK — API Reference: Platform

All imports from the umbrella package:

```typescript
import { ... } from '@arelis-ai/ai-governance-sdk';
```

---

## Table of Contents

- [ArelisPlatform Constructor](#arelisplatform--createarelisplatform)
- [Platform Namespaces](#arelisplatform-namespaces)
- [Events Types](#events)
- [AI Systems Types](#ai-systems-types)
- [Governance Policy Types](#governance-policy-types)
- [Risk Evaluation](#risk-evaluation)
- [Proofs](#proofs)
- [Graphs](#graphs)
- [Replay](#replay)

---

## ArelisPlatform / createArelisPlatform

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

---

## ArelisPlatform Namespaces

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
```

---

## AI Systems Types

```typescript
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

### Singleton initialization (module-level)

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
