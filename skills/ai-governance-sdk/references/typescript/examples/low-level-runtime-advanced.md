# Low-Level Runtime (Advanced)

Tool registry, agent runtime, KB RAG, MCP integration, structured output, streaming, evaluations, and approvals. Extracted from the comprehensive TypeScript governance demo. See [setup-and-registration.md](setup-and-registration.md) for initialization.

## Tool Registry and Agent Runtime (Plan-Execute-Observe)

```typescript
import {
  createToolRegistry, createAgentRuntime, generateRunId,
  type ToolDefinition, type AgentConfig, type AgentHandlers,
} from '@arelis-ai/ai-governance-sdk';

const echoTool: ToolDefinition<{ message: string }, string> = {
  name: 'echo', description: 'Echoes back the provided message',
  schema: { type: 'object', properties: { message: { type: 'string' } }, required: ['message'] },
  permissions: { scopes: ['read'], allowedActorTypes: ['human', 'service', 'agent'], allowedEnvironments: ['dev', 'staging', 'prod'] },
  handler: async (args) => `Echo: ${args.message}`,
};
toolRegistry.register(echoTool);

const handlers: AgentHandlers = {
  async plan(input, step) {
    if (step.stepNumber === 1) return { action: 'use_tool', reasoning: 'Looking up info',
      toolName: 'lookup', toolInput: { topic: typeof input === 'string' ? input : 'AI governance' } };
    return { action: 'complete', reasoning: 'Task completed' };
  },
  async execute(plan) {
    if (plan.toolName && plan.toolInput) {
      const tool = toolRegistry.get(plan.toolName);
      if (!tool) return { error: 'Tool not found' };
      return { toolName: plan.toolName, toolOutput: await tool.handler(plan.toolInput, { runId: generateRunId(), governance: ctx }) };
    }
    return { toolOutput: 'No tool execution needed' };
  },
  async observe(execution, step) {
    if (execution.error) return { result: { error: execution.error }, isComplete: true };
    return { result: execution.toolOutput, isComplete: step.stepNumber >= 2 };
  },
};

const runtime = createAgentRuntime({
  config: { agentId: 'demo-agent', name: 'Demo Agent', systemPrompt: 'You are a governance assistant.',
    limits: { maxSteps: 5, maxTimeMs: 30_000 }, context: ctx, tools: ['echo', 'lookup'] } as AgentConfig,
  handlers, onStep: async (step) => console.log(`  Step ${step.stepNumber}: ${step.phase}`),
});
const agentResult = await runtime.run({ input: 'Check AI governance compliance', runId: generateRunId() });
```

## Knowledge Base RAG (Retrieval + Auto-Grounding)

```typescript
import { createKBRegistry, createMemoryKBProvider } from '@arelis-ai/ai-governance-sdk';

kbRegistry.registerKB({ id: 'governance-kb', name: 'Governance KB', provider: 'memory', governance: { dataClass: 'internal' }, connection: {} });
kbRegistry.setProvider('governance-kb', createMemoryKBProvider({
  kbId: 'governance-kb',
  documents: [
    { id: 'doc-1', text: 'The EU AI Act classifies AI systems into four risk categories.', title: 'EU AI Act Overview' },
    { id: 'doc-2', text: 'High-risk AI systems require conformity assessments and human oversight.', title: 'High-Risk Requirements' },
  ],
}));

const retrievalResult = await client.knowledge.retrieve({
  kbId: 'governance-kb', query: { query: 'What are high-risk AI requirements?', kb: 'governance-kb', topK: 2 }, context: ctx,
});

// Auto-grounded model call
const groundedResult = await client.models.generate({
  model: 'mock-model',
  request: { model: 'mock-model', messages: [{ role: 'user', content: 'What are high-risk AI requirements?' }], context: ctx },
  context: ctx, grounding: { kbIds: ['governance-kb'], topK: 2 },
});
```

## MCP Server Integration (Discover + Invoke)

```typescript
import { createMCPRegistry, createMockMCPTransport } from '@arelis-ai/ai-governance-sdk';

const mockTransport = createMockMCPTransport({
  tools: [{ name: 'get_regulation_status', description: 'Get compliance status',
    inputSchema: { type: 'object', properties: { regulation: { type: 'string' } }, required: ['regulation'] } }],
  handler: async (name, args) => {
    if (name === 'get_regulation_status') return { regulation: args.regulation, status: 'active', compliant: true };
    return { error: `Unknown tool: ${name}` };
  },
});
mcpRegistry.registerServer({ id: 'governance-tools', name: 'Governance Tools Server',
  transport: { type: 'http', url: 'http://localhost:3001/mcp' }, governance: { allowedTools: ['get_regulation_status'] } });
mcpRegistry.setTransport('governance-tools', mockTransport);
await mockTransport.connect();

const discovery = await client.mcp.discoverTools({ serverId: 'governance-tools', context: ctx });
const mcpTool = toolRegistry.get('mcp.governance-tools.get_regulation_status');
if (mcpTool?.handler) {
  const mcpResult = await mcpTool.handler({ regulation: 'EU AI Act' }, { runId: generateRunId(), governance: ctx });
}
await mockTransport.disconnect();
```

## Structured Output Validation

```typescript
const structuredResult = await client.models.generate({
  model: 'mock-model',
  request: { model: 'mock-model', messages: [{ role: 'user', content: 'Extract governance entities as JSON' }], context: ctx },
  context: ctx,
  outputSchema: { type: 'jsonSchema', schema: {
    type: 'object', required: ['entities', 'sentiment'],
    properties: {
      entities: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, type: { type: 'string' } } } },
      sentiment: { type: 'string', enum: ['positive', 'negative', 'neutral'] },
    },
  }},
  outputValidationMode: 'warn',
});
```

## Streaming

```typescript
const { runId: streamRunId, stream } = await client.models.generateStream({
  model: 'mock-model',
  request: { model: 'mock-model', messages: [{ role: 'user', content: 'Stream a governance overview' }], context: ctx },
  context: ctx, streamOptions: { emitChunks: true, abortOnSensitive: true },
});
let streamOutput = '';
for await (const chunk of stream) {
  if (chunk.type === 'content' && chunk.content) streamOutput += chunk.content;
}
```

## Evaluations

```typescript
import { runEvaluations } from '@arelis-ai/ai-governance-sdk';

const evalResult = await runEvaluations(
  [{
    id: 'relevance-check', name: 'Relevance Check',
    evaluate: async (input: Record<string, unknown>) => {
      const output = String(input.output ?? '').toLowerCase();
      const relevant = output.includes('governance');
      return {
        effect: relevant ? ('pass' as const) : ('warn' as const),
        findings: [{ evaluatorId: 'relevance-check',
          message: relevant ? 'Contains governance keyword' : 'Missing governance keyword',
          severity: relevant ? ('info' as const) : ('medium' as const) }],
      };
    },
  }],
  { input: 'What is AI governance?', output: 'AI governance is the framework of policies and controls.' },
);
```

## Approval Workflow

```typescript
import { PolicyApprovalRequiredError, allowDecision, createConsoleSink } from '@arelis-ai/ai-governance-sdk';

let approvalGranted = false;
const approvalClient = createArelisClient({ modelRegistry, auditSink: createConsoleSink({ pretty: true }),
  policyEngine: {
    async evaluate() {
      if (approvalGranted) return { decisions: [allowDecision()], summary: { allowed: true } };
      return {
        decisions: [{ effect: 'require_approval' as const, approvers: ['admin@example.com'], reason: 'High risk operation' }],
        summary: { allowed: false, blockReason: 'Requires approval', approvers: ['admin@example.com'] },
      };
    },
  },
});

try {
  await approvalClient.models.generate({
    model: 'mock-model',
    request: { model: 'mock-model', messages: [{ role: 'user', content: 'Sensitive operation' }], context: ctx },
    context: ctx,
  });
} catch (err) {
  if (err instanceof PolicyApprovalRequiredError) {
    await approvalClient.approvals.approve({ approvalId: err.approvalId ?? '', resolvedBy: 'admin@example.com', context: ctx });
    approvalGranted = true;
    const retryResult = await approvalClient.models.generate({
      model: 'mock-model',
      request: { model: 'mock-model', messages: [{ role: 'user', content: 'Sensitive operation' }], context: ctx },
      context: ctx,
    });
  }
}
```

**Key patterns:**

- `ToolDefinition` includes `permissions` for scope, actor type, and environment restrictions.
- `AgentHandlers` implements plan-execute-observe with `plan`, `execute`, and `observe` callbacks.
- KB auto-grounding: pass `grounding: { kbIds, topK }` to `client.models.generate`.
- MCP tools auto-register as `mcp.<serverId>.<toolName>` in the tool registry.
- Streaming: `for await` over async iterable; `abortOnSensitive` stops on PII.
- Approval: catch `PolicyApprovalRequiredError`, call `approvals.approve`, then retry.
