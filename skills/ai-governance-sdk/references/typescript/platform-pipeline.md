# AI Governance SDK — Platform Pipeline

Platform event reporting, risk assessment, compliance proofs, and causal graph construction.

---

## Table of Contents

- [Full Request Lifecycle](#full-request-lifecycle)
- [Phase 1: Pre-Invocation Gate](#phase-1-pre-invocation-gate)
- [Phase 2: Post-Stream Pipeline](#phase-2-post-stream-pipeline)
- [Orchestrator Mode (createArelis)](#orchestrator-mode-createarelis)
- [Causal Graph Construction](#causal-graph-construction)
- [Platform Conventions](#platform-conventions)

---

## Full Request Lifecycle

The complete governance lifecycle has two phases:

### Phase 1: Pre-Invocation Gate

`withGovernanceGate` wraps the model call. If policy denies (for example PII detected), the model callback never executes. In SDK `1.2.1+`, pass `ArelisPlatform` directly to get timing diagnostics and automatic gate telemetry events.

```
withGovernanceGate(platformOrEvaluator, input, modelCallback)
  -> scanPromptForPii
  -> platform.governance.evaluatePolicy (content.pii_detected)
  -> telemetry: governance.gate.evaluated, governance.gate.outcome (platform source)
  -> timings: scanMs, policyEvalMs, totalMs
  -> deny?  gate.invoked=false, model never called
  -> allow? modelCallback executes
  -> side-effect failure? captured in warnings (non-fatal)
```

### Phase 2: Post-Stream Pipeline

After the stream completes, quota is committed, and memory is written, execute these 8 steps **sequentially** (each feeds into the next). All use `await ... .catch(console.error)` so platform failures never break the chat response.

```
gate.result (totalOutput) -> quota commit -> memory write
  -> A: extractPolicyDecisions(runId)        <- sync, reads from audit sink
  -> B: policy.evaluated event               <- records local policy enforcement + PII result
  -> C: model.invoked + output.delivered     <- platform events
  -> D: platform.governance.evaluatePolicy() <- post-stream reconciliation (AfterModelOutput)
  -> E: platform.risk.evaluate()             <- scores risk from decisions + quota
  -> F: platform.proofs.create()             <- cryptographic compliance attestation
  -> G: platform.replay.startCausalGraph()   <- builds & submits the causal graph
  -> H: platform.graphs.commit(runId)        <- seals causal graph (ALWAYS LAST)
```

**Note**: Step D is `AfterModelOutput` (not `BeforePrompt`). The pre-invocation check already happened inside `withGovernanceGate`; Step D records the full post-output policy state for the audit trail.

**Critical**: Step G (`startCausalGraph`) **must** be called before Step H (`graphs.commit`). Without it, `graphs.commit` will fail because no causal graph exists to seal. This is the most common CAG integration mistake.

**Ordering notes**:
- Steps B+C (events) must land **before** G so the graph has events to reference
- Step G builds nodes from the recorded events and links them with sequence edges, then submits the graph structure via `platform.replay.startCausalGraph()`
- Step H seals the graph with a SHA-256 root hash covering all preceding events, proofs, and risk decisions
- `evaluatePolicy` requires the `governance:read` scope on the API key and takes `aiSystemId`

---

## Orchestrator Mode (createArelis)

For SDK `1.2.1+`, prefer `createArelis` when possible:

- `arelis.governedInvoke(...)` handles local PII sanitize + policy gate + model invoke wrapper + platform event reporting + optional risk enrichment.
- `arelis.agents.run(...)` handles pre-gate + multi-step model/tool loop + local causal graph + best-effort platform sync/events/proof/risk.
- Side-effect failures are reported as `warnings` instead of throwing.

Use manual pipeline orchestration only when you need full custom control over each platform call and ordering.

---

## Causal Graph Construction

Build nodes from the events emitted in the post-stream pipeline and connect them with sequence edges:

```typescript
// Build nodes from the events emitted in steps B+C
const graphEvents = [
  { eventId: `${runId}-policy-evaluated`, eventType: 'policy.evaluated', action: 'evaluate' },
  { eventId: `${runId}-model-invoked`, eventType: 'model.invoked', action: 'inference' },
  { eventId: `${runId}-output-delivered`, eventType: 'output.delivered', action: 'deliver' },
];
const nodes = graphEvents.map((ev) => ({
  id: ev.eventId,
  type: ev.eventType,
  data: { action: ev.action, timestamp: new Date().toISOString() } as Record<string, unknown>,
}));

// Build sequence edges (temporal ordering)
const edges: { source: string; target: string; type: string }[] = [];
for (let i = 1; i < graphEvents.length; i++) {
  edges.push({
    source: graphEvents[i - 1].eventId,
    target: graphEvents[i].eventId,
    type: 'sequence',
  });
}

// Submit the causal graph (upserts CausalGraphRecord + creates replay job)
await platform.replay.startCausalGraph({ runId, nodes, edges })
  .catch(err => console.error('[Arelis] startCausalGraph failed:', err));

// NOW commit — seals the graph with rootHash (SHA-256)
await platform.graphs.commit(runId)
  .catch(err => console.error('[Arelis] graphs.commit failed:', err));
```

For agent loops with tool calls, add `tool.call` and `tool.result` nodes to the graph and connect them with sequence edges in the same pattern.

**Helper**: `extractPolicyDecisions(runId)` in `src/lib/governance.ts` reads `policy.evaluated` events from the in-memory audit sink for a given `runId` and returns decisions as `Record<string, unknown>[]`.

---

## Platform Conventions

- **Always initialize `ArelisPlatform`** alongside `createArelisClient` or through `createArelis({ platform })`
- `ARELIS_API_URL` is optional; when omitted, platform base URL defaults to `https://api.arelis.digital`
- **Register every model as an AI system** via `platform.aiSystems.register()` before emitting events. Use an idempotent helper that checks `platform.aiSystems.list()` first and only registers if no matching active system exists. Cache the `aiSystemId` in a module-level variable.
- **Always include `aiSystemId`** on every `platform.events.create()` call so events are linked to the registered AI system in the dashboard
- **After every successful model call**, emit `model.invoked` + `output.delivered` via `platform.events.create()`
- **After every policy or evaluation block**, emit `model_invocation_blocked`
- **After every agent tool call**, emit `tool.call` + `tool.result`
- Treat platform side-effect failures as non-fatal; log them and propagate as warnings where supported
- **Always `await` platform calls** — use `await platform.events.create(...).catch(...)` or `await Promise.all([...]).catch(...)`. In serverless runtimes (Next.js App Router, Vercel Functions, AWS Lambda) the process can terminate as soon as the response stream closes, killing any unawaited promises before they reach the Arelis Platform. Swallow errors in `.catch()` so they never surface to users, but log them for debugging.
- **Generate a unique `runId`** per request (`run-chat-${crypto.randomUUID()}`) and use it consistently across all `platform.events.create()` calls in that request
- Store `ArelisPlatform` as a module-level singleton (same as `ArelisClient`) — initialize once, reuse across requests
- **Run the full governance post-stream pipeline** after every successful model call
