/**
 * Comprehensive AI Governance SDK Demo (TypeScript)
 *
 * Demonstrates the full SDK surface in a single executable script:
 *
 *  Section 1 — Platform Setup & AI System Registration
 *  Section 2 — Managed PII Config + Local PII Scanning
 *  Section 3 — Policy Creation & Idempotent Upsert
 *  Section 4 — governedInvoke (blocked + allowed paths)
 *  Section 5 — withGovernanceGate (standalone gate wrapping external LLM)
 *  Section 6 — agents.run (multi-step tool loop with causal graph + proof + risk)
 *  Section 7 — Low-Level Runtime: createArelisClient with full composition
 *     7a: Model Registry + Mock Provider
 *     7b: Policy Engine (custom BeforeToolCall / AfterToolResult checkpoints)
 *     7c: Composite Audit Sink
 *     7d: Memory (write / read / list / delete)
 *     7e: Quotas (check / commit)
 *     7f: Prompt Templates (register / get / hash)
 *     7g: Secrets Resolution
 *     7h: Tool Registry + Agent Runtime (plan-execute-observe)
 *     7i: Knowledge Base RAG (manual retrieval + auto-grounding)
 *     7j: MCP Server Integration (discover + invoke)
 *     7k: Structured Output Validation
 *     7l: Streaming
 *     7m: Evaluations
 *     7n: Approval Workflow
 *  Section 8 — Manual Platform Pipeline
 *     8a: Platform Events (model.invoked, output.delivered, policy.evaluated)
 *     8b: Platform Policy Evaluation (evaluatePolicy)
 *     8c: Risk Evaluation
 *     8d: Compliance Proof (create + verify)
 *     8e: Causal Graph (startCausalGraph + commit)
 *  Section 9 — Error Handling Patterns
 *  Section 10 — Compliance Artifact & Replay (local)
 *
 * Usage:
 *   npx tsx skills/ai-governance-sdk/examples/comprehensive-governance-demo.ts
 *
 * Required env vars:
 *   ARELIS_API_KEY
 *   GEMINI_API_KEY
 *
 * Optional env vars:
 *   ARELIS_API_URL       (defaults to https://api.arelis.digital)
 *   ANTHROPIC_API_KEY    (enables Claude governedInvoke scenario)
 */

import dotenv from 'dotenv';
import path from 'path';

// Load .env.local from project root (fallback to .env)
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config(); // fallback

import {
  // ── Unified orchestrator ───────────────────────────────────────────────────
  createArelis,

  // ── Low-level client composition ───────────────────────────────────────────
  createArelisClient,
  createModelRegistry,
  createMockProvider,
  createAllowAllEngine,
  createDenyAllEngine,
  createPolicyModeEngine,

  // ── Audit sinks ────────────────────────────────────────────────────────────
  createConsoleSink,
  createMemorySink,
  createCompositeSink,

  // ── Governance gate helpers ────────────────────────────────────────────────
  scanPromptForPii,
  withGovernanceGate,
  evaluatePreInvocationGate,

  // ── Registries ─────────────────────────────────────────────────────────────
  createToolRegistry,
  createKBRegistry,
  createMemoryKBProvider,
  createMCPRegistry,
  createMockMCPTransport,
  createMemoryRegistry,
  createInMemoryMemoryProvider,
  createTemplateRegistry,
  createDataSourceRegistry,
  createInMemoryQuotaManager,
  createEnvSecretResolver,

  // ── Agent runtime ──────────────────────────────────────────────────────────
  createAgentRuntime,

  // ── Evaluations ────────────────────────────────────────────────────────────
  runEvaluations,

  // ── Compliance ─────────────────────────────────────────────────────────────
  replayAuditRun,

  // ── Utilities ──────────────────────────────────────────────────────────────
  generateRunId,
  computePromptHash,

  // ── Decision builders ──────────────────────────────────────────────────────
  allowDecision,
  blockDecision,
  transformDecision,

  // ── Error guards ───────────────────────────────────────────────────────────
  isPolicyBlockedError,
  isPolicyApprovalRequiredError,
  isEvaluationBlockedError,
  GovernanceGateDeniedError,
  PolicyApprovalRequiredError,

  // ── Platform ───────────────────────────────────────────────────────────────
  ArelisPlatform,

  // ── Types ──────────────────────────────────────────────────────────────────
  type GovernanceContext,
  type GovernedAgentTool,
  type AgentConversationMessage,
  type AgentModelResponse,
  type PolicyEngine,
  type PolicyInput,
  type PolicyResult,
  type ArelisClient,
  type AgentConfig,
  type AgentHandlers,
  type ToolDefinition,
} from '@arelis-ai/ai-governance-sdk';

import { GoogleGenAI, Type } from '@google/genai';

// ─── Env Validation ──────────────────────────────────────────────────────────

const REQUIRED_ENV = ['ARELIS_API_KEY', 'GEMINI_API_KEY'] as const;
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`Missing required env var: ${key}`);
    process.exit(1);
  }
}

// ─── Shared Governance Context ───────────────────────────────────────────────

const ctx: GovernanceContext = {
  org: { id: 'org-demo', name: 'Governance Demo Org' },
  actor: { type: 'human', id: 'user-demo', email: 'demo@example.com', roles: ['developer'] },
  purpose: 'comprehensive-demo',
  environment: 'dev',
  sessionId: `session-${Date.now()}`,
  tags: { demo: 'comprehensive' },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function header(title: string): void {
  console.log(`\n${'='.repeat(78)}`);
  console.log(`  ${title}`);
  console.log(`${'='.repeat(78)}\n`);
}

function section(title: string): void {
  console.log(`\n--- ${title} ---\n`);
}

function short(text: string, max = 160): string {
  return text.length <= max ? text : `${text.slice(0, max)}...`;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  SECTION 1 — Platform Setup & AI System Registration
// ═══════════════════════════════════════════════════════════════════════════════

async function section1_platformSetup() {
  header('1) Platform Setup & AI System Registration');

  // 1a. Create unified orchestrator (recommended for SDK 1.2.1+)
  const arelis = createArelis({
    platform: {
      apiKey: process.env.ARELIS_API_KEY!,
      ...(process.env.ARELIS_API_URL ? { baseUrl: process.env.ARELIS_API_URL } : {}),
      maxRetries: 3,
      timeout: 30_000,
    },
  });

  const platform = arelis.platform!;

  // 1b. Register AI system (idempotent)
  const MODEL_ID = 'gemini-2.5-flash';
  let aiSystemId: string;

  const { data: existing } = await platform.aiSystems.list({ type: 'model' });
  const match = existing.find((s) => s.modelRef === MODEL_ID && s.status === 'active');

  if (match) {
    aiSystemId = match.id;
    console.log(`AI system already registered: ${aiSystemId}`);
  } else {
    const record = await platform.aiSystems.register({
      name: MODEL_ID,
      type: 'model',
      provider: 'google',
      modelRef: MODEL_ID,
      description: `Governance demo model: ${MODEL_ID}`,
      metadata: { registeredAt: new Date().toISOString() },
      tags: ['demo', 'comprehensive'],
    });
    aiSystemId = record.id;
    console.log(`AI system registered: ${aiSystemId}`);
  }

  // 1c. Fetch system summary
  const summary = await platform.aiSystems.summary(aiSystemId).catch(() => null);
  if (summary) {
    console.log(`System summary: ${summary.events.total} events, ${summary.proofs.total} proofs`);
  }

  return { arelis, platform, aiSystemId, MODEL_ID };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  SECTION 2 — Managed PII Config + Local PII Scanning
// ═══════════════════════════════════════════════════════════════════════════════

async function section2_piiScanning(arelis: ReturnType<typeof createArelis>) {
  header('2) Managed PII Config + Local PII Scanning');

  // 2a. Fetch managed PII config from platform
  const managedConfig = await arelis.governance.getPiiConfig({ namespace: 'pii.default' });
  console.log(`Managed PII config loaded: ${JSON.stringify(Object.keys(managedConfig))}`);

  // 2b. Local PII scan with managed config
  const sensitivePrompt = 'My email is jane@acme.com, SSN 123-45-6789, call me at 555-867-5309';
  const scan = scanPromptForPii(sensitivePrompt, { redactorConfig: managedConfig });

  console.log(`PII detected: ${scan.hasPii}`);
  console.log(`Findings (${scan.findings.length}):`);
  for (const finding of scan.findings) {
    console.log(`  - ${finding.pattern ?? finding.type}: "${finding.original}"`);
  }

  // 2c. Scan a clean prompt
  const cleanPrompt = 'Explain the EU AI Act risk categories.';
  const cleanScan = scanPromptForPii(cleanPrompt);
  console.log(`\nClean prompt PII: ${cleanScan.hasPii} (findings: ${cleanScan.findings.length})`);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  SECTION 3 — Policy Creation & Idempotent Upsert
// ═══════════════════════════════════════════════════════════════════════════════

async function section3_policySetup(platform: ArelisPlatform): Promise<string> {
  header('3) Policy Creation & Idempotent Upsert');

  const policyKey = 'pii-deny-before-invocation';
  const listed = await platform.governance.policies.list({ search: policyKey });
  const existing = listed.data.find((p) => p.key === policyKey);

  if (existing) {
    console.log(`Policy already exists: ${existing.id} (key: ${policyKey})`);
    return existing.id;
  }

  const created = await platform.governance.policies.create({
    key: policyKey,
    name: 'PII Deny Before Model Invocation',
    description: 'Blocks model invocation when prompt-level PII is detected.',
    condition: { field: 'content.pii_detected', operator: 'eq', value: true },
    action: 'deny',
    severity: 'critical',
    priority: 1,
  });

  console.log(`Policy created: ${created.id}`);
  return created.id;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  SECTION 4 — governedInvoke (Blocked + Allowed Paths)
// ═══════════════════════════════════════════════════════════════════════════════

async function section4_governedInvoke(
  arelis: ReturnType<typeof createArelis>,
  policyId: string,
) {
  header('4) governedInvoke — Blocked & Allowed Paths');

  const gemini = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
  const model = 'gemini-2.5-flash';

  // 4a. Blocked scenario (PII in prompt)
  section('4a: Blocked Scenario (PII detected)');
  const blockedResult = await arelis.governedInvoke({
    runId: `run-blocked-${crypto.randomUUID()}`,
    model,
    prompt: 'My SSN is 423-91-0482 and my email is john.smith@acmecorp.com. Help file taxes.',
    policyIds: [policyId],
    context: { environment: 'dev', purpose: 'blocked-demo' },
    denyMode: 'return',
    invoke: async (sanitizedPrompt) => {
      const completion = await gemini.models.generateContent({ model, contents: sanitizedPrompt });
      return completion.text ?? '';
    },
  });

  console.log(`Run: ${blockedResult.runId}`);
  console.log(`Decision: ${blockedResult.decision.decision} | Invoked: ${blockedResult.invoked}`);
  console.log(`PII findings: ${blockedResult.decision.pii.findings.length}`);
  console.log(`Timings: scan=${blockedResult.decision.metadata.timings.scanMs}ms, policy=${blockedResult.decision.metadata.timings.policyEvalMs}ms, total=${blockedResult.decision.metadata.timings.totalMs}ms`);
  if (blockedResult.warnings?.length) {
    console.log(`Warnings: ${blockedResult.warnings.join(', ')}`);
  }

  // 4b. Allowed scenario (clean prompt)
  section('4b: Allowed Scenario (clean prompt)');
  const allowedResult = await arelis.governedInvoke({
    runId: `run-allowed-${crypto.randomUUID()}`,
    model,
    prompt: 'Explain three key AI governance controls for regulated industries.',
    policyIds: [policyId],
    context: { environment: 'dev', purpose: 'allowed-demo' },
    denyMode: 'return',
    invoke: async (sanitizedPrompt) => {
      const completion = await gemini.models.generateContent({ model, contents: sanitizedPrompt });
      return completion.text ?? '';
    },
  });

  console.log(`Run: ${allowedResult.runId}`);
  console.log(`Decision: ${allowedResult.decision.decision} | Invoked: ${allowedResult.invoked}`);
  if (allowedResult.result) {
    console.log(`Response: "${short(allowedResult.result)}"`);
  }
  if (allowedResult.risk) {
    console.log(`Risk: action=${allowedResult.risk.action}, score=${allowedResult.risk.score}`);
  }
  if (allowedResult.warnings?.length) {
    console.log(`Warnings: ${allowedResult.warnings.join(', ')}`);
  }

  // 4c. Optional Claude scenario
  if (process.env.ANTHROPIC_API_KEY) {
    section('4c: Allowed Scenario (Claude)');
    try {
      const anthropicModule = (await import('@anthropic-ai/sdk')) as {
        default: new (input: { apiKey: string }) => {
          messages: {
            create: (input: {
              model: string;
              max_tokens: number;
              messages: Array<{ role: 'user'; content: string }>;
            }) => Promise<{ content: Array<{ type: string; text?: string }> }>;
          };
        };
      };
      const anthropic = new anthropicModule.default({ apiKey: process.env.ANTHROPIC_API_KEY });

      const claudeResult = await arelis.governedInvoke({
        runId: `run-claude-${crypto.randomUUID()}`,
        model: 'claude-sonnet-4-5-20250929',
        prompt: 'What are three practical controls to reduce AI agent compliance risk?',
        policyIds: [policyId],
        context: { environment: 'dev', purpose: 'claude-demo' },
        denyMode: 'return',
        invoke: async (sanitizedPrompt) => {
          const message = await anthropic.messages.create({
            model: 'claude-sonnet-4-5-20250929',
            max_tokens: 300,
            messages: [{ role: 'user', content: sanitizedPrompt }],
          });
          return message.content.find((b) => b.type === 'text')?.text ?? '';
        },
      });

      console.log(`Run: ${claudeResult.runId}`);
      console.log(`Decision: ${claudeResult.decision.decision} | Invoked: ${claudeResult.invoked}`);
      if (claudeResult.result) console.log(`Response: "${short(claudeResult.result)}"`);
    } catch (err) {
      console.log(`Claude scenario skipped: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else {
    console.log('\n(Claude scenario skipped: ANTHROPIC_API_KEY not set)');
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  SECTION 5 — withGovernanceGate (Standalone)
// ═══════════════════════════════════════════════════════════════════════════════

async function section5_standaloneGate(platform: ArelisPlatform) {
  header('5) withGovernanceGate — Standalone Gate');

  // 5a. Evaluate pre-invocation gate directly
  section('5a: evaluatePreInvocationGate');
  const preGate = await evaluatePreInvocationGate(platform, {
    runId: generateRunId(),
    prompt: 'My credit card is 4111-1111-1111-1111',
    model: 'gemini-2.5-flash',
    actor: ctx.actor,
    context: ctx,
  });
  console.log(`Pre-gate decision: ${preGate.decision}`);
  if (preGate.decision === 'deny') console.log(`Reasons: ${JSON.stringify(preGate.reasons)}`);

  // 5b. Full gate wrapping an external model call
  section('5b: withGovernanceGate wrapping external call');
  const gateResult = await withGovernanceGate(
    platform,
    {
      runId: generateRunId(),
      prompt: 'Summarize best practices for AI model monitoring.',
      model: 'gemini-2.5-flash',
      actor: ctx.actor,
      context: ctx,
    },
    async () => {
      // Simulated external LLM call
      return 'Model monitoring requires drift detection, performance metrics, and bias audits.';
    },
    { denyMode: 'return' },
  );

  console.log(`Gate invoked: ${gateResult.invoked}`);
  console.log(`Decision: ${gateResult.decision.decision}`);
  console.log(`Timings: total=${gateResult.decision.metadata.timings.totalMs}ms`);
  if (gateResult.result) console.log(`Result: "${short(gateResult.result)}"`);
  for (const warning of gateResult.warnings ?? []) {
    console.warn(`Warning: ${warning}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  SECTION 6 — agents.run (Multi-Step Tool Loop)
// ═══════════════════════════════════════════════════════════════════════════════

async function section6_agentRun(
  arelis: ReturnType<typeof createArelis>,
  policyId: string,
) {
  header('6) agents.run — Multi-Step Governed Agent Loop');

  const gemini = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

  const toolDeclarations = [
    {
      name: 'lookupRegulation',
      description: 'Look up details for a regulation (EU AI Act, GDPR, SOC2).',
      parameters: {
        type: Type.OBJECT,
        properties: { regulationName: { type: Type.STRING, description: 'Regulation name' } },
        required: ['regulationName'],
      },
    },
    {
      name: 'checkComplianceStatus',
      description: 'Return compliance status for a regulation identifier.',
      parameters: {
        type: Type.OBJECT,
        properties: { regulationId: { type: Type.STRING, description: 'Regulation id' } },
        required: ['regulationId'],
      },
    },
    {
      name: 'generateReport',
      description: 'Generate a compliance report for the given regulation.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          regulationId: { type: Type.STRING, description: 'Regulation id' },
          format: { type: Type.STRING, description: 'Report format (summary, detailed)' },
        },
        required: ['regulationId'],
      },
    },
  ];

  const agentTools: GovernedAgentTool[] = toolDeclarations.map((t) => ({
    name: t.name,
    description: t.description,
    schema: t.parameters as unknown as Record<string, unknown>,
  }));

  function executeTool(name: string, args: Record<string, unknown>): Record<string, unknown> {
    if (name === 'lookupRegulation') {
      const regName = String(args.regulationName ?? '').toLowerCase();
      if (regName.includes('eu ai act') || regName.includes('ai act')) {
        return {
          id: 'eu-ai-act',
          name: 'EU Artificial Intelligence Act',
          riskCategories: ['unacceptable', 'high', 'limited', 'minimal'],
          keyRequirements: ['Risk classification', 'Conformity assessment', 'Human oversight', 'Transparency'],
        };
      }
      if (regName.includes('gdpr')) {
        return { id: 'gdpr', name: 'GDPR', keyRequirements: ['Lawful basis', 'Data minimization', 'Subject rights'] };
      }
      return { id: 'unknown', error: `Regulation not found: ${args.regulationName}` };
    }

    if (name === 'checkComplianceStatus') {
      return {
        regulationId: args.regulationId,
        overallStatus: 'partially_compliant',
        controls: [
          { name: 'Risk Classification', status: 'compliant', score: 0.95 },
          { name: 'Human Oversight', status: 'in_progress', score: 0.68 },
          { name: 'Transparency', status: 'compliant', score: 0.9 },
          { name: 'Conformity Assessment', status: 'not_started', score: 0.0 },
        ],
        nextReviewDate: '2026-04-01',
      };
    }

    if (name === 'generateReport') {
      return {
        report: `Compliance report for ${args.regulationId} (${args.format ?? 'summary'}): 3/4 controls addressed, overall risk score: moderate.`,
        generatedAt: new Date().toISOString(),
      };
    }

    return { error: `Unknown tool: ${name}` };
  }

  function toGeminiContents(
    messages: AgentConversationMessage[],
  ): Array<{ role: string; parts: Array<Record<string, unknown>> }> {
    const contents: Array<{ role: string; parts: Array<Record<string, unknown>> }> = [];
    for (const msg of messages) {
      if (msg.role === 'user') {
        contents.push({ role: 'user', parts: [{ text: msg.content }] });
      } else if (msg.role === 'assistant') {
        contents.push({ role: 'model', parts: [{ text: msg.content }] });
      } else {
        contents.push({
          role: 'user',
          parts: [{ functionResponse: { name: msg.name ?? 'tool', response: safeParse(msg.content) } }],
        });
      }
    }
    return contents;
  }

  function safeParse(raw: string): unknown {
    try { return JSON.parse(raw); } catch { return { raw }; }
  }

  const result = await arelis.agents.run({
    runId: `run-agent-${crypto.randomUUID()}`,
    model: 'gemini-2.5-flash',
    prompt: 'Look up the EU AI Act, check our compliance status, and generate a summary report.',
    tools: agentTools,
    policyIds: [policyId],
    context: { environment: 'dev', purpose: 'agent-comprehensive-demo' },
    maxSteps: 8,
    invokeModel: async ({ model, messages }) => {
      const response = await gemini.models.generateContent({
        model,
        contents: toGeminiContents(messages),
        config: { tools: [{ functionDeclarations: toolDeclarations }] },
      });

      const toolCalls = (response.functionCalls ?? []).map((call) => ({
        id: call.id ?? `tool_${crypto.randomUUID()}`,
        name: call.name ?? 'unknown',
        args: (call.args ?? {}) as Record<string, unknown>,
      }));

      const text = response.text;
      return {
        text: text ?? undefined,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        finishReason: toolCalls.length > 0 ? 'tool_call' : 'stop',
      } as AgentModelResponse;
    },
    executeToolCall: async ({ tool }) => executeTool(tool.name, tool.args),
    mapOutput: ({ finalResponse, steps }) =>
      finalResponse.text ?? `Agent completed with ${steps.length} step(s) but no final text.`,
  });

  console.log(`Run: ${result.runId}`);
  console.log(`Status: ${result.status}`);
  console.log(`Decision: ${result.decision.decision}`);
  console.log(`Steps: ${result.steps.length}`);
  console.log(`Events: ${result.events.length}`);
  console.log(`Graph: ${result.graph.nodes.length} nodes, ${result.graph.edges.length} edges`);
  console.log(`Platform events: ${result.platformEvents?.length ?? 0}`);
  console.log(`Proof: ${result.proof ? 'generated' : 'n/a'}`);
  console.log(`Risk: ${result.risk ? `action=${result.risk.action}, score=${result.risk.score}` : 'n/a'}`);
  console.log(`Output: "${short(result.output ?? '')}"`);
  if (result.warnings?.length) {
    console.log(`Warnings (${result.warnings.length}):`);
    for (const w of result.warnings) console.log(`  - ${w}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  SECTION 7 — Low-Level Runtime: createArelisClient Full Composition
// ═══════════════════════════════════════════════════════════════════════════════

async function section7_lowLevelRuntime() {
  header('7) Low-Level Runtime — createArelisClient Full Composition');

  // ── 7a: Model Registry + Mock Provider ─────────────────────────────────────
  section('7a: Model Registry + Mock Provider');
  const modelRegistry = createModelRegistry();
  modelRegistry.register(
    createMockProvider({
      id: 'mock',
      name: 'Mock Model Provider',
      supportedModels: ['mock-model'],
    }),
  );
  console.log('Model registry created with mock provider.');

  // ── 7b: Custom Policy Engine ───────────────────────────────────────────────
  section('7b: Custom Policy Engine (BeforeToolCall / AfterToolResult)');

  const customPolicyEngine: PolicyEngine = {
    async evaluate(input: PolicyInput): Promise<PolicyResult> {
      const { checkpoint, context, data } = input;

      if (checkpoint === 'BeforeToolCall') {
        const toolData = data as { toolName?: string; args?: Record<string, unknown>; trustLevel?: string };
        const serializedArgs = JSON.stringify(toolData.args ?? {});
        const piiResult = scanPromptForPii(serializedArgs);

        if (piiResult.hasPii && context.environment === 'prod') {
          return {
            decisions: [blockDecision('PII detected in tool arguments', 'TOOL_ARGS_PII')],
            summary: { allowed: false, blockReason: 'Tool call blocked: PII in arguments' },
          };
        }

        if (toolData.trustLevel === 'high' && context.environment === 'prod') {
          return {
            decisions: [blockDecision('High-trust tool requires escalation', 'HIGH_TRUST_BLOCKED')],
            summary: { allowed: false, blockReason: 'Tool requires escalation approval' },
          };
        }
      }

      if (checkpoint === 'AfterToolResult') {
        const outputStr = JSON.stringify((data as { output?: unknown })?.output ?? '');
        if (/(?:api[_-]?key|secret|password|bearer\s+token|access[_-]?token)\s*[:=]\s*\S{8,}/i.test(outputStr)) {
          return {
            decisions: [transformDecision('Credential pattern detected in tool output')],
            summary: { allowed: true, warnings: ['Tool output contained credential-like patterns'] },
          };
        }
      }

      return { decisions: [allowDecision()], summary: { allowed: true } };
    },
  };

  const enforcedEngine = createPolicyModeEngine(customPolicyEngine, 'enforce');
  console.log('Custom policy engine created with enforce mode.');

  // ── 7c: Composite Audit Sink ───────────────────────────────────────────────
  section('7c: Composite Audit Sink');
  const memorySink = createMemorySink();
  const auditSink = createCompositeSink([
    createConsoleSink({ pretty: true, timestamp: true }),
    memorySink,
  ]);
  console.log('Composite audit sink created (console + memory).');

  // ── Build full client ──────────────────────────────────────────────────────
  const memoryRegistry = createMemoryRegistry();
  memoryRegistry.register(createInMemoryMemoryProvider());

  const toolRegistry = createToolRegistry({ allowOverwrite: false });
  const kbRegistry = createKBRegistry();
  const mcpRegistry = createMCPRegistry();
  const promptRegistry = createTemplateRegistry();
  const dataSourceRegistry = createDataSourceRegistry();

  const client = createArelisClient({
    modelRegistry,
    policyEngine: enforcedEngine,
    auditSink,
    memoryRegistry,
    toolRegistry,
    kbRegistry,
    mcpRegistry,
    promptRegistry,
    dataSourceRegistry,
    quotaManager: createInMemoryQuotaManager(),
    secretResolver: createEnvSecretResolver(),
  });
  console.log('\nFull ArelisClient created with all registries.\n');

  // ── 7d: Memory Operations ──────────────────────────────────────────────────
  section('7d: Memory (write / read / list / delete)');

  const memEntry = await client.memory.write({
    context: ctx,
    scope: 'conversation',
    key: 'user_preferences',
    value: { theme: 'dark', language: 'en', notifications: true },
    metadata: { ttlMs: 3_600_000 },
  });
  console.log(`Memory write: scope=${memEntry.scope}, key=${memEntry.key}`);

  await client.memory.write({
    context: ctx,
    scope: 'session',
    key: 'last_query',
    value: { query: 'AI governance controls', timestamp: Date.now() },
  });

  const readBack = await client.memory.read({ context: ctx, scope: 'conversation', key: 'user_preferences' });
  console.log(`Memory read: ${JSON.stringify(readBack?.value)}`);

  const allConv = await client.memory.list('conversation', ctx);
  console.log(`Memory list (conversation): ${allConv.length} entries`);

  await client.memory.delete({ context: ctx, scope: 'conversation', key: 'user_preferences' });
  console.log('Memory delete: user_preferences removed');

  // ── 7e: Quotas ─────────────────────────────────────────────────────────────
  section('7e: Quotas (check / commit)');

  const quotaDecision = await client.quotas.check(
    { type: 'user', id: 'user-demo', period: 'day' },
    { tokensIn: 50_000, requestsCount: 1 },
  );
  console.log(`Quota check: effect=${quotaDecision.effect}`);

  await client.quotas.commit(
    { type: 'user', id: 'user-demo', period: 'day' },
    { tokensIn: 48_231, tokensOut: 2_100, requestsCount: 1 },
  );
  console.log('Quota committed');

  // ── 7f: Prompt Templates ───────────────────────────────────────────────────
  section('7f: Prompt Templates (register / get / hash)');

  const template = await client.prompts.register({
    id: 'governance-check',
    version: '1.0.0',
    content: 'You are a compliance assistant for {{company}}. Analyze {{regulation}} requirements for {{system}}.',
  }, ctx);
  console.log(`Template registered: ${template.id} v${template.version}`);

  const retrieved = client.prompts.get({ id: 'governance-check', version: '1.0.0' });
  const hash = computePromptHash(retrieved!.content);
  console.log(`Template hash: ${hash.slice(0, 16)}...`);

  const allTemplates = client.prompts.list('governance-check');
  console.log(`Template versions: ${allTemplates.length}`);

  // ── 7g: Secrets Resolution ─────────────────────────────────────────────────
  section('7g: Secrets Resolution');

  try {
    const resolved = await client.secrets.resolve('GEMINI_API_KEY', ctx);
    console.log(`Secret resolved: GEMINI_API_KEY = ${resolved.slice(0, 8)}...`);
  } catch {
    console.log('Secret resolution: env-based resolver active');
  }

  // ── 7h: Tool Registry + Agent Runtime ──────────────────────────────────────
  section('7h: Tool Registry + Agent Runtime (plan-execute-observe)');

  const echoTool: ToolDefinition<{ message: string }, string> = {
    name: 'echo',
    description: 'Echoes back the provided message',
    schema: {
      type: 'object',
      properties: { message: { type: 'string', description: 'The message to echo' } },
      required: ['message'],
    },
    permissions: {
      scopes: ['read'],
      allowedActorTypes: ['human', 'service', 'agent'],
      allowedEnvironments: ['dev', 'staging', 'prod'],
    },
    handler: async (args) => `Echo: ${args.message}`,
  };
  toolRegistry.register(echoTool);

  const lookupTool: ToolDefinition<{ topic: string }, string> = {
    name: 'lookup',
    description: 'Looks up governance information',
    schema: {
      type: 'object',
      properties: { topic: { type: 'string', description: 'Topic to look up' } },
      required: ['topic'],
    },
    permissions: {
      scopes: ['read'],
      allowedActorTypes: ['human', 'service', 'agent'],
      allowedEnvironments: ['dev', 'staging', 'prod'],
    },
    handler: async (args) => `Governance info for ${args.topic}: EU AI Act requires risk classification.`,
  };
  toolRegistry.register(lookupTool);

  console.log(`Tools registered: echo, lookup`);

  const agentConfig: AgentConfig = {
    agentId: 'demo-agent',
    name: 'Comprehensive Demo Agent',
    description: 'Agent demonstrating plan-execute-observe loop',
    systemPrompt: 'You are a governance compliance assistant.',
    limits: { maxSteps: 5, maxTimeMs: 30_000 },
    context: ctx,
    tools: ['echo', 'lookup'],
  };

  const handlers: AgentHandlers = {
    async plan(input, step) {
      if (step.stepNumber === 1) {
        return {
          action: 'use_tool',
          reasoning: 'Looking up governance info',
          toolName: 'lookup',
          toolInput: { topic: typeof input === 'string' ? input : 'AI governance' },
        };
      }
      if (step.stepNumber === 2) {
        return {
          action: 'use_tool',
          reasoning: 'Echoing result',
          toolName: 'echo',
          toolInput: { message: 'Governance lookup complete' },
        };
      }
      return { action: 'complete', reasoning: 'Task completed' };
    },
    async execute(plan, step) {
      if (plan.toolName && plan.toolInput) {
        const tool = toolRegistry.get(plan.toolName);
        if (!tool) return { error: 'Tool not found' };
        const result = await tool.handler(plan.toolInput, { runId: generateRunId(), governance: ctx });
        return { toolName: plan.toolName, toolOutput: result };
      }
      return { toolOutput: 'No tool execution needed' };
    },
    async observe(execution, step) {
      if (execution.error) return { result: { error: execution.error }, isComplete: true };
      return { result: execution.toolOutput, isComplete: step.stepNumber >= 3 };
    },
  };

  const runtime = createAgentRuntime({
    config: agentConfig,
    handlers,
    onStep: async (step) => console.log(`  Agent step ${step.stepNumber}: ${step.phase}`),
  });

  const agentResult = await runtime.run({ input: 'Check AI governance compliance', runId: generateRunId() });
  console.log(`Agent result: status=${agentResult.status}, steps=${agentResult.totalSteps}`);
  console.log(`Agent output: ${short(String(agentResult.output))}`);

  // ── 7i: Knowledge Base RAG ─────────────────────────────────────────────────
  section('7i: Knowledge Base RAG');

  kbRegistry.registerKB({
    id: 'governance-kb',
    name: 'Governance Knowledge Base',
    provider: 'memory',
    governance: { dataClass: 'internal' },
    connection: {},
  });

  kbRegistry.setProvider('governance-kb', createMemoryKBProvider({
    kbId: 'governance-kb',
    documents: [
      { id: 'doc-1', text: 'The EU AI Act classifies AI systems into four risk categories: unacceptable, high, limited, and minimal.', title: 'EU AI Act Overview' },
      { id: 'doc-2', text: 'High-risk AI systems require conformity assessments, human oversight, and transparency measures.', title: 'High-Risk Requirements' },
      { id: 'doc-3', text: 'GDPR requires data minimization, lawful basis for processing, and data subject rights.', title: 'GDPR Overview' },
      { id: 'doc-4', text: 'SOC2 Type II requires continuous monitoring and evidence of security controls over a period.', title: 'SOC2 Compliance' },
    ],
  }));

  const retrievalResult = await client.knowledge.retrieve({
    kbId: 'governance-kb',
    query: { query: 'What are high-risk AI requirements?', kb: 'governance-kb', topK: 2 },
    context: ctx,
  });
  console.log(`KB retrieval: ${retrievalResult.chunks.length} chunks returned`);
  for (const chunk of retrievalResult.chunks) {
    console.log(`  - [${chunk.documentId}] ${short(chunk.text, 80)}`);
  }

  // Auto-grounded model call
  const groundedResult = await client.models.generate({
    model: 'mock-model',
    request: { model: 'mock-model', messages: [{ role: 'user', content: 'What are high-risk AI requirements?' }], context: ctx },
    context: ctx,
    grounding: { kbIds: ['governance-kb'], topK: 2 },
  });
  console.log(`Grounded generation run: ${groundedResult.runId}`);

  // ── 7j: MCP Server Integration ─────────────────────────────────────────────
  section('7j: MCP Server Integration');

  const mockTransport = createMockMCPTransport({
    tools: [
      {
        name: 'get_regulation_status',
        description: 'Get compliance status for a regulation',
        inputSchema: {
          type: 'object',
          properties: { regulation: { type: 'string' } },
          required: ['regulation'],
        },
      },
      {
        name: 'search_policies',
        description: 'Search governance policies',
        inputSchema: {
          type: 'object',
          properties: { query: { type: 'string' } },
          required: ['query'],
        },
      },
    ],
    handler: async (name, args) => {
      if (name === 'get_regulation_status') return { regulation: args.regulation, status: 'active', compliant: true };
      if (name === 'search_policies') return { results: [{ id: 'p1', name: 'PII Protection' }] };
      return { error: `Unknown tool: ${name}` };
    },
  });

  mcpRegistry.registerServer({
    id: 'governance-tools',
    name: 'Governance Tools Server',
    transport: { type: 'http', url: 'http://localhost:3001/mcp' },
    governance: { allowedTools: ['get_regulation_status', 'search_policies'] },
  });
  mcpRegistry.setTransport('governance-tools', mockTransport);
  await mockTransport.connect();

  const discovery = await client.mcp.discoverTools({ serverId: 'governance-tools', context: ctx });
  console.log(`MCP discovered: ${discovery.tools.length} tools`);

  const mcpTool = toolRegistry.get('mcp.governance-tools.get_regulation_status');
  if (mcpTool?.handler) {
    const mcpResult = await mcpTool.handler({ regulation: 'EU AI Act' }, { runId: generateRunId(), governance: ctx });
    console.log(`MCP tool result: ${JSON.stringify(mcpResult)}`);
  }
  await mockTransport.disconnect();

  // ── 7k: Structured Output Validation ───────────────────────────────────────
  section('7k: Structured Output Validation');

  const structuredResult = await client.models.generate({
    model: 'mock-model',
    request: {
      model: 'mock-model',
      messages: [{ role: 'user', content: 'Extract governance entities as JSON' }],
      context: ctx,
    },
    context: ctx,
    outputSchema: {
      type: 'jsonSchema',
      schema: {
        type: 'object',
        required: ['entities', 'sentiment'],
        properties: {
          entities: {
            type: 'array',
            items: { type: 'object', properties: { name: { type: 'string' }, type: { type: 'string' } } },
          },
          sentiment: { type: 'string', enum: ['positive', 'negative', 'neutral'] },
        },
      },
    },
    outputValidationMode: 'warn',
  });
  console.log(`Structured output run: ${structuredResult.runId}`);

  // ── 7l: Streaming ──────────────────────────────────────────────────────────
  section('7l: Streaming');

  const { runId: streamRunId, stream } = await client.models.generateStream({
    model: 'mock-model',
    request: {
      model: 'mock-model',
      messages: [{ role: 'user', content: 'Stream a governance overview' }],
      context: ctx,
    },
    context: ctx,
    streamOptions: { emitChunks: true, abortOnSensitive: true },
  });

  let streamOutput = '';
  for await (const chunk of stream) {
    if (chunk.type === 'content' && chunk.content) {
      streamOutput += chunk.content;
    }
  }
  console.log(`Stream run: ${streamRunId}, output length: ${streamOutput.length}`);

  // ── 7m: Evaluations ────────────────────────────────────────────────────────
  section('7m: Evaluations');

  // runEvaluations (standalone) expects evaluators returning { effect, findings[] }
  const evalInput = {
    input: 'What is AI governance?',
    output: 'AI governance is the framework of policies and controls for responsible AI use.',
  };

  const evalResult = await runEvaluations(
    [
      {
        id: 'length-check',
        name: 'Output Length Check',
        evaluate: async (input: Record<string, unknown>) => ({
          effect: 'pass' as const,
          findings: [
            {
              evaluatorId: 'length-check',
              message: `Output length: ${String(input.output ?? '').length} chars`,
              severity: 'info' as const,
            },
          ],
        }),
      },
      {
        id: 'relevance-check',
        name: 'Relevance Check',
        evaluate: async (input: Record<string, unknown>) => {
          const output = String(input.output ?? '').toLowerCase();
          const relevant = output.includes('governance');
          return {
            effect: relevant ? ('pass' as const) : ('warn' as const),
            findings: [
              {
                evaluatorId: 'relevance-check',
                message: relevant ? 'Output contains governance keyword' : 'Output missing governance keyword',
                severity: relevant ? ('info' as const) : ('medium' as const),
              },
            ],
          };
        },
      },
    ],
    evalInput,
  );
  console.log(`Evaluation effect: ${evalResult.effect}`);
  console.log(`Evaluation results: ${evalResult.results.length} evaluator(s) ran`);

  // ── 7n: Approval Workflow ──────────────────────────────────────────────────
  section('7n: Approval Workflow');

  // Track whether the approval was already granted so the retry succeeds
  let approvalGranted = false;

  const approvalClient = createArelisClient({
    modelRegistry,
    policyEngine: {
      async evaluate() {
        if (approvalGranted) {
          return { decisions: [allowDecision()], summary: { allowed: true } };
        }
        return {
          decisions: [{ effect: 'require_approval' as const, approvers: ['admin@example.com'], reason: 'High risk operation' }],
          summary: { allowed: false, blockReason: 'Requires approval', approvers: ['admin@example.com'] },
        };
      },
    },
    auditSink: createConsoleSink({ pretty: true }),
  });

  try {
    await approvalClient.models.generate({
      model: 'mock-model',
      request: { model: 'mock-model', messages: [{ role: 'user', content: 'Sensitive operation' }], context: ctx },
      context: ctx,
    });
  } catch (err) {
    if (err instanceof PolicyApprovalRequiredError) {
      console.log(`Approval required: ${err.approvalId}`);
      console.log(`Approvers: ${err.approvers?.join(', ')}`);

      // Simulate approval
      await approvalClient.approvals.approve({
        approvalId: err.approvalId ?? '',
        resolvedBy: 'admin@example.com',
        context: ctx,
      });
      approvalGranted = true;
      console.log('Approval granted, retrying...');

      const retryResult = await approvalClient.models.generate({
        model: 'mock-model',
        request: { model: 'mock-model', messages: [{ role: 'user', content: 'Sensitive operation' }], context: ctx },
        context: ctx,
      });
      console.log(`Retry result: ${retryResult.runId}`);
    }
  }

  // Return audit events for later inspection
  return { memorySink, client };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  SECTION 8 — Manual Platform Pipeline
// ═══════════════════════════════════════════════════════════════════════════════

async function section8_manualPipeline(platform: ArelisPlatform, aiSystemId: string) {
  header('8) Manual Platform Pipeline');

  const runId = `run-pipeline-${crypto.randomUUID()}`;
  const actorId = 'user-demo';

  // ── 8a: Platform Events ────────────────────────────────────────────────────
  section('8a: Platform Events');

  await Promise.all([
    platform.events.create({
      runId,
      aiSystemId,
      eventType: 'model.invoked',
      actor: { type: 'human', id: actorId },
      resource: { type: 'model', id: 'gemini-2.5-flash' },
      action: 'inference',
      timestamp: new Date().toISOString(),
      metadata: { responseLength: 512, sessionId: ctx.sessionId, purpose: ctx.purpose, environment: ctx.environment },
    }),
    platform.events.create({
      runId,
      aiSystemId,
      eventType: 'output.delivered',
      actor: { type: 'human', id: actorId },
      resource: { type: 'model', id: 'gemini-2.5-flash' },
      action: 'deliver',
      timestamp: new Date().toISOString(),
      metadata: { outputLength: 512, containsPII: false },
    }),
    platform.events.create({
      runId,
      aiSystemId,
      eventType: 'policy.evaluated',
      actor: { type: 'human', id: actorId },
      resource: { type: 'model', id: 'gemini-2.5-flash' },
      action: 'evaluate',
      timestamp: new Date().toISOString(),
      metadata: {
        checkpoints: ['BeforePrompt', 'AfterModelOutput'],
        decisionsCount: 2,
        enforcementMode: 'enforce',
        pii_detected: false,
        pii_types: [],
      },
    }),
  ]).catch((err) => console.error('[Arelis] Failed to emit events:', err));
  console.log(`Events emitted for run: ${runId}`);

  // ── 8b: Platform Policy Evaluation ─────────────────────────────────────────
  section('8b: Platform Policy Evaluation (evaluatePolicy)');

  const policyEval = await platform.governance.evaluatePolicy({
    runId,
    checkpoint: {
      content: { pii_detected: false, pii_types: [], pii_count: 0 },
    },
  }).catch((err) => {
    console.error('[Arelis] evaluatePolicy failed:', err);
    return null;
  });

  if (policyEval) {
    console.log(`Policy eval: ${policyEval.decisions?.length ?? 0} decisions`);
    for (const d of policyEval.decisions ?? []) {
      console.log(`  - ${(d as { decision: string }).decision} (policy: ${(d as { policyId: string }).policyId})`);
    }
  }

  // ── 8c: Risk Evaluation ────────────────────────────────────────────────────
  section('8c: Risk Evaluation');

  const riskResult = await platform.risk.evaluate({
    runId,
    aiSystemId,
    policyDecisions: [{ effect: 'allow', checkpoint: 'BeforePrompt', reason: 'No PII detected' }],
    quotaState: { tokensIn: 48_231, tokensOut: 2_100, requestsCount: 1, costUsd: 0.001 },
    evaluationSignals: { contentSafety: 'pass', piiDetected: false },
  }).catch((err) => {
    // Platform may require specific input shapes depending on org config
    console.warn(`[Arelis] risk.evaluate: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  });

  if (riskResult) {
    console.log(`Risk: action=${riskResult.action}, score=${riskResult.score}`);
    console.log(`Deterministic hash: ${riskResult.deterministicInputsHash?.slice(0, 16)}...`);
  }

  // ── 8d: Compliance Proof ───────────────────────────────────────────────────
  section('8d: Compliance Proof (create + verify)');

  const proof = await platform.proofs.create({
    runId,
    aiSystemId,
    schemaVersion: 'v1',
  }).catch((err) => {
    console.error('[Arelis] proofs.create failed:', err);
    return null;
  });

  if (proof) {
    const proofId = 'proofId' in proof ? proof.proofId : 'jobId' in proof ? proof.jobId : null;
    console.log(`Proof created: ${proofId}`);

    if (proofId && 'proofId' in proof) {
      const verification = await platform.proofs.verify({ proofId }).catch(() => null);
      if (verification) {
        console.log(`Proof verified: ${verification.verified}`);
      }
    }
  }

  // ── 8e: Causal Graph (startCausalGraph + commit) ──────────────────────────
  section('8e: Causal Graph Construction');

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

  const edges: { source: string; target: string; type: string }[] = [];
  for (let i = 1; i < graphEvents.length; i++) {
    edges.push({
      source: graphEvents[i - 1].eventId,
      target: graphEvents[i].eventId,
      type: 'sequence',
    });
  }

  // CRITICAL: startCausalGraph BEFORE commit
  await platform.replay.startCausalGraph({ runId, nodes, edges })
    .catch((err) => console.error('[Arelis] startCausalGraph failed:', err));
  console.log(`Causal graph submitted: ${nodes.length} nodes, ${edges.length} edges`);

  // Seal the graph (MUST be last)
  const commitResult = await platform.graphs.commit(runId)
    .catch((err) => {
      console.error('[Arelis] graphs.commit failed:', err);
      return null;
    });

  if (commitResult) {
    console.log(`Graph committed: rootHash=${commitResult.rootHash?.slice(0, 16)}...`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  SECTION 9 — Error Handling Patterns
// ═══════════════════════════════════════════════════════════════════════════════

async function section9_errorHandling() {
  header('9) Error Handling Patterns');

  const modelRegistry = createModelRegistry();
  modelRegistry.register(createMockProvider({ supportedModels: ['mock-model'] }));

  // 9a. PolicyBlockedError
  section('9a: PolicyBlockedError');
  const blockedClient = createArelisClient({
    modelRegistry,
    policyEngine: createDenyAllEngine(),
    auditSink: createMemorySink(),
  });

  try {
    await blockedClient.models.generate({
      model: 'mock-model',
      request: { model: 'mock-model', messages: [{ role: 'user', content: 'test' }], context: ctx },
      context: ctx,
    });
  } catch (err) {
    if (isPolicyBlockedError(err)) {
      console.log(`PolicyBlockedError caught: reason="${(err as { reason?: string }).reason}", code="${(err as { policyCode?: string }).policyCode}"`);
    }
  }

  // 9b. EvaluationBlockedError
  section('9b: EvaluationBlockedError guard');
  console.log('isEvaluationBlockedError available:', typeof isEvaluationBlockedError === 'function');

  // 9c. GovernanceGateDeniedError
  section('9c: GovernanceGateDeniedError');
  try {
    const arelis = createArelis({
      platform: {
        apiKey: process.env.ARELIS_API_KEY!,
        ...(process.env.ARELIS_API_URL ? { baseUrl: process.env.ARELIS_API_URL } : {}),
      },
    });

    await arelis.governedInvoke({
      runId: generateRunId(),
      model: 'gemini-2.5-flash',
      prompt: 'SSN: 123-45-6789, email: test@test.com',
      denyMode: 'throw',
      invoke: async () => 'should not reach here',
    });
  } catch (err) {
    if (err instanceof GovernanceGateDeniedError) {
      console.log(`GovernanceGateDeniedError caught: decision=${err.decision}`);
    } else {
      console.log(`Other error (may not have active deny policy): ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 9d. isPolicyApprovalRequiredError
  section('9d: isPolicyApprovalRequiredError guard');
  console.log('isPolicyApprovalRequiredError available:', typeof isPolicyApprovalRequiredError === 'function');
}

// ═══════════════════════════════════════════════════════════════════════════════
//  SECTION 10 — Compliance Artifact & Replay (Local)
// ═══════════════════════════════════════════════════════════════════════════════

async function section10_compliance(memorySink: ReturnType<typeof createMemorySink>) {
  header('10) Compliance — Audit Replay & Lineage');

  const events = memorySink.events;
  console.log(`Total audit events in memory sink: ${events.length}`);

  const eventTypes = [...new Set(events.map((e) => e.type))];
  console.log(`Event types: ${eventTypes.join(', ')}`);

  // Replay a run if we have events
  if (events.length > 0) {
    const firstRunEvent = events.find((e) => e.runId);
    if (firstRunEvent) {
      const runEvents = events.filter((e) => e.runId === firstRunEvent.runId);
      console.log(`Run ${firstRunEvent.runId}: ${runEvents.length} events`);

      try {
        const replayResult = await replayAuditRun({
          runId: firstRunEvent.runId!,
          events: runEvents as any,
          resolveData: async () => 'resolved-data',
        });
        console.log(`Replay drift detected: ${replayResult.driftDetected}`);
      } catch (err) {
        console.log(`Replay: ${err instanceof Error ? err.message : 'completed with notes'}`);
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  MAIN
// ═══════════════════════════════════════════════════════════════════════════════

async function main(): Promise<void> {
  header('Comprehensive AI Governance SDK Demo (TypeScript)');
  console.log(`Date: ${new Date().toISOString()}`);
  console.log(`Node: ${process.version}`);

  // Section 1: Platform + AI System
  const { arelis, platform, aiSystemId, MODEL_ID } = await section1_platformSetup();

  // Section 2: PII Scanning
  await section2_piiScanning(arelis);

  // Section 3: Policy Setup
  const policyId = await section3_policySetup(platform);

  // Section 4: governedInvoke
  await section4_governedInvoke(arelis, policyId);

  // Section 5: Standalone Gate
  await section5_standaloneGate(platform);

  // Section 6: Agent Run
  await section6_agentRun(arelis, policyId);

  // Section 7: Low-Level Runtime (all subsystems)
  const { memorySink } = await section7_lowLevelRuntime();

  // Section 8: Manual Platform Pipeline
  await section8_manualPipeline(platform, aiSystemId);

  // Section 9: Error Handling
  await section9_errorHandling();

  // Section 10: Compliance
  await section10_compliance(memorySink);

  // ── Final Summary ──────────────────────────────────────────────────────────
  header('Demo Complete');
  console.log('All 10 sections executed successfully.');
  console.log('SDK features demonstrated:');
  console.log('  - createArelis (unified orchestrator)');
  console.log('  - createArelisClient (low-level composition)');
  console.log('  - AI System registration + summary');
  console.log('  - Managed PII config + local scanning');
  console.log('  - Platform policy creation (idempotent)');
  console.log('  - governedInvoke (blocked + allowed + multi-provider)');
  console.log('  - withGovernanceGate + evaluatePreInvocationGate');
  console.log('  - agents.run (multi-step tool loop, graph, proof, risk)');
  console.log('  - Custom PolicyEngine (BeforeToolCall / AfterToolResult)');
  console.log('  - Composite audit sink (console + memory)');
  console.log('  - Memory (write / read / list / delete)');
  console.log('  - Quotas (check / commit)');
  console.log('  - Prompt templates (register / get / hash)');
  console.log('  - Secrets resolution (env-based)');
  console.log('  - Tool registry + agent runtime (plan-execute-observe)');
  console.log('  - Knowledge Base RAG (retrieval + auto-grounding)');
  console.log('  - MCP server integration (discover + invoke)');
  console.log('  - Structured output validation');
  console.log('  - Streaming');
  console.log('  - Evaluations + effect derivation');
  console.log('  - Approval workflow');
  console.log('  - Platform events (model.invoked, output.delivered, policy.evaluated)');
  console.log('  - Platform policy evaluation (evaluatePolicy)');
  console.log('  - Risk evaluation');
  console.log('  - Compliance proofs (create + verify)');
  console.log('  - Causal graph (startCausalGraph + commit)');
  console.log('  - Error handling (all error types + guards)');
  console.log('  - Audit replay + lineage');
  console.log();
}

main().catch((error) => {
  console.error('Demo failed:', error);
  process.exit(1);
});
