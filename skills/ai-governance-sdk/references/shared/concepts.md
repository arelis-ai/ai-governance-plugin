# Cross-Cutting Concepts (Shared)

Concepts that apply to both TypeScript and Python SDKs.

---

## GovernanceContext

Required on every governance-aware operation. Identifies who, why, and where an AI operation happens.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `org` | `{ id, name }` | yes | Organization |
| `actor` | `{ type, id, email?, roles? }` | yes | Who is acting — `type` is `human` \| `service` \| `agent` |
| `purpose` | `string` | yes | Why — e.g. `customer-support`, `internal-tooling`, `chat` |
| `environment` | `string` | yes | Where — `dev` \| `staging` \| `prod` |
| `sessionId` | `string` | no | Session identifier for grouping events |
| `tags` | `dict/object` | no | Arbitrary key-value tags for filtering |

### TypeScript

```typescript
const ctx: GovernanceContext = {
  org: { id: 'org_123', name: 'Acme' },
  actor: { type: 'human', id: 'user_456', email: 'a@acme.com', roles: ['analyst'] },
  purpose: 'customer-support',
  environment: 'dev',
  sessionId: 'sess_abc',
  tags: { feature: 'chat' },
};
```

### Python

```python
ctx = {
    "org": {"id": "org_123", "name": "Acme"},
    "actor": {"type": "human", "id": "user_456", "email": "a@acme.com", "roles": ["analyst"]},
    "purpose": "customer-support",
    "environment": "dev",
    "session_id": "sess_abc",
    "tags": {"feature": "chat"},
}
```

---

## Architecture Differences

### TypeScript: Unified + Split Patterns
- **`createArelis`** — unified orchestrator (`governedInvoke`, `agents.run`, `governance.getPiiConfig`) for SDK `1.2.1+`
- **`createArelisClient`** — local governance client for model execution, policy enforcement, memory, quotas, evaluations
- **`ArelisPlatform`** — remote platform client for events, risk, proofs, causal graphs

Use `createArelis` by default. For low-level control, keep split `createArelisClient` + `ArelisPlatform`.

### Python: Unified + Platform Patterns
- **`create_arelis`** — unified orchestrator (`governed_invoke`, `agents.run`, `governance.get_pii_config`) for high-level model invocations with built-in PII redaction, policy gate, event reporting, and risk evaluation
- **`create_arelis_platform`** — low-level platform client (same API surface as TypeScript's `ArelisPlatform`)
- **No local governance client** — Python apps call model providers directly (google-genai, anthropic, openai) inside the `invoke` callable
- With `governed_invoke`: PII scanning, policy evaluation, event reporting, and risk are handled automatically
- With `create_arelis_platform` (manual): governance is applied by (1) calling `governance.evaluatePolicy()` before/after model calls, (2) emitting events, (3) building causal graphs

Use `create_arelis` + `governed_invoke` by default. For low-level control or streaming, use `create_arelis_platform` directly.

---

## Causal Graphs

A causal graph traces the lineage of an AI operation — which events caused which. Built from:
- **Nodes**: One per recorded event (policy.evaluated, model.invoked, output.delivered, tool.call, tool.result)
- **Edges**: `sequence` edges connecting nodes in temporal order

The graph is submitted via `replay.startCausalGraph()` and sealed with `graphs.commit()` which produces a SHA-256 rootHash.

---

## Risk Assessment

Risk scoring evaluates the aggregate risk of an AI operation based on:
- Policy decisions (blocks, approvals, transforms)
- Quota state
- Evaluation signals

Returns a score from 0-100 with an action recommendation.

---

## Compliance Proofs

Cryptographic attestations that an AI operation followed governance rules. Two provider types:
- **Hash proof**: SHA-256 hash chain (fast, lightweight)
- **ZK-SNARK proof**: Zero-knowledge proof (cryptographic, requires additional dependencies)

Proofs are created after the post-stream pipeline and can be verified later for audit.

---

## PII Scanning

Both SDKs support scanning prompts and tool arguments for personally identifiable information (PII) before sending to models:
- SSN patterns (`\b\d{3}-\d{2}-\d{4}\b`)
- Phone numbers
- Email addresses
- Credit card numbers

In TypeScript, use `scanPromptForPii()` and managed config from `governance.getPiiConfig({ namespace? })` (`pii.default` by default). In Python, use `scan_prompt_for_pii()` from the SDK and managed config from `governance.get_pii_config()`. Both `governed_invoke` (TS and Python) handle PII scanning and redaction automatically.

---

## Post-Stream Pipeline (8 Steps)

After every successful model call, execute these 8 steps sequentially:

| Step | Action | Description |
|------|--------|-------------|
| A | Extract policy decisions | Read from audit sink (TS) or local state (Python) |
| B | Emit `policy.evaluated` event | Records local policy enforcement + PII result |
| C | Emit `model.invoked` + `output.delivered` | Platform event reporting |
| D | `governance.evaluatePolicy()` | Post-stream reconciliation (AfterModelOutput checkpoint) |
| E | `risk.evaluate()` | Score risk from decisions + quota state |
| F | `proofs.create()` | Cryptographic compliance attestation |
| G | `replay.startCausalGraph()` | Build and submit causal graph — BEFORE commit |
| H | `graphs.commit(runId)` | Seal causal graph with SHA-256 rootHash — ALWAYS LAST |

Steps B+C must land before G so the graph has events to reference. Step G must precede H.
