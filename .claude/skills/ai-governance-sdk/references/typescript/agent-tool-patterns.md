# AI Governance SDK — Agent & Tool Patterns

Agent runtime, tool registry, MCP server integration, and knowledge base RAG.

---

## Table of Contents

- [Governed Agent Loop (createArelis.agents.run)](#governed-agent-loop-createarelisagentsrun)
- [Agent Runtime (Plan-Execute-Observe Loop)](#agent-runtime-plan-execute-observe-loop)
- [Knowledge Base RAG](#knowledge-base-rag)
- [MCP Server Integration](#mcp-server-integration)
- [Approval Workflow](#approval-workflow)

---

## Governed Agent Loop (`createArelis.agents.run`)

For SDK `1.2.1+`, prefer the unified orchestrator agent loop:

```typescript
import {
  createArelis,
  type AgentConversationMessage,
  type AgentModelResponse,
  type GovernedAgentTool,
} from '@arelis-ai/ai-governance-sdk';

const arelis = createArelis({
  platform: {
    apiKey: process.env.ARELIS_API_KEY!,
    ...(process.env.ARELIS_API_URL ? { baseUrl: process.env.ARELIS_API_URL } : {}),
  },
});

const tools: GovernedAgentTool[] = [
  {
    name: 'lookupRegulation',
    description: 'Look up details for a regulation',
    schema: {
      type: 'object',
      properties: { regulationName: { type: 'string' } },
      required: ['regulationName'],
    },
  },
];

async function invokeModel(input: {
  model: string;
  messages: AgentConversationMessage[];
}): Promise<AgentModelResponse> {
  // Call your provider and map to AgentModelResponse
  return { text: '...', finishReason: 'stop' };
}

const result = await arelis.agents.run({
  runId: `run-agent-${crypto.randomUUID()}`,
  model: 'gemini-2.5-flash',
  prompt: 'Summarize EU AI Act high-risk obligations.',
  tools,
  context: { environment: 'dev', purpose: 'agent-demo' },
  maxSteps: 6,
  invokeModel,
  executeToolCall: async ({ tool }) => ({ ok: true, tool: tool.name, args: tool.args }),
  mapOutput: ({ finalResponse }) => finalResponse.text ?? 'No final response',
});

console.log(result.status, result.steps.length, result.events.length);
console.log(result.graph.nodes.length, result.graph.edges.length);
console.log(result.risk?.action, result.proof);
for (const warning of result.warnings ?? []) {
  console.warn(warning); // non-fatal side-effect failures
}
```

`agents.run` includes pre-gate evaluation, multi-step model/tool loop, local causal graph capture, and best-effort platform sync (events/proof/risk).

---

## Agent Runtime (Plan-Execute-Observe Loop)

```typescript
import {
  createAgentRuntime,
  createToolRegistry,
  generateRunId,
  type AgentConfig,
  type AgentHandlers,
  type AgentStep,
  type ToolDefinition,
} from '@arelis-ai/ai-governance-sdk';

// Register tools the agent can use
const toolRegistry = createToolRegistry({ allowOverwrite: false });

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

// Agent config
const agentConfig: AgentConfig = {
  agentId: 'basic-agent',
  name: 'Basic Echo Agent',
  description: 'A simple agent demonstrating plan-execute-observe loop',
  systemPrompt: 'You are a helpful assistant.',
  limits: { maxSteps: 5, maxTimeMs: 30_000 },
  context: ctx,
  tools: ['echo'],
};

// Handlers
const handlers: AgentHandlers = {
  async plan(input, step) {
    if (step.stepNumber === 1) {
      return {
        action: 'use_tool',
        reasoning: 'Using echo tool',
        toolName: 'echo',
        toolInput: { message: typeof input === 'string' ? input : JSON.stringify(input) },
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
    return { result: execution.toolOutput, isComplete: step.stepNumber >= 2 };
  },
};

const runtime = createAgentRuntime({
  config: agentConfig,
  handlers,
  onStep: async (step) => console.log(`Step ${step.stepNumber}: ${step.phase}`),
});

const result = await runtime.run({ input: 'Hello from agent!', runId: generateRunId() });
console.log('Agent result:', result.output);
```

---

## Knowledge Base RAG

```typescript
import {
  createKBRegistry,
  createMemoryKBProvider,
} from '@arelis-ai/ai-governance-sdk';

const kbRegistry = createKBRegistry();

kbRegistry.registerKB({
  id: 'docs-kb',
  name: 'Documentation KB',
  provider: 'memory',
  governance: { dataClass: 'internal' },
  connection: {},
});

kbRegistry.setProvider('docs-kb', createMemoryKBProvider({
  kbId: 'docs-kb',
  documents: [
    { id: 'doc-1', text: 'AI Governance SDK provides governance for AI orchestration', title: 'Overview' },
    { id: 'doc-2', text: 'Policy checkpoints control execution flow', title: 'Governance' },
  ],
}));

const client = createArelisClient({
  modelRegistry,
  policyEngine: createAllowAllEngine(),
  auditSink: createConsoleSink({ pretty: true, timestamp: true }),
  kbRegistry,
});

// Manual retrieval
const retrievalResult = await client.knowledge.retrieve({
  kbId: 'docs-kb',
  query: { query: 'What is governance?', kb: 'docs-kb', topK: 2 },
  context: ctx,
});
console.log('Chunks:', retrievalResult.chunks.length);

// Auto-grounding (injects retrieved chunks into prompt)
const result = await client.models.generate({
  model: 'mock-model',
  request: { model: 'mock-model', messages: [{ role: 'user', content: 'Tell me about governance' }], context: ctx },
  context: ctx,
  grounding: { kbIds: ['docs-kb'], topK: 2 },
});
```

---

## MCP Server Integration

```typescript
import {
  createMCPRegistry,
  createMockMCPTransport,
  type MCPServerDescriptor,
} from '@arelis-ai/ai-governance-sdk';

const mcpRegistry = createMCPRegistry();
const toolRegistry = createToolRegistry();

const mockTransport = createMockMCPTransport({
  tools: [
    {
      name: 'get_weather',
      description: 'Get weather for location',
      inputSchema: {
        type: 'object',
        properties: { location: { type: 'string' } },
        required: ['location'],
      },
    },
  ],
  handler: async (name, args) => {
    if (name === 'get_weather') return { location: args.location, temperature: 22, conditions: 'Sunny' };
    return { error: `Unknown tool: ${name}` };
  },
});

mcpRegistry.registerServer({
  id: 'dev-tools',
  name: 'Development Tools',
  transport: { type: 'http', url: 'http://localhost:3000/mcp' },
  governance: { allowedTools: ['get_weather'] },
});
mcpRegistry.setTransport('dev-tools', mockTransport);
await mockTransport.connect();

const client = createArelisClient({
  modelRegistry,
  policyEngine: createAllowAllEngine(),
  auditSink: createConsoleSink({ pretty: true }),
  toolRegistry,
  mcpRegistry,
});

// Discover tools from server
const discovery = await client.mcp.discoverTools({ serverId: 'dev-tools', context: ctx });
console.log('Discovered:', discovery.tools.length, 'tools');

// Invoke discovered tool
const tool = toolRegistry.get('mcp.dev-tools.get_weather');
if (tool?.handler) {
  const weather = await tool.handler({ location: 'San Francisco' }, { runId: 'run_1', governance: ctx });
  console.log('Weather:', weather);
}

await mockTransport.disconnect();
```

---

## Approval Workflow

```typescript
import { PolicyApprovalRequiredError } from '@arelis-ai/ai-governance-sdk';

const approvalPolicy: PolicyEngine = {
  async evaluate() {
    return {
      decisions: [{ effect: 'require_approval', approvers: ['admin@example.com'], reason: 'High risk' }],
      summary: { allowed: false, blockReason: 'High risk', approvers: ['admin@example.com'] },
    };
  },
};

const client = createArelisClient({
  modelRegistry,
  policyEngine: approvalPolicy,
  auditSink: createConsoleSink({ pretty: true }),
});

try {
  await client.models.generate({
    model: 'mock-model',
    request: { model: 'mock-model', messages: [{ role: 'user', content: 'Approve this' }] },
    context: ctx,
  });
} catch (err) {
  if (err instanceof PolicyApprovalRequiredError) {
    console.log('Approval required:', err.approvalId);

    await client.approvals.approve({
      approvalId: err.approvalId ?? '',
      resolvedBy: 'admin@example.com',
      context: ctx,
    });

    // Retry — now succeeds
    const result = await client.models.generate({
      model: 'mock-model',
      request: { model: 'mock-model', messages: [{ role: 'user', content: 'Approve this' }] },
      context: ctx,
    });
    console.log('Result:', result.output.content);
  }
}
```
