# Policies, Governance & Audit Events (Shared)

Policy rules, checkpoint concepts, enforcement modes, and the complete audit event catalog. These concepts apply identically to both TypeScript and Python SDKs.

---

## Policy Config File Format

Policy rules are defined in JSON and are language-agnostic:

```json
{
  "version": "1.0",
  "rules": [
    {
      "id": "block-pii-in-prompts",
      "checkpoint": "BeforePrompt",
      "condition": { "type": "contains", "field": "payload.messages[*].content", "pattern": "\\b\\d{3}-\\d{2}-\\d{4}\\b" },
      "effect": "block",
      "reason": "SSN detected in prompt",
      "code": "PII_SSN_DETECTED"
    },
    {
      "id": "require-approval-finance",
      "checkpoint": "BeforeToolCall",
      "condition": { "type": "equals", "field": "context.purpose", "value": "financial-reporting" },
      "effect": "require_approval",
      "approvers": ["cfo@acme.com", "compliance@acme.com"],
      "reason": "Financial reporting requires approval"
    },
    {
      "id": "monitor-prod-output",
      "checkpoint": "AfterModelOutput",
      "condition": { "type": "equals", "field": "context.environment", "value": "prod" },
      "effect": "allow",
      "monitor": true
    }
  ]
}
```

---

## Policy Checkpoints

| Checkpoint | When | `data` contains |
|------------|------|-----------------|
| `BeforePrompt` | Before model API call | `{ modelId, input, provider }` |
| `AfterModelOutput` | After model returns | `{ modelId, output, provider }` |
| `BeforeToolCall` | Before tool/MCP invocation | `{ toolName, args, trustLevel }` |
| `AfterToolResult` | After tool returns | `{ output }` (the tool's return value) |
| `BeforePersist` | Before memory/data write | `{ scope, key, value }` |

**IMPORTANT**: `BeforeToolCall` and `AfterToolResult` are **not** automatically evaluated by either SDK during model generation. They must be evaluated manually.

### BeforeToolCall data shape

```
{
  toolName: string,
  args: dict/object,
  trustLevel: "low" | "medium" | "high"
}
```

### AfterToolResult data shape

```
{
  output: { success: boolean, data?: dict/object, error?: string }
}
```

---

## PolicyDecision Effects

| Effect | Meaning |
|--------|---------|
| `allow` | Permit the operation |
| `block` | Deny the operation |
| `transform` | Allow but modify (e.g. redact PII) |
| `require_approval` | Pause until approver grants access (local policy engine only) |
| `escalate` | Escalate for review (platform API equivalent of `require_approval`) |

> **Note:** The platform API (`platform.governance.policies.create()`) accepts `"allow"`, `"deny"`, `"warn"`, and `"escalate"` as valid action values. `"require_approval"` is only valid in local policy config JSON files, not in platform API calls.

---

## Enforcement Modes

| Mode | Behavior |
|------|----------|
| `enforce` | Evaluate policies and block on violations (default) |
| `monitor` | Evaluate + audit but never block |
| `off` | Skip evaluation entirely |

Dynamic mode resolvers can switch modes based on context (e.g. environment, tags).

---

## Disclosure Rules & Policy Snapshots

**Disclosure Rules**: Conditions that trigger mandatory disclosures to end users.

**Policy Snapshots**: Point-in-time captures of policy rules with SHA-256 hash for audit trail integrity.

---

## Audit Event Base Shape

Every audit event has this structure:

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | ULID |
| `type` | `string` | Event type (e.g. `run.started`) |
| `runId` | `string` | `run_...` ULID |
| `sessionId` | `string?` | Optional session ID |
| `orgId` | `string` | Organization ID |
| `actorId` | `string` | Actor identifier |
| `actorType` | `string` | `human` \| `service` \| `agent` |
| `purpose` | `string` | Purpose of the operation |
| `environment` | `string` | `dev` \| `staging` \| `prod` |
| `timestamp` | `string` | ISO 8601 |
| `payload` | `DataRef` | Inline, blob, or hash reference |
| `causedBy` | `string?` | Parent event ID (for causal graph) |
| `tags` | `dict?` | Optional key-value tags |

---

## DataRef Types

| Type | Shape | Use |
|------|-------|-----|
| `inline` | `{ type: "inline", value: string }` | JSON-stringified small payloads |
| `blob` | `{ type: "blob", uri: string, checksum: string, encrypted?: boolean }` | External storage |
| `hash` | `{ type: "hash", sha256: string }` | Proof of existence only |

---

## Complete Audit Event Type Catalog

### Run Lifecycle
- `run.started`, `run.ended`, `run.error`

### Policy
- `policy.evaluated` — checkpoint, decisions, durationMs

### Model
- `model.resolved`, `model.fallback.used`, `model.deprecated.used`, `model.disabled.blocked`
- `model.request`, `model.response`
- `model.stream.started`, `model.stream.chunk`, `model.stream.ended`, `model.stream.aborted`

### Multimodal Media
- `image.generate.request` / `image.generate.response`
- `audio.generate.request` / `audio.generate.response`
- `video.generate.request` / `video.generate.response`
- `image.to.text.request` / `image.to.text.response`
- `audio.to.text.request` / `audio.to.text.response`
- `video.to.text.request` / `video.to.text.response`
- `image.to.audio.request` / `image.to.audio.response`
- `image.to.video.request` / `image.to.video.response`
- `audio.to.video.request` / `audio.to.video.response`

### Agent & Tools
- `agent.step` — agentId, stepNumber, stepType
- `agent.attestation.created`
- `tool.call` — toolName, args, result
- `tool.result` — toolName, success, warnings
- `tool.call_blocked` — toolName, reason, trustLevel

### MCP
- `mcp.server.registered`, `mcp.server.connected`, `mcp.server.disconnected`, `mcp.tools.discovered`

### Approval Workflow
- `approval.requested` — approvalId, approvers, reason
- `approval.granted` — approvalId, grantedBy
- `approval.rejected` — approvalId, rejectedBy, reason

### Evaluations
- `evaluation.run`, `evaluation.result`, `evaluation.warning`, `evaluation.blocked`

### Output Validation
- `output.validation.started`, `output.validation.passed`, `output.validation.failed`

### Quota
- `quota.checked`, `quota.limited`, `quota.exceeded`, `quota.committed`

### Data & Memory
- `data.read`, `data.filtered`, `data.blocked`
- `memory.read`, `memory.write`, `memory.delete`

### Knowledge Base
- `kb.query`, `kb.results`, `kb.chunk.filtered`, `kb.grounding.applied`

### Secrets
- `secret.resolved`, `secret.detected.blocked`

### Orchestration & Prompts
- `prompt.template.used`, `orchestration.step`

### Compliance & Advanced
- `compliance.proof.composed`, `risk.route.decided`, `snapshot.captured`, `replay.drift.detected`, `disclosure.derived`

### Resource Lifecycle
- `resource.created`, `resource.updated`, `resource.deleted`

### CLI & Infrastructure
- `cli.command.started`, `cli.command.completed`, `cli.command.failed`
- `infra.provision.started`, `infra.provision.completed`, `infra.provision.failed`
- `infra.destroy.started`, `infra.destroy.completed`, `infra.destroy.failed`

### Configuration
- `config.change.started`, `config.change.completed`, `config.change.failed`

### Authentication
- `auth.started`, `auth.succeeded`, `auth.failed`

---

## Risk Assessment

`assessPolicyRisk()` / `assess_policy_risk()` takes a `RuntimeRiskInput` and returns a score from 0-100.

---

## Compliance Proof Providers

| Provider | Description |
|----------|-------------|
| Hash proof | SHA-256 hash chain proof (lightweight, fast) |
| ZK-SNARK proof | Cryptographic zero-knowledge proof (requires snarkjs/snarkjs equivalent) |
