# Arelis Platform API (Shared)

Platform client for sending audit events, risk evaluations, causal graphs, and compliance proofs to the Arelis governance dashboard. The platform API is identical across TypeScript and Python SDKs.

---

## Platform Namespaces

| Namespace | Methods |
|-----------|---------|
| `events` | `create(input)` — emit audit events |
| `aiSystems` | `register()`, `list()`, `get()`, `update()`, `archive()`, `setDefault()`, `summary()` |
| `governance.policies` | `list()`, `create()` |
| `governance` | `evaluatePolicy(input)`, `getPiiConfig({ namespace? })` |
| `risk` | `evaluate(input)` — score risk from decisions + quota state |
| `graphs` | `commit(runId)` — seal causal graph with SHA-256 rootHash |
| `replay` | `startCausalGraph(input)`, `start()`, `get()`, `list()`, `createTemplate()`, `listTemplates()`, `getTemplate()` |
| `proofs` | `create(input)`, `verify(input)` |

---

## Event Input Shape

Every `events.create()` call requires:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `runId` | `string` | yes | Unique run identifier (e.g. `run-chat-<uuid>`) |
| `aiSystemId` | `string` | yes | ID from `aiSystems.register()` — links events to AI system in dashboard |
| `eventType` | `string` | yes | Event type (e.g. `model.invoked`, `output.delivered`, `tool.call`) |
| `actor` | `{ type, id }` | yes | Who initiated the action |
| `resource` | `{ type, id }` | yes | What resource was acted upon |
| `action` | `string` | yes | Action performed (e.g. `inference`, `deliver`, `invoke`) |
| `timestamp` | `string` | yes | ISO 8601 timestamp |
| `metadata` | `dict/object` | no | Additional context |

---

## AI System Registration

Every model must be registered as an AI system before emitting events. Registration is idempotent — check if the system already exists, register only if needed, and cache the `aiSystemId`.

### AiSystemInput Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | yes | Display name in the Arelis dashboard |
| `type` | `AiSystemType` | yes | `'model'` \| `'agent'` \| `'pipeline'` \| `'tool_chain'` |
| `provider` | `string` | no | Provider name (`'google'`, `'openai'`, `'anthropic'`, etc.) |
| `modelRef` | `string` | no | Model identifier (e.g. `'gemini-3-flash-preview'`) |
| `version` | `string` | no | Version tag |
| `description` | `string` | no | Human-readable description |
| `config` | `dict/object` | no | Arbitrary configuration |
| `metadata` | `dict/object` | no | Arbitrary metadata |
| `tags` | `list/array` | no | Searchable tags |

---

## Common Event Types

| Event Type | When | Typical Action |
|------------|------|----------------|
| `model.invoked` | After successful model call | `inference` |
| `output.delivered` | After output sent to user | `deliver` |
| `model_invocation_blocked` | Policy or evaluation blocks model call | `blocked_by_policy` or `blocked_by_evaluation` |
| `policy.evaluated` | After policy checkpoint evaluation | `evaluate` |
| `tool.call` | Before tool execution | `invoke` |
| `tool.result` | After tool execution | `complete` |
| `tool.call_blocked` | Policy blocks tool call | `blocked_by_policy` |
| `governance.gate.evaluated` | Pre-invocation gate evaluated | `evaluate` |
| `governance.gate.outcome` | Pre-invocation gate outcome recorded | `allow` / `deny` |

---

## Platform Policy Evaluation

`governance.evaluatePolicy()` sends checkpoint data to the platform for server-side policy evaluation. Used for PII detection gates and content moderation.

### Input Shape

```
{
  runId: string,
  checkpoint: {
    content: {
      pii_detected: boolean,
      pii_types: string[],
      pii_count: number
    }
  }
}
```

### Response Shape

```
{
  decisions: [
    { decision: "allow" | "deny", policyId: string, metadata?: { policyName?: string } }
  ]
}
```

Map platform `deny` → SDK `block` effect.

---

## Managed PII Config

`governance.getPiiConfig({ namespace? })` returns managed PII scan configuration.

- `namespace` defaults to `pii.default`.
- Use this in TypeScript for local PII scans and redactor config hydration.

---

## Risk Evaluation

`risk.evaluate()` scores risk from policy decisions and quota state.

### Input Shape

```
{
  runId: string,
  aiSystemId: string,
  policyDecisions: object[],
  quotaState?: object,
  evaluationSignals?: object
}
```

### Response Shape

```
{
  action: string,
  score: number,           // 0-100
  deterministicInputsHash: string
}
```

---

## Causal Graph Lifecycle

1. **Emit events** (policy.evaluated, model.invoked, output.delivered, tool.call, tool.result)
2. **Build nodes** from recorded events — each node has `{ id, type, data }`
3. **Build edges** connecting nodes in temporal order — each edge has `{ source, target, type: "sequence" }`
4. **Submit graph**: `replay.startCausalGraph({ runId, nodes, edges })` — MUST be called BEFORE commit
5. **Seal graph**: `graphs.commit(runId)` — produces SHA-256 rootHash — MUST be LAST

**Critical**: `startCausalGraph()` must precede `graphs.commit()`. Without it, commit fails because no causal graph exists to seal.

---

## Compliance Proofs

`proofs.create()` generates a cryptographic compliance attestation for a run.
`proofs.verify()` validates an existing proof.

### Proof Request

```
{
  runId: string,
  aiSystemId: string,
  schemaVersion: "v1"
}
```

---

## Platform Conventions

- **Always initialize the platform client** (`createArelis({ platform })` or split client pattern)
- `ARELIS_API_URL` is optional; default platform URL is `https://api.arelis.digital`
- **Register every model as an AI system** before emitting events (idempotent, cached)
- **Always include `aiSystemId`** on every `events.create()` call
- **Always `await` platform calls** — use `.catch()` to swallow errors in serverless runtimes
- **Generate a unique `runId`** per request and use it consistently across all events
- **Store platform as a module-level singleton** — initialize once, reuse across requests
- **Run the full post-stream pipeline** after every successful model call
- Use event bridge helper exports when mapping local audit events to `events.create()` payloads
