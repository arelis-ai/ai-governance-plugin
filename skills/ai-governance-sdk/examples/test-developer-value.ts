/**
 * Arelis Governance Platform — End-to-End Developer Demo
 *
 * Demonstrates the full governance lifecycle:
 *   1. PII scanning + policy gate (block / allow) before model invocation
 *   2. Real LLM calls through Gemini and Claude, gated by the SDK
 *   3. Governed agent with Gemini 2.5 Flash function calling (tool use)
 *   4. Audit event recording for every action (blocked, allowed, tool calls, agent steps)
 *   5. Runtime risk scoring with escalating signal severity
 *   6. Causal graph construction, commit, and lineage traversal
 *   7. Compliance proof generation and cryptographic verification
 *
 * Usage:
 *   npx tsx scripts/test-developer-value.ts
 *
 * NOTE:
 *   This is a legacy split-client demo. For SDK 1.2.1+ platform-first orchestration,
 *   use examples/test-platform-first-governance.ts.
 *
 * Required env vars (from .env):
 *   ARELIS_API_KEY      — Arelis sandbox API key (ak_sandbox_...)
 *   ARELIS_API_URL      — API base URL (defaults to http://localhost:3000)
 *   GEMINI_API_KEY      — Google AI Studio key
 *   ANTHROPIC_API_KEY   — Anthropic API key
 */

import "dotenv/config";
import { ArelisPlatform } from "@arelis-ai/ai-governance-sdk";
import { GoogleGenAI, Type } from "@google/genai";
import Anthropic from "@anthropic-ai/sdk";
import {
  scanPromptForPii,
  createGovernanceGateEvaluator,
  withGovernanceGate,
  type GovernanceContext,
  type GovernanceGateEvaluatePolicyInput,
  type PolicyResult,
  type ScanPromptForPiiOptions,
} from "@arelis-ai/ai-governance-sdk";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PlatformDecision {
  decision: string;
  policyId: string;
  metadata?: { policyName?: string; severity?: string };
}

interface EventRef {
  eventId: string;
  eventType: string;
  action: string;
  timestamp: string;
}

interface ScenarioResult {
  label: string;
  runId: string;
  invoked: boolean;
  decision: string;
  events: EventRef[];
}

interface RiskResult {
  label: string;
  action: string;
  score: number;
}

interface ProofResult {
  label: string;
  proofId: string;
  proofHash: string;
  verified: boolean;
}

interface GraphResult {
  label: string;
  runId: string;
  rootHash: string;
  nodeCount: number;
  edgeCount: number;
}

interface AgentResult {
  label: string;
  runId: string;
  steps: number;
  toolCalls: number;
  finalAnswer: string;
  events: EventRef[];
}

// ---------------------------------------------------------------------------
// Environment validation
// ---------------------------------------------------------------------------

const REQUIRED_ENV = ["ARELIS_API_KEY", "GEMINI_API_KEY", "ANTHROPIC_API_KEY"] as const;

for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`Missing required env var: ${key}`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Client initialization
// ---------------------------------------------------------------------------

const arelis = new ArelisPlatform({
  baseUrl: process.env.ARELIS_API_URL ?? "http://localhost:3000",
  apiKey: process.env.ARELIS_API_KEY,
  maxRetries: 3,
  timeout: 30_000,
});

const gemini = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

// ---------------------------------------------------------------------------
// PII redactor configuration
// ---------------------------------------------------------------------------

const redactorConfig: ScanPromptForPiiOptions["redactorConfig"] = {
  detectEmails: true,
  detectPhones: false,
  detectApiKeys: true,
  customPatterns: [
    {
      name: "phone",
      type: "custom",
      pattern: /(?<!\d)(?:\+1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}(?!\d)/g,
    },
    {
      name: "ssn",
      type: "custom",
      pattern: /\b\d{3}[-.\s]?\d{2}[-.\s]?\d{4}\b/g,
    },
    {
      name: "credit_card",
      type: "custom",
      pattern: /\b(?:\d{4}[-.\s]?){3}\d{4}\b/g,
    },
  ],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function header(title: string) {
  console.log(`\n${"=".repeat(70)}`);
  console.log(`  ${title}`);
  console.log(`${"=".repeat(70)}\n`);
}

function section(title: string) {
  console.log(`--- ${title} ---\n`);
}

// ---------------------------------------------------------------------------
// 1. Policy setup
// ---------------------------------------------------------------------------

async function ensurePiiPolicy(): Promise<string> {
  const PII_POLICY_KEY = "pii-deny-before-invocation";
  const existing = await arelis.governance.policies.list({ search: PII_POLICY_KEY });
  const match = existing.data.find((p) => p.key === PII_POLICY_KEY);

  if (match) {
    console.log(`PII deny policy exists (id: ${match.id})`);
    return match.id;
  }

  const policy = await arelis.governance.policies.create({
    key: PII_POLICY_KEY,
    name: "PII Deny Before Model Invocation",
    description:
      "Denies model invocation when PII (SSN, email, phone, credit card) is detected in the prompt.",
    condition: { field: "content.pii_detected", operator: "eq", value: true },
    action: "deny",
    severity: "critical",
    priority: 1,
  });

  console.log(`PII deny policy created (id: ${policy.id})`);
  return policy.id;
}

// ---------------------------------------------------------------------------
// 2. Governance gate evaluator
// ---------------------------------------------------------------------------

function buildGateEvaluator(policyId: string) {
  return createGovernanceGateEvaluator({
    resolveContext: async (partial?: Partial<GovernanceContext>) => ({
      org: partial?.org ?? { id: "dev-org" },
      actor: partial?.actor ?? { id: "demo-user", type: "human" },
      purpose: partial?.purpose ?? "pre-invocation-gate",
      environment: partial?.environment ?? "dev",
    }),

    evaluatePolicy: async (input: GovernanceGateEvaluatePolicyInput): Promise<PolicyResult> => {
      const inputMessages = Array.isArray(input.data.input) ? input.data.input : [];
      const firstMessage = inputMessages[0] as { content?: string } | undefined;
      const prompt = firstMessage?.content ?? "";

      const pii = scanPromptForPii(prompt, { redactorConfig });
      const piiTypes = [...new Set(pii.findings.map((f) => f.pattern ?? f.type))];

      const evalResult = await arelis.governance.evaluatePolicy({
        runId: input.runId,
        checkpoint: {
          content: {
            pii_detected: pii.hasPii,
            pii_types: piiTypes,
            pii_count: pii.findings.length,
          },
        },
        policyIds: [policyId],
      });

      const decisions = (evalResult.decisions as PlatformDecision[]).map((d) => {
        if (d.decision === "deny") {
          return {
            effect: "block" as const,
            reason: `Denied by ${d.metadata?.policyName ?? d.policyId}`,
            code: `PII_DENY_${d.policyId}`,
          };
        }
        return { effect: "allow" as const };
      });

      const firstBlock = decisions.find((d) => d.effect === "block") as
        | { effect: "block"; reason: string; code: string }
        | undefined;

      return {
        decisions,
        summary: firstBlock
          ? { allowed: false, blockReason: firstBlock.reason, blockCode: firstBlock.code }
          : { allowed: true },
      };
    },
  });
}

// ---------------------------------------------------------------------------
// 3. Governance gate scenarios
// ---------------------------------------------------------------------------

async function runGovernanceScenarios(policyId: string): Promise<ScenarioResult[]> {
  const gateEvaluator = buildGateEvaluator(policyId);
  const results: ScenarioResult[] = [];

  // Scenario A: PII prompt → should be BLOCKED before reaching Gemini
  section("Scenario A: Prompt with PII → Gemini");

  const piiPrompt =
    "My name is John Smith, SSN 423-91-0482, email john.smith@acmecorp.com. Help me file taxes.";

  const gateA = await withGovernanceGate(
    gateEvaluator,
    {
      runId: `run-pii-${crypto.randomUUID()}`,
      prompt: piiPrompt,
      policyIds: [policyId],
      model: "gemini-2.0-flash",
      actor: { id: "demo-user", type: "human" },
      context: { environment: "dev", purpose: "pii-test" },
    },
    async () => {
      const result = await gemini.models.generateContent({
        model: "gemini-2.0-flash",
        contents: piiPrompt,
      });
      return result.text ?? "";
    },
    { denyMode: "return", redactorConfig },
  );

  const piiTypes = [...new Set(gateA.decision.pii.findings.map((f) => f.pattern ?? f.type))];

  console.log(`PII detected: ${gateA.decision.pii.hasPii}`);
  for (const f of gateA.decision.pii.findings) {
    console.log(`  ${f.pattern ?? f.type}: "${f.original}"`);
  }
  console.log(`Decision: ${gateA.decision.decision} | Model invoked: ${gateA.invoked}`);

  const eventsA: EventRef[] = [];

  if (!gateA.invoked) {
    const ts = new Date().toISOString();
    const ev = await arelis.events.create({
      runId: gateA.runId,
      eventType: "model_invocation_blocked",
      actor: { type: "human", id: "demo-user" },
      resource: { type: "model", id: "gemini-2.0-flash" },
      action: "blocked_by_policy",
      timestamp: ts,
      metadata: {
        pii_types: piiTypes,
        pii_count: gateA.decision.pii.findings.length,
        policy_decision: gateA.decision.decision,
        blocking_policy: policyId,
      },
    });
    eventsA.push({
      eventId: ev.eventId,
      eventType: "model_invocation_blocked",
      action: "blocked_by_policy",
      timestamp: ts,
    });
    console.log("Audit event recorded: model_invocation_blocked\n");
  }

  results.push({
    label: "A (PII → Gemini)",
    runId: gateA.runId,
    invoked: gateA.invoked,
    decision: gateA.decision.decision,
    events: eventsA,
  });

  // Scenario B: Clean prompt → should PASS and call Gemini
  section("Scenario B: Clean prompt → Gemini");

  const cleanPrompt =
    "Explain the key principles of AI governance for enterprise compliance in three sentences.";

  const gateB = await withGovernanceGate(
    gateEvaluator,
    {
      runId: `run-clean-${crypto.randomUUID()}`,
      prompt: cleanPrompt,
      policyIds: [policyId],
      model: "gemini-2.0-flash",
      actor: { id: "demo-user", type: "human" },
      context: { environment: "dev", purpose: "clean-test" },
    },
    async () => {
      const result = await gemini.models.generateContent({
        model: "gemini-2.0-flash",
        contents: cleanPrompt,
      });
      return result.text ?? "";
    },
    { denyMode: "return", redactorConfig },
  );

  console.log(`PII detected: ${gateB.decision.pii.hasPii}`);
  console.log(`Decision: ${gateB.decision.decision} | Model invoked: ${gateB.invoked}`);

  const eventsB: EventRef[] = [];

  if (gateB.invoked && gateB.result) {
    const ts1 = new Date().toISOString();
    const ev1 = await arelis.events.create({
      runId: gateB.runId,
      eventType: "model.invoked",
      actor: { type: "human", id: "demo-user" },
      resource: { type: "model", id: "gemini-2.0-flash" },
      action: "inference",
      timestamp: ts1,
      metadata: { responseLength: gateB.result.length, policy_decision: gateB.decision.decision },
    });
    eventsB.push({
      eventId: ev1.eventId,
      eventType: "model.invoked",
      action: "inference",
      timestamp: ts1,
    });

    const ts2 = new Date().toISOString();
    const ev2 = await arelis.events.create({
      runId: gateB.runId,
      eventType: "output.delivered",
      actor: { type: "human", id: "demo-user" },
      resource: { type: "model", id: "gemini-2.0-flash" },
      action: "deliver",
      timestamp: ts2,
      metadata: { outputLength: gateB.result.length, containsPII: false },
    });
    eventsB.push({
      eventId: ev2.eventId,
      eventType: "output.delivered",
      action: "deliver",
      timestamp: ts2,
    });

    console.log(`Response: "${gateB.result.slice(0, 150)}..."`);
    console.log("Audit events recorded: model.invoked, output.delivered\n");
  }

  results.push({
    label: "B (Clean → Gemini)",
    runId: gateB.runId,
    invoked: gateB.invoked,
    decision: gateB.decision.decision,
    events: eventsB,
  });

  // Scenario C: Clean prompt → should PASS and call Claude
  section("Scenario C: Clean prompt → Claude");

  const claudePrompt =
    "What are the three most important considerations when building compliant AI systems for regulated industries?";

  const gateC = await withGovernanceGate(
    gateEvaluator,
    {
      runId: `run-claude-${crypto.randomUUID()}`,
      prompt: claudePrompt,
      policyIds: [policyId],
      model: "claude-sonnet-4-5-20250929",
      actor: { id: "demo-user", type: "human" },
      context: { environment: "dev", purpose: "claude-test" },
    },
    async () => {
      const message = await anthropic.messages.create({
        model: "claude-sonnet-4-5-20250929",
        max_tokens: 300,
        messages: [{ role: "user", content: claudePrompt }],
      });
      const textBlock = message.content.find((b) => b.type === "text");
      return textBlock?.text ?? "";
    },
    { denyMode: "return", redactorConfig },
  );

  console.log(`PII detected: ${gateC.decision.pii.hasPii}`);
  console.log(`Decision: ${gateC.decision.decision} | Model invoked: ${gateC.invoked}`);

  const eventsC: EventRef[] = [];

  if (gateC.invoked && gateC.result) {
    const ts1 = new Date().toISOString();
    const ev1 = await arelis.events.create({
      runId: gateC.runId,
      eventType: "model.invoked",
      actor: { type: "human", id: "demo-user" },
      resource: { type: "model", id: "claude-sonnet-4-5-20250929" },
      action: "inference",
      timestamp: ts1,
      metadata: { responseLength: gateC.result.length, policy_decision: gateC.decision.decision },
    });
    eventsC.push({
      eventId: ev1.eventId,
      eventType: "model.invoked",
      action: "inference",
      timestamp: ts1,
    });

    const ts2 = new Date().toISOString();
    const ev2 = await arelis.events.create({
      runId: gateC.runId,
      eventType: "output.delivered",
      actor: { type: "human", id: "demo-user" },
      resource: { type: "model", id: "claude-sonnet-4-5-20250929" },
      action: "deliver",
      timestamp: ts2,
      metadata: { outputLength: gateC.result.length, containsPII: false },
    });
    eventsC.push({
      eventId: ev2.eventId,
      eventType: "output.delivered",
      action: "deliver",
      timestamp: ts2,
    });

    console.log(`Response: "${gateC.result.slice(0, 150)}..."`);
    console.log("Audit events recorded: model.invoked, output.delivered\n");
  }

  results.push({
    label: "C (Clean → Claude)",
    runId: gateC.runId,
    invoked: gateC.invoked,
    decision: gateC.decision.decision,
    events: eventsC,
  });

  return results;
}

// ---------------------------------------------------------------------------
// 4. Risk scoring scenarios
// ---------------------------------------------------------------------------

async function runRiskScenarios(
  piiRunId: string,
  cleanRunId: string,
  policyId: string,
): Promise<RiskResult[]> {
  const results: RiskResult[] = [];

  // D: Low risk — all policies allowed, low quota, benign signals
  section("Risk D: Low risk — clean invocation");

  const riskD = await arelis.risk.evaluate({
    runId: cleanRunId,
    policyDecisions: [{ policyId, decision: "allow", severity: "low" }],
    quotaState: {
      audit_event: { used: 4500, limit: 100_000 },
      compliance_proof: { used: 23, limit: 500 },
    },
    evaluationSignals: [
      { name: "model_latency_ms", value: 340, severity: "low" },
      { name: "output_toxicity_score", value: 0.02, severity: "low" },
      { name: "hallucination_confidence", value: 0.12, severity: "medium" },
    ],
  });

  console.log(`Action: ${riskD.action} | Score: ${riskD.score}`);
  console.log(`Hash:   ${riskD.deterministicInputsHash}\n`);
  results.push({ label: "D (Low risk)", action: riskD.action, score: riskD.score });

  // E: Medium risk — policy denied, moderate quota, elevated signals
  section("Risk E: Medium risk — PII blocked + elevated signals");

  const riskE = await arelis.risk.evaluate({
    runId: piiRunId,
    policyDecisions: [{ policyId, decision: "deny", severity: "critical" }],
    quotaState: {
      audit_event: { used: 72_000, limit: 100_000 },
      compliance_proof: { used: 410, limit: 500 },
    },
    evaluationSignals: [
      { name: "pii_detected", value: 1, severity: "high" },
      { name: "output_toxicity_score", value: 0.35, severity: "medium" },
      { name: "hallucination_confidence", value: 0.45, severity: "medium" },
    ],
  });

  console.log(`Action: ${riskE.action} | Score: ${riskE.score}`);
  console.log(`Hash:   ${riskE.deterministicInputsHash}\n`);
  results.push({ label: "E (Medium risk)", action: riskE.action, score: riskE.score });

  // F: High risk — multiple denials, quota exhausted, all high-severity signals
  section("Risk F: High risk — multiple denials + quota exhausted");

  const riskF = await arelis.risk.evaluate({
    runId: `run-risk-high-${crypto.randomUUID()}`,
    policyDecisions: [
      { policyId, decision: "deny", severity: "critical" },
      { policyId: "policy-content-safety", decision: "deny", severity: "critical" },
    ],
    quotaState: {
      audit_event: { used: 99_800, limit: 100_000 },
      compliance_proof: { used: 498, limit: 500 },
    },
    evaluationSignals: [
      { name: "pii_detected", value: 1, severity: "high" },
      { name: "output_toxicity_score", value: 0.92, severity: "high" },
      { name: "hallucination_confidence", value: 0.87, severity: "high" },
      { name: "prompt_injection_score", value: 0.95, severity: "high" },
    ],
  });

  console.log(`Action: ${riskF.action} | Score: ${riskF.score}`);
  console.log(`Hash:   ${riskF.deterministicInputsHash}\n`);
  results.push({ label: "F (High risk)", action: riskF.action, score: riskF.score });

  return results;
}

// ---------------------------------------------------------------------------
// 5. Causal graph construction, commit, and lineage
// ---------------------------------------------------------------------------

async function buildAndCommitGraph(scenario: ScenarioResult): Promise<GraphResult | null> {
  section(`Graph: ${scenario.label}`);

  if (scenario.events.length === 0) {
    console.log("No events recorded — skipping graph\n");
    return null;
  }

  // Build nodes from recorded events
  const nodes = scenario.events.map((ev) => ({
    id: ev.eventId,
    type: ev.eventType,
    data: {
      action: ev.action,
      timestamp: ev.timestamp,
    } as Record<string, unknown>,
  }));

  // Build sequence edges (temporal ordering)
  const edges: { source: string; target: string; type: string }[] = [];
  for (let i = 1; i < scenario.events.length; i++) {
    edges.push({
      source: scenario.events[i - 1].eventId,
      target: scenario.events[i].eventId,
      type: "sequence",
    });
  }

  console.log(`Nodes: ${nodes.length} | Edges: ${edges.length}`);
  for (const n of nodes) {
    console.log(`  [${n.type}] ${n.id}`);
  }
  for (const e of edges) {
    console.log(`  ${e.source.slice(0, 12)}... → ${e.target.slice(0, 12)}... (${e.type})`);
  }

  // Submit the causal graph (upserts CausalGraphRecord + creates replay job)
  await arelis.replay.startCausalGraph({
    runId: scenario.runId,
    nodes,
    edges,
  });
  console.log("Graph submitted");

  // Commit the graph — computes and stores the rootHash (SHA-256)
  const commit = await arelis.graphs.commit(scenario.runId);
  console.log(`Committed:  rootHash=${commit.rootHash.slice(0, 16)}...`);

  // Query full lineage from the first node
  const lineage = await arelis.graphs.lineage(scenario.runId, nodes[0].id);
  console.log(`Lineage:    ${lineage.nodes.length} node(s), ${lineage.edges.length} edge(s)\n`);

  return {
    label: scenario.label,
    runId: scenario.runId,
    rootHash: commit.rootHash,
    nodeCount: lineage.nodes.length,
    edgeCount: lineage.edges.length,
  };
}

// ---------------------------------------------------------------------------
// 6. Compliance proof generation + verification
// ---------------------------------------------------------------------------

const PROOF_LAYERS: ("event_integrity" | "causal_consistency" | "policy_compliance")[] = [
  "event_integrity",
  "causal_consistency",
  "policy_compliance",
];

async function generateAndVerifyProof(runId: string, label: string): Promise<ProofResult | null> {
  section(`Proof: ${label}`);

  const proof = await arelis.proofs.create({
    runId,
    schemaVersion: "v2",
    composed: { layers: PROOF_LAYERS },
  });

  if ("jobId" in proof) {
    console.error("Unexpected async response — proof worker may not be running");
    return null;
  }

  console.log(`Proof ID:   ${proof.proofId}`);
  console.log(`Proof hash: ${proof.proofHash}`);
  console.log(`Layers:     ${proof.layers.map((l) => l.name).join(", ")}`);

  const verification = await arelis.proofs.verify({ proofId: proof.proofId });

  console.log(`Verified:   ${verification.verified}`);
  for (const layer of verification.layers) {
    console.log(`  ${layer.name}: ${layer.passed ? "PASS" : "FAIL"}`);
  }
  console.log();

  return {
    label,
    proofId: proof.proofId,
    proofHash: proof.proofHash,
    verified: verification.verified,
  };
}

// ---------------------------------------------------------------------------
// 7. Agent scenario — Gemini 2.5 Flash with function calling
// ---------------------------------------------------------------------------

const lookupRegulationDecl = {
  name: "lookupRegulation",
  description:
    "Look up details about a specific compliance regulation or framework (e.g. EU AI Act, GDPR, SOC2).",
  parameters: {
    type: Type.OBJECT,
    properties: {
      regulationName: {
        type: Type.STRING,
        description: "Name of the regulation or framework to look up",
      },
    },
    required: ["regulationName"],
  },
};

const checkComplianceStatusDecl = {
  name: "checkComplianceStatus",
  description: "Check the organization's current compliance status for a specific regulation.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      regulationId: {
        type: Type.STRING,
        description: "The regulation identifier (e.g. eu-ai-act, gdpr, soc2)",
      },
    },
    required: ["regulationId"],
  },
};

const AGENT_TOOLS = [{ functionDeclarations: [lookupRegulationDecl, checkComplianceStatusDecl] }];

/** Simulated tool execution — returns realistic compliance data */
function executeToolCall(name: string, args: Record<string, unknown>): Record<string, unknown> {
  if (name === "lookupRegulation") {
    const reg = String(args.regulationName ?? "").toLowerCase();
    if (reg.includes("eu ai act") || reg.includes("ai act")) {
      return {
        id: "eu-ai-act",
        name: "EU Artificial Intelligence Act",
        jurisdiction: "European Union",
        effectiveDate: "2025-08-01",
        riskCategories: ["unacceptable", "high", "limited", "minimal"],
        keyRequirements: [
          "Risk classification for all AI systems",
          "Conformity assessment for high-risk systems",
          "Transparency obligations for limited-risk systems",
          "Human oversight mechanisms",
          "Technical documentation and logging",
        ],
        penaltyRange: "Up to 35M EUR or 7% of global annual turnover",
      };
    }
    return {
      id: "unknown",
      name: String(args.regulationName),
      error: "Regulation not found in database",
    };
  }

  if (name === "checkComplianceStatus") {
    const regId = String(args.regulationId ?? "");
    if (regId === "eu-ai-act") {
      return {
        regulationId: "eu-ai-act",
        organizationId: "org_arelis",
        overallStatus: "partially_compliant",
        lastAssessmentDate: "2025-12-15",
        controls: [
          { name: "Risk Classification", status: "compliant", score: 0.95 },
          { name: "Transparency Obligations", status: "compliant", score: 0.88 },
          { name: "Human Oversight", status: "in_progress", score: 0.65 },
          { name: "Technical Documentation", status: "in_progress", score: 0.72 },
          { name: "Conformity Assessment", status: "not_started", score: 0.0 },
        ],
        nextReviewDate: "2026-03-01",
      };
    }
    return { regulationId: regId, error: "No compliance data found" };
  }

  return { error: `Unknown tool: ${name}` };
}

async function runAgentScenario(policyId: string): Promise<AgentResult> {
  const runId = `run-agent-${crypto.randomUUID()}`;
  const events: EventRef[] = [];
  let stepCount = 0;
  let toolCallCount = 0;

  const agentPrompt =
    "What EU AI Act compliance requirements apply to our high-risk AI classification system, " +
    "and what is our current compliance status? Provide a brief summary.";

  section("Scenario G: Governed Agent with Tool Use (Gemini 2.5 Flash)");
  console.log(`Run ID: ${runId}`);
  console.log(`Prompt: "${agentPrompt}"\n`);

  // Step 1: PII scan + policy gate before agent execution
  const pii = scanPromptForPii(agentPrompt, { redactorConfig });
  console.log(`PII scan: hasPii=${pii.hasPii}`);

  const evalResult = await arelis.governance.evaluatePolicy({
    runId,
    checkpoint: { content: { pii_detected: pii.hasPii, pii_types: [], pii_count: 0 } },
    policyIds: [policyId],
  });
  const decisions = evalResult.decisions as PlatformDecision[];
  const denied = decisions.some((d) => d.decision === "deny");
  console.log(`Policy gate: ${denied ? "DENIED" : "ALLOWED"}\n`);

  if (denied) {
    const ts = new Date().toISOString();
    const ev = await arelis.events.create({
      runId,
      eventType: "model_invocation_blocked",
      actor: { type: "agent", id: "compliance-agent" },
      resource: { type: "model", id: "gemini-2.5-flash" },
      action: "blocked_by_policy",
      timestamp: ts,
      metadata: { policy_decision: "deny", blocking_policy: policyId },
    });
    events.push({
      eventId: ev.eventId,
      eventType: "model_invocation_blocked",
      action: "blocked_by_policy",
      timestamp: ts,
    });

    return { label: "G (Agent → Gemini)", runId, steps: 0, toolCalls: 0, finalAnswer: "", events };
  }

  // Step 2: Agent step 1 — initial reasoning + model call with tools
  stepCount++;
  const ts1 = new Date().toISOString();
  const evStep1 = await arelis.events.create({
    runId,
    eventType: "agent.step",
    actor: { type: "agent", id: "compliance-agent" },
    resource: { type: "model", id: "gemini-2.5-flash" },
    action: "reason",
    timestamp: ts1,
    metadata: { step: stepCount, phase: "initial_reasoning", prompt: agentPrompt },
  });
  events.push({
    eventId: evStep1.eventId,
    eventType: "agent.step",
    action: "reason",
    timestamp: ts1,
  });
  console.log(`Agent step ${stepCount}: Initial reasoning — calling Gemini with tools`);

  // Build conversation history for multi-turn function calling
  const contents: Array<{ role: string; parts: Array<Record<string, unknown>> }> = [
    { role: "user", parts: [{ text: agentPrompt }] },
  ];

  // Agentic loop: keep calling Gemini until it returns text (no more function calls)
  const MAX_TURNS = 5;
  let finalAnswer = "";

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const response = await gemini.models.generateContent({
      model: "gemini-2.5-flash",
      contents,
      config: { tools: AGENT_TOOLS },
    });

    const calls = response.functionCalls ?? [];

    // If no function calls, Gemini returned a final text answer
    if (calls.length === 0) {
      finalAnswer = response.text ?? "";
      break;
    }

    console.log(`Gemini returned ${calls.length} function call(s) (turn ${turn + 1})`);

    // Add model's function call response to conversation
    contents.push({
      role: "model",
      parts: calls.map((fc) => ({
        functionCall: { name: fc.name, args: fc.args },
      })),
    });

    // Execute each tool and log events
    const functionResponses: Array<Record<string, unknown>> = [];

    for (const fc of calls) {
      toolCallCount++;
      const toolName = fc.name ?? "unknown";
      const toolArgs = (fc.args ?? {}) as Record<string, unknown>;

      // Log tool.call event
      const tsCall = new Date().toISOString();
      const evCall = await arelis.events.create({
        runId,
        eventType: "tool.call",
        actor: { type: "agent", id: "compliance-agent" },
        resource: { type: "tool", id: toolName },
        action: "invoke",
        timestamp: tsCall,
        metadata: { toolName, args: toolArgs, step: stepCount },
      });
      events.push({
        eventId: evCall.eventId,
        eventType: "tool.call",
        action: "invoke",
        timestamp: tsCall,
      });
      console.log(`  tool.call: ${toolName}(${JSON.stringify(toolArgs)})`);

      // Execute tool
      const toolResult = executeToolCall(toolName, toolArgs);

      // Log tool.result event
      const tsResult = new Date().toISOString();
      const evResult = await arelis.events.create({
        runId,
        eventType: "tool.result",
        actor: { type: "agent", id: "compliance-agent" },
        resource: { type: "tool", id: toolName },
        action: "complete",
        timestamp: tsResult,
        metadata: {
          toolName,
          success: !("error" in toolResult),
          resultKeys: Object.keys(toolResult),
        },
      });
      events.push({
        eventId: evResult.eventId,
        eventType: "tool.result",
        action: "complete",
        timestamp: tsResult,
      });
      console.log(`  tool.result: ${toolName} → ${Object.keys(toolResult).length} fields`);

      functionResponses.push({
        functionResponse: { name: toolName, response: toolResult },
      });
    }

    // Send tool results back to Gemini for next turn
    contents.push({ role: "user", parts: functionResponses });
  }

  // Final agent step — synthesis
  stepCount++;
  console.log(`\nAgent step ${stepCount}: Synthesized final answer`);

  const ts2 = new Date().toISOString();
  const evStep2 = await arelis.events.create({
    runId,
    eventType: "agent.step",
    actor: { type: "agent", id: "compliance-agent" },
    resource: { type: "model", id: "gemini-2.5-flash" },
    action: "synthesize",
    timestamp: ts2,
    metadata: { step: stepCount, phase: "synthesis", responseLength: finalAnswer.length },
  });
  events.push({
    eventId: evStep2.eventId,
    eventType: "agent.step",
    action: "synthesize",
    timestamp: ts2,
  });

  // Step 4: Log output delivery
  const ts3 = new Date().toISOString();
  const evOutput = await arelis.events.create({
    runId,
    eventType: "output.delivered",
    actor: { type: "agent", id: "compliance-agent" },
    resource: { type: "model", id: "gemini-2.5-flash" },
    action: "deliver",
    timestamp: ts3,
    metadata: {
      outputLength: finalAnswer.length,
      containsPII: false,
      totalSteps: stepCount,
      totalToolCalls: toolCallCount,
    },
  });
  events.push({
    eventId: evOutput.eventId,
    eventType: "output.delivered",
    action: "deliver",
    timestamp: ts3,
  });

  console.log(`\nFinal answer (${finalAnswer.length} chars):`);
  console.log(`"${finalAnswer.slice(0, 200)}${finalAnswer.length > 200 ? "..." : ""}"`);
  console.log(
    `\nEvents: ${events.length} total (${stepCount} steps, ${toolCallCount} tool calls)\n`,
  );

  return {
    label: "G (Agent → Gemini)",
    runId,
    steps: stepCount,
    toolCalls: toolCallCount,
    finalAnswer,
    events,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  header("Arelis Governance Platform — End-to-End Demo");

  // 1. Policy setup
  header("1. Policy Setup");
  const policyId = await ensurePiiPolicy();

  // 2. Governance gate scenarios (real LLM calls)
  header("2. Governance Gate — PII Scanning + Policy Enforcement");
  const scenarios = await runGovernanceScenarios(policyId);

  // 3. Agent scenario (Gemini 2.5 Flash with function calling)
  header("3. Governed Agent — Tool Use + Step Tracking");
  const agentResult = await runAgentScenario(policyId);

  // 4. Risk scoring
  header("4. Runtime Risk Scoring");
  const risks = await runRiskScenarios(scenarios[0].runId, scenarios[1].runId, policyId);

  // 5. Causal graphs (governance scenarios + agent)
  header("5. Causal Graphs — Build, Commit + Lineage");
  const allGraphScenarios: ScenarioResult[] = [
    ...scenarios,
    {
      label: agentResult.label,
      runId: agentResult.runId,
      invoked: true,
      decision: "allow",
      events: agentResult.events,
    },
  ];
  const graphs: (GraphResult | null)[] = [];
  for (const s of allGraphScenarios) {
    graphs.push(await buildAndCommitGraph(s));
  }

  // 6. Compliance proofs (governance scenarios + agent)
  header("6. Compliance Proofs — Generate + Verify");
  const proofs: (ProofResult | null)[] = [];
  for (const s of allGraphScenarios) {
    proofs.push(await generateAndVerifyProof(s.runId, `${s.label}`));
  }

  // 7. Summary
  header("Summary");

  console.log("Governance Gate:");
  for (const s of scenarios) {
    const status = s.invoked ? "ALLOWED" : "BLOCKED";
    console.log(`  ${s.label.padEnd(22)} ${status.padEnd(10)} (${s.decision})`);
  }

  console.log("\nAgent (Tool Use):");
  console.log(
    `  ${agentResult.label.padEnd(22)} ${agentResult.steps} steps, ${agentResult.toolCalls} tool calls, ${agentResult.events.length} events`,
  );

  console.log("\nRisk Scoring:");
  for (const r of risks) {
    console.log(`  ${r.label.padEnd(22)} ${r.action.padEnd(10)} (score: ${r.score})`);
  }

  console.log("\nCausal Graphs:");
  for (const g of graphs) {
    if (g) {
      console.log(
        `  ${g.label.padEnd(22)} ${g.nodeCount} nodes, ${g.edgeCount} edges (hash: ${g.rootHash.slice(0, 16)}...)`,
      );
    } else {
      console.log(`  ${"(skipped)".padEnd(22)} no events`);
    }
  }

  console.log("\nCompliance Proofs:");
  for (const p of proofs) {
    const status = p ? (p.verified ? "VERIFIED" : "FAILED") : "ERROR";
    const label = p?.label ?? "unknown";
    console.log(`  ${label.padEnd(22)} ${status}`);
  }

  console.log();
}

main().catch((err) => {
  console.error("Script failed:", err);
  process.exit(1);
});
