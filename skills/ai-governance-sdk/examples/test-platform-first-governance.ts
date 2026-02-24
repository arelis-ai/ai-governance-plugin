/**
 * Platform-First Governance Demo
 *
 * Demonstrates the latest high-level SDK orchestration:
 *  1) Managed PII config retrieval + local scan
 *  2) governedInvoke() blocked path (policy deny)
 *  3) governedInvoke() allowed path (Gemini and optional Claude)
 *  4) agents.run() tool loop with automatic event/graph/proof/risk enrichment
 *
 * Usage:
 *   npx tsx scripts/test-platform-first-governance.ts
 *
 * Required env vars:
 *   ARELIS_API_KEY
 *   GEMINI_API_KEY
 *
 * Optional env vars:
 *   ARELIS_API_URL      (if omitted, SDK default is https://api.arelis.digital)
 *   ANTHROPIC_API_KEY   (to run optional Claude governedInvoke scenario)
 */

import 'dotenv/config';

import {
  createArelis,
  scanPromptForPii,
  type AgentConversationMessage,
  type AgentModelResponse,
  type GovernedAgentTool,
} from '@arelis-ai/ai-governance-sdk';
import { GoogleGenAI, Type } from '@google/genai';

type InvokeSummary = {
  label: string;
  runId: string;
  invoked: boolean;
  decision: 'allow' | 'deny';
  model: string;
  hasPii: boolean;
  piiFindings: number;
  timingsMs: { scanMs: number; policyEvalMs: number; totalMs: number };
  warningCount: number;
};

type AgentSummary = {
  runId: string;
  status: string;
  steps: number;
  events: number;
  graphNodes: number;
  graphEdges: number;
  platformEvents: number;
  hasProof: boolean;
  riskAction?: string;
  warningCount: number;
};

const REQUIRED_ENV = ['ARELIS_API_KEY', 'GEMINI_API_KEY'] as const;
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`Missing required env var: ${key}`);
    process.exit(1);
  }
}

const arelis = createArelis({
  platform: {
    apiKey: process.env.ARELIS_API_KEY,
    ...(process.env.ARELIS_API_URL ? { baseUrl: process.env.ARELIS_API_URL } : {}),
    maxRetries: 3,
    timeout: 30_000,
  },
});

const gemini = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
type AnthropicTextBlock = {
  type: string;
  text?: string;
};

type AnthropicLike = {
  messages: {
    create: (input: {
      model: string;
      max_tokens: number;
      messages: Array<{ role: 'user'; content: string }>;
    }) => Promise<{ content: AnthropicTextBlock[] }>;
  };
};

let anthropic: AnthropicLike | undefined;

const platform = arelis.platform;
if (!platform) {
  throw new Error('Platform client not available. createArelis({ platform: ... }) is required.');
}

type GeminiFunctionDeclaration = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

const AGENT_TOOL_DECLARATIONS: GeminiFunctionDeclaration[] = [
  {
    name: 'lookupRegulation',
    description: 'Look up details for a regulation (EU AI Act, GDPR, SOC2).',
    parameters: {
      type: Type.OBJECT,
      properties: {
        regulationName: {
          type: Type.STRING,
          description: 'Regulation or framework name',
        },
      },
      required: ['regulationName'],
    },
  },
  {
    name: 'checkComplianceStatus',
    description: 'Return organization compliance status for a regulation identifier.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        regulationId: {
          type: Type.STRING,
          description: 'Regulation id, for example eu-ai-act',
        },
      },
      required: ['regulationId'],
    },
  },
];

const AGENT_TOOLS: GovernedAgentTool[] = AGENT_TOOL_DECLARATIONS.map((tool) => ({
  name: tool.name,
  description: tool.description,
  schema: tool.parameters as unknown as Record<string, unknown>,
}));

function header(title: string): void {
  console.log(`\n${'='.repeat(78)}`);
  console.log(`  ${title}`);
  console.log(`${'='.repeat(78)}\n`);
}

function section(title: string): void {
  console.log(`--- ${title} ---\n`);
}

function short(text: string, max = 180): string {
  return text.length <= max ? text : `${text.slice(0, max)}...`;
}

async function loadAnthropicClient(apiKey: string): Promise<AnthropicLike | undefined> {
  try {
    const anthropicModule = (await import('@anthropic-ai/sdk')) as {
      default: new (input: { apiKey: string }) => AnthropicLike;
    };
    return new anthropicModule.default({ apiKey });
  } catch (error) {
    console.warn(
      `Unable to load @anthropic-ai/sdk; Claude scenario will be skipped: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return undefined;
  }
}

async function ensurePiiPolicy(): Promise<string> {
  const policyKey = 'pii-deny-before-invocation';
  const listed = await platform.governance.policies.list({ search: policyKey, limit: 25 });
  const existing = listed.data.find((policy) => policy.key === policyKey);

  if (existing) {
    console.log(`PII deny policy exists: ${existing.id}`);
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

  console.log(`PII deny policy created: ${created.id}`);
  return created.id;
}

async function runManagedPiiCheck(): Promise<void> {
  section('Managed PII Config + Local Scan');

  const managedConfig = await arelis.governance.getPiiConfig({ namespace: 'pii.default' });
  const samplePrompt = 'Contact me at jane.doe@example.com and SSN 123-45-6789';
  const scan = scanPromptForPii(samplePrompt, { redactorConfig: managedConfig });

  console.log(`Managed config loaded: ${Object.keys(managedConfig).length > 0}`);
  console.log(`PII detected: ${scan.hasPii}`);
  console.log(`Findings: ${scan.findings.length}`);
  for (const finding of scan.findings) {
    console.log(`  - ${finding.pattern ?? finding.type}: "${finding.original}"`);
  }
  console.log();
}

async function runBlockedInvoke(policyId: string): Promise<InvokeSummary> {
  section('governedInvoke() Blocked Scenario (Gemini)');

  const model = 'gemini-2.5-flash';
  const prompt =
    'My SSN is 423-91-0482 and my email is john.smith@acmecorp.com. Help file taxes.';

  const result = await arelis.governedInvoke({
    runId: `run-blocked-${crypto.randomUUID()}`,
    model,
    prompt,
    policyIds: [policyId],
    context: { environment: 'dev', purpose: 'blocked-demo' },
    denyMode: 'return',
    invoke: async (sanitizedPrompt) => {
      const completion = await gemini.models.generateContent({
        model,
        contents: sanitizedPrompt,
      });
      return completion.text ?? '';
    },
  });

  console.log(`Run: ${result.runId}`);
  console.log(`Decision: ${result.decision.decision}`);
  console.log(`Invoked: ${result.invoked}`);
  console.log(`PII findings: ${result.decision.pii.findings.length}`);
  console.log(
    `Timings: scan=${result.decision.metadata.timings.scanMs}ms, policy=${result.decision.metadata.timings.policyEvalMs}ms, total=${result.decision.metadata.timings.totalMs}ms`,
  );
  if (result.warnings?.length) {
    console.log(`Warnings (${result.warnings.length}):`);
    for (const warning of result.warnings) {
      console.log(`  - ${warning}`);
    }
  }
  console.log();

  return {
    label: 'Blocked invoke (Gemini)',
    runId: result.runId,
    invoked: result.invoked,
    decision: result.decision.decision,
    model,
    hasPii: result.decision.pii.hasPii,
    piiFindings: result.decision.pii.findings.length,
    timingsMs: result.decision.metadata.timings,
    warningCount: result.warnings?.length ?? 0,
  };
}

async function runAllowedGeminiInvoke(policyId: string): Promise<InvokeSummary> {
  section('governedInvoke() Allowed Scenario (Gemini)');

  const model = 'gemini-2.5-flash';
  const prompt =
    'Explain the top three controls for AI governance in regulated industries in three sentences.';

  const result = await arelis.governedInvoke({
    runId: `run-allow-gemini-${crypto.randomUUID()}`,
    model,
    prompt,
    policyIds: [policyId],
    context: { environment: 'dev', purpose: 'allowed-gemini-demo' },
    denyMode: 'return',
    invoke: async (sanitizedPrompt) => {
      const completion = await gemini.models.generateContent({
        model,
        contents: sanitizedPrompt,
      });
      return completion.text ?? '';
    },
  });

  console.log(`Run: ${result.runId}`);
  console.log(`Decision: ${result.decision.decision}`);
  console.log(`Invoked: ${result.invoked}`);
  if (result.result) {
    console.log(`Response: "${short(result.result)}"`);
  }
  if (result.risk) {
    console.log(`Risk: action=${result.risk.action} score=${result.risk.score}`);
  }
  if (result.warnings?.length) {
    console.log(`Warnings (${result.warnings.length}):`);
    for (const warning of result.warnings) {
      console.log(`  - ${warning}`);
    }
  }
  console.log();

  return {
    label: 'Allowed invoke (Gemini)',
    runId: result.runId,
    invoked: result.invoked,
    decision: result.decision.decision,
    model,
    hasPii: result.decision.pii.hasPii,
    piiFindings: result.decision.pii.findings.length,
    timingsMs: result.decision.metadata.timings,
    warningCount: result.warnings?.length ?? 0,
  };
}

async function runAllowedClaudeInvoke(policyId: string): Promise<InvokeSummary | null> {
  if (!anthropic) {
    section('governedInvoke() Allowed Scenario (Claude)');
    console.log('Skipped: ANTHROPIC_API_KEY not provided.\n');
    return null;
  }

  section('governedInvoke() Allowed Scenario (Claude)');

  const model = 'claude-sonnet-4-5-20250929';
  const prompt =
    'What are three practical controls to reduce compliance risk for AI agent tool usage?';

  const result = await arelis.governedInvoke({
    runId: `run-allow-claude-${crypto.randomUUID()}`,
    model,
    prompt,
    policyIds: [policyId],
    context: { environment: 'dev', purpose: 'allowed-claude-demo' },
    denyMode: 'return',
    invoke: async (sanitizedPrompt) => {
      const message = await anthropic.messages.create({
        model,
        max_tokens: 300,
        messages: [{ role: 'user', content: sanitizedPrompt }],
      });
      const textBlock = message.content.find((entry) => entry.type === 'text');
      return textBlock?.text ?? '';
    },
  });

  console.log(`Run: ${result.runId}`);
  console.log(`Decision: ${result.decision.decision}`);
  console.log(`Invoked: ${result.invoked}`);
  if (result.result) {
    console.log(`Response: "${short(result.result)}"`);
  }
  if (result.risk) {
    console.log(`Risk: action=${result.risk.action} score=${result.risk.score}`);
  }
  if (result.warnings?.length) {
    console.log(`Warnings (${result.warnings.length}):`);
    for (const warning of result.warnings) {
      console.log(`  - ${warning}`);
    }
  }
  console.log();

  return {
    label: 'Allowed invoke (Claude)',
    runId: result.runId,
    invoked: result.invoked,
    decision: result.decision.decision,
    model,
    hasPii: result.decision.pii.hasPii,
    piiFindings: result.decision.pii.findings.length,
    timingsMs: result.decision.metadata.timings,
    warningCount: result.warnings?.length ?? 0,
  };
}

function parseToolPayload(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return { raw };
  }
}

function toGeminiContents(
  messages: AgentConversationMessage[],
): Array<{ role: string; parts: Array<Record<string, unknown>> }> {
  const contents: Array<{ role: string; parts: Array<Record<string, unknown>> }> = [];

  for (const message of messages) {
    if (message.role === 'user') {
      contents.push({ role: 'user', parts: [{ text: message.content }] });
      continue;
    }

    if (message.role === 'assistant') {
      contents.push({ role: 'model', parts: [{ text: message.content }] });
      continue;
    }

    contents.push({
      role: 'user',
      parts: [
        {
          functionResponse: {
            name: message.name ?? 'tool',
            response: parseToolPayload(message.content),
          },
        },
      ],
    });
  }

  return contents;
}

function executeDemoTool(name: string, args: Record<string, unknown>): Record<string, unknown> {
  if (name === 'lookupRegulation') {
    const regulationName = String(args.regulationName ?? '').toLowerCase();

    if (regulationName.includes('eu ai act') || regulationName.includes('ai act')) {
      return {
        id: 'eu-ai-act',
        name: 'EU Artificial Intelligence Act',
        riskCategories: ['unacceptable', 'high', 'limited', 'minimal'],
        keyRequirements: [
          'Risk classification',
          'Conformity assessment for high-risk systems',
          'Human oversight controls',
        ],
      };
    }

    if (regulationName.includes('gdpr')) {
      return {
        id: 'gdpr',
        name: 'General Data Protection Regulation',
        keyRequirements: ['Lawful basis', 'Data minimization', 'Subject rights'],
      };
    }

    return { id: 'unknown', error: `Regulation not found: ${String(args.regulationName ?? '')}` };
  }

  if (name === 'checkComplianceStatus') {
    const regulationId = String(args.regulationId ?? '');

    if (regulationId === 'eu-ai-act') {
      return {
        regulationId,
        overallStatus: 'partially_compliant',
        controls: [
          { name: 'Risk Classification', status: 'compliant', score: 0.95 },
          { name: 'Human Oversight', status: 'in_progress', score: 0.68 },
          { name: 'Conformity Assessment', status: 'not_started', score: 0.0 },
        ],
        nextReviewDate: '2026-03-01',
      };
    }

    return { regulationId, overallStatus: 'unknown', error: 'No status data found' };
  }

  return { error: `Unknown tool: ${name}` };
}

function extractGeminiText(response: unknown): string | undefined {
  if (typeof response !== 'object' || response === null) {
    return undefined;
  }

  const responseRecord = response as Record<string, unknown>;
  const candidates = responseRecord.candidates;

  if (!Array.isArray(candidates)) {
    return undefined;
  }

  const textParts: string[] = [];
  for (const candidate of candidates) {
    if (typeof candidate !== 'object' || candidate === null) {
      continue;
    }

    const content = (candidate as Record<string, unknown>).content;
    if (typeof content !== 'object' || content === null) {
      continue;
    }

    const parts = (content as Record<string, unknown>).parts;
    if (!Array.isArray(parts)) {
      continue;
    }

    for (const part of parts) {
      if (typeof part !== 'object' || part === null) {
        continue;
      }

      const text = (part as Record<string, unknown>).text;
      if (typeof text === 'string' && text.length > 0) {
        textParts.push(text);
      }
    }
  }

  if (textParts.length === 0) {
    return undefined;
  }

  return textParts.join('').trim();
}

async function invokeGeminiAgentModel(input: {
  model: string;
  messages: AgentConversationMessage[];
}): Promise<AgentModelResponse> {
  const response = await gemini.models.generateContent({
    model: input.model,
    contents: toGeminiContents(input.messages),
    config: {
      tools: [{ functionDeclarations: AGENT_TOOL_DECLARATIONS }],
    },
  });

  const toolCalls = (response.functionCalls ?? []).map((call) => ({
    id: call.id ?? `tool_${crypto.randomUUID()}`,
    name: call.name ?? 'unknown',
    args: (call.args ?? {}) as Record<string, unknown>,
  }));

  const text = extractGeminiText(response);

  return {
    text,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    finishReason: toolCalls.length > 0 ? 'tool_call' : 'stop',
  };
}

async function runAgentScenario(policyId: string): Promise<AgentSummary> {
  section('agents.run() High-Level Tool Loop (Gemini)');

  const result = await arelis.agents.run({
    runId: `run-agent-${crypto.randomUUID()}`,
    model: 'gemini-2.5-flash',
    prompt:
      'For EU AI Act, identify key requirements for high-risk systems and summarize our current compliance posture.',
    tools: AGENT_TOOLS,
    policyIds: [policyId],
    context: { environment: 'dev', purpose: 'agent-platform-first-demo' },
    maxSteps: 6,
    invokeModel: async ({ model, messages }) => invokeGeminiAgentModel({ model, messages }),
    executeToolCall: async ({ tool }) => executeDemoTool(tool.name, tool.args),
    mapOutput: ({ finalResponse, steps }) =>
      finalResponse.text ?? `Agent completed with ${steps.length} step(s) but no final text output.`,
  });

  console.log(`Run: ${result.runId}`);
  console.log(`Status: ${result.status}`);
  console.log(`Decision: ${result.decision.decision}`);
  console.log(`Steps: ${result.steps.length}`);
  console.log(`Events: ${result.events.length}`);
  console.log(`Graph: ${result.graph.nodes.length} node(s), ${result.graph.edges.length} edge(s)`);
  console.log(`Output: "${short(result.output ?? '')}"`);

  if (result.proof && 'proofId' in result.proof.request) {
    console.log(`Proof: ${result.proof.request.proofId}`);
  } else if (result.proof && 'jobId' in result.proof.request) {
    console.log(`Proof job: ${result.proof.request.jobId}`);
  } else {
    console.log('Proof: not available');
  }

  if (result.risk) {
    console.log(`Risk: action=${result.risk.action} score=${result.risk.score}`);
  }

  if (result.warnings?.length) {
    console.log(`Warnings (${result.warnings.length}):`);
    for (const warning of result.warnings) {
      console.log(`  - ${warning}`);
    }
  }
  console.log();

  return {
    runId: result.runId,
    status: result.status,
    steps: result.steps.length,
    events: result.events.length,
    graphNodes: result.graph.nodes.length,
    graphEdges: result.graph.edges.length,
    platformEvents: result.platformEvents?.length ?? 0,
    hasProof: Boolean(result.proof),
    riskAction: result.risk?.action,
    warningCount: result.warnings?.length ?? 0,
  };
}

async function main(): Promise<void> {
  header('Arelis SDK Platform-First Governance Demo');

  if (process.env.ANTHROPIC_API_KEY) {
    anthropic = await loadAnthropicClient(process.env.ANTHROPIC_API_KEY);
  }

  header('1) Policy Setup');
  const policyId = await ensurePiiPolicy();

  header('2) Managed PII Configuration');
  await runManagedPiiCheck();

  header('3) governedInvoke Scenarios');
  const invokeBlocked = await runBlockedInvoke(policyId);
  const invokeAllowedGemini = await runAllowedGeminiInvoke(policyId);
  const invokeAllowedClaude = await runAllowedClaudeInvoke(policyId);

  header('4) agents.run Scenario');
  const agentSummary = await runAgentScenario(policyId);

  header('Summary');
  const invokeSummaries = [invokeBlocked, invokeAllowedGemini, invokeAllowedClaude].filter(
    (entry): entry is InvokeSummary => Boolean(entry),
  );

  console.log('governedInvoke:');
  for (const summary of invokeSummaries) {
    console.log(
      `  ${summary.label.padEnd(28)} decision=${summary.decision.padEnd(5)} invoked=${String(summary.invoked).padEnd(5)} pii=${String(summary.hasPii).padEnd(5)} findings=${String(summary.piiFindings).padEnd(2)} totalMs=${summary.timingsMs.totalMs}`,
    );
  }

  console.log('\nagents.run:');
  console.log(
    `  status=${agentSummary.status} steps=${agentSummary.steps} events=${agentSummary.events} graph=${agentSummary.graphNodes}/${agentSummary.graphEdges} platformEvents=${agentSummary.platformEvents} proof=${agentSummary.hasProof} risk=${agentSummary.riskAction ?? 'n/a'}`,
  );

  const totalWarnings =
    invokeSummaries.reduce((sum, item) => sum + item.warningCount, 0) + agentSummary.warningCount;
  console.log(`\nTotal warnings captured (non-fatal side effects): ${totalWarnings}`);
  console.log();
}

main().catch((error) => {
  console.error('Script failed:', error);
  process.exit(1);
});
