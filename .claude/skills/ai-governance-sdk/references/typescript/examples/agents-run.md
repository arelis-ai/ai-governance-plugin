# agents.run

Multi-step governed agent loop with tool calling, causal graph, compliance proof, and risk evaluation.

> Extracted from the comprehensive TypeScript governance demo. See [setup-and-registration.md](setup-and-registration.md) for initialization.

## Tool Declarations (Gemini Format)

```typescript
import { GoogleGenAI, Type } from '@google/genai';
import type {
  GovernedAgentTool,
  AgentConversationMessage,
  AgentModelResponse,
} from '@arelis-ai/ai-governance-sdk';

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
```

## GovernedAgentTool Definitions

```typescript
const agentTools: GovernedAgentTool[] = toolDeclarations.map((t) => ({
  name: t.name,
  description: t.description,
  schema: t.parameters as unknown as Record<string, unknown>,
}));
```

## Tool Execution Dispatch

```typescript
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
```

## invokeModel Callback (Gemini with Function Calling)

```typescript
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
```

## agents.run Call

```typescript
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
```

## Result Inspection

```typescript
console.log(`Status: ${result.status}`);
console.log(`Decision: ${result.decision.decision}`);
console.log(`Steps: ${result.steps.length}`);
console.log(`Events: ${result.events.length}`);
console.log(`Graph: ${result.graph.nodes.length} nodes, ${result.graph.edges.length} edges`);
console.log(`Proof: ${result.proof ? 'generated' : 'n/a'}`);
console.log(`Risk: ${result.risk ? `action=${result.risk.action}, score=${result.risk.score}` : 'n/a'}`);
console.log(`Output: "${result.output}"`);
```

**Key patterns:**

- `GovernedAgentTool` requires `name`, `description`, and `schema` (JSON Schema object).
- `invokeModel` receives `{ model, messages }` and must return `{ text?, toolCalls?, finishReason }`.
- `executeToolCall` receives `{ tool: { name, args } }` and returns the tool output.
- `mapOutput` transforms the final response and step history into the desired output type.
- `aiSystemId` auto-propagates from `createArelis` through gate, batch events, proof, risk, and graph.
- Result includes `steps`, `events`, `graph`, `proof`, `risk`, `platformEvents`, and `warnings`.
