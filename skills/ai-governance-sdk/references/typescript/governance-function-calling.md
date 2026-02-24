# AI Governance SDK — Governed Function Calling

Governed function calling with Gemini and NDJSON streaming protocol.

---

## Table of Contents

- [Governed Function Calling (Gemini)](#governed-function-calling-gemini)
- [NDJSON Streaming Protocol](#ndjson-streaming-protocol)

---

## Governed Function Calling (Gemini)

When using Gemini function calling with governance, every tool execution must be wrapped in policy checkpoints. The pattern uses a custom `generateWithTools()` method on the Gemini provider, a function calling loop in the API route, and NDJSON streaming to the client.

### Gemini Provider Extension

Extend your custom Gemini provider with `generateWithTools()` for non-streaming function call detection. Use an intersection type (not `extends`) because `ModelProvider` doesn't define the `id` property that providers include at runtime:

```typescript
import type { FunctionDeclaration } from '@google/genai';
import type { ModelProvider } from '@arelis-ai/ai-governance-sdk';

export interface FunctionCallPart {
  name: string;
  args: Record<string, unknown>;
}

export interface GenerateWithToolsResult {
  text: string | null;
  functionCalls: FunctionCallPart[];
  /** Raw parts from the model response — must be sent back verbatim to preserve thoughtSignature fields required by Gemini 3. */
  rawParts: Record<string, unknown>[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number };
}

// IMPORTANT: Use intersection type, not `interface extends ModelProvider`
export type GeminiProviderWithTools = ModelProvider & {
  generateWithTools(
    model: string,
    toolDeclarations: FunctionDeclaration[],
    contents: { role: string; parts: Record<string, unknown>[] }[],
  ): Promise<GenerateWithToolsResult>;
};
```

### Tool Declarations with Trust Levels

```typescript
import type { FunctionDeclaration, Type } from '@google/genai';

export const TOOL_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: 'schedule_meeting',
    description: 'Schedule a meeting with attendees',
    parameters: {
      type: 'OBJECT' as Type,
      properties: {
        title: { type: 'STRING' as Type, description: 'Meeting title' },
        // ...
      },
      required: ['title', 'date', 'time', 'attendees'],
    },
  },
];

export const TOOL_TRUST_LEVELS: Record<string, 'low' | 'medium' | 'high'> = {
  search_knowledge_base: 'low',
  run_compliance_check: 'low',
  get_user_info: 'medium',
  schedule_meeting: 'medium',
};
```

### Function Calling Loop with Governance Gates

```typescript
const MAX_TOOL_ITERATIONS = 5;

for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
  const response = await provider.generateWithTools(MODEL_ID, TOOL_DECLARATIONS, contents);

  if (response.functionCalls.length === 0) {
    sendJson({ type: 'text', content: response.text ?? '' });
    return response.text ?? '';
  }

  const functionResponseParts: Record<string, unknown>[] = [];

  for (const fc of response.functionCalls) {
    sendJson({ type: 'tool_call', name: fc.name, args: fc.args });

    // BeforeToolCall governance checkpoint (call policy engine directly!)
    const trustLevel = TOOL_TRUST_LEVELS[fc.name] ?? 'low';
    const policyResult = await chatbotPolicyEngine.evaluate({
      checkpoint: 'BeforeToolCall',
      context: ctx,
      data: { toolName: fc.name, args: fc.args, trustLevel },
    });

    if (policyResult.summary && !policyResult.summary.allowed) {
      sendJson({ type: 'tool_result', name: fc.name, success: false, decision: 'blocked', summary: reason });
      await platform.events.create({ runId, aiSystemId, eventType: 'tool.call_blocked', ... });
      functionResponseParts.push({ functionResponse: { name: fc.name, response: { error: '...' } } });
    } else {
      const toolResult = await executeTool(fc.name, fc.args);
      const afterResult = await chatbotPolicyEngine.evaluate({
        checkpoint: 'AfterToolResult', context: ctx, data: { output: toolResult },
      });
      sendJson({ type: 'tool_result', name: fc.name, success: toolResult.success, decision: 'allowed', summary: '...' });
      await Promise.all([
        platform.events.create({ runId, aiSystemId, eventType: 'tool.call', ... }),
        platform.events.create({ runId, aiSystemId, eventType: 'tool.result', ... }),
      ]);
      functionResponseParts.push({ functionResponse: { name: fc.name, response: toolResult.data } });
    }
  }

  // IMPORTANT: Push raw parts from the model response verbatim.
  // Gemini 3 "thinking" models include thoughtSignature fields on functionCall parts.
  // These MUST be preserved — reconstructing parts manually strips them and causes a 400 error.
  // See: https://ai.google.dev/gemini-api/docs/thought-signatures
  contents.push({ role: 'model', parts: response.rawParts });
  contents.push({ role: 'user', parts: functionResponseParts });
}
```

> **Gemini 3 thought signatures**: When using `gemini-3-*` models with function calling, the API response includes `thoughtSignature` fields on `functionCall` parts. You **must** pass these back verbatim in the conversation history. The `rawParts` field on `GenerateWithToolsResult` contains the unmodified parts array from `candidates[0].content.parts`. Never reconstruct parts manually (e.g. `.map(fc => ({ functionCall: { name, args } }))`) — this strips thought signatures and produces a `400 INVALID_ARGUMENT` error.

See [setup-nextjs.md — Next.js ReadableStream Route Pattern](setup-nextjs.md#nextjs-readablestream-route-pattern) for the complete route implementation.

### Tool Call Audit Events

Three event types for tool governance:
- `tool.call` — emitted when a tool is successfully invoked (action: `'invoke'`)
- `tool.result` — emitted after tool execution completes (action: `'result'`)
- `tool.call_blocked` — emitted when governance blocks a tool call (action: `'blocked_by_policy'`)

Include `toolName` and `trustLevel` in metadata. Resource type should be `'tool'` with the tool name as the ID.

---

## NDJSON Streaming Protocol

When function calling is enabled, the API route streams newline-delimited JSON instead of plain text. Set `Content-Type: application/x-ndjson; charset=utf-8`.

```
{"type":"text","content":"Here's what I found..."}
{"type":"tool_call","name":"search_knowledge_base","args":{"query":"GDPR"}}
{"type":"tool_result","name":"search_knowledge_base","success":true,"decision":"allowed","summary":"Completed successfully"}
{"type":"error","message":"Something went wrong"}
```

**Backward compatibility**: When `enableToolCalling` is not set in the request body, preserve the existing plain-text streaming path. The client should check `Content-Type` for `ndjson` to determine parsing mode.

### NDJSON Response Headers

```typescript
return new Response(readable, {
  headers: {
    'Content-Type': enableToolCalling
      ? 'application/x-ndjson; charset=utf-8'
      : 'text/plain; charset=utf-8',
    'Cache-Control': 'no-cache',
    'X-Accel-Buffering': 'no',
  },
});
```

### Client-Side NDJSON Parsing

```typescript
const isNdjson = res.headers.get('Content-Type')?.includes('ndjson');
let lineBuffer = '';

if (isNdjson) {
  lineBuffer += chunk;
  const lines = lineBuffer.split('\n');
  lineBuffer = lines.pop() ?? '';

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed.type === 'text') fullText += parsed.content ?? '';
      else if (parsed.type === 'tool_call') toolCalls.push({ name: parsed.name, args: parsed.args, decision: 'allowed' });
      else if (parsed.type === 'tool_result') { /* update matching tool call */ }
      else if (parsed.type === 'error') fullText += parsed.message ?? '';
    } catch {
      fullText += trimmed;
    }
  }
} else {
  fullText += chunk;  // Plain text backward compat
}
```
