# Python SDK — Agent & Tool Patterns

Governed agent loops with tool use.

---

## agents.run (Recommended)

The unified client provides `arelis.agents.run()` for multi-step governed agent loops with built-in PII gating, tool execution governance, causal graph construction, and proof generation:

```python
from arelis import (
    create_arelis,
    GovernedAgentRunInput,
    GovernedAgentTool,
    AgentModelResponse,
    AgentModelToolCall,
)

arelis = create_arelis({
    "platform": {
        "apiKey": os.environ["ARELIS_API_KEY"],
        **({"baseUrl": os.environ["ARELIS_API_URL"]} if os.environ.get("ARELIS_API_URL") else {}),
    }
})

tools = [
    GovernedAgentTool(
        name="search_knowledge_base",
        description="Search the knowledge base for information",
        schema={
            "type": "object",
            "properties": {"query": {"type": "string"}},
            "required": ["query"],
        },
    ),
    GovernedAgentTool(
        name="schedule_meeting",
        description="Schedule a meeting with attendees",
        schema={
            "type": "object",
            "properties": {
                "title": {"type": "string"},
                "date": {"type": "string"},
                "attendees": {"type": "array", "items": {"type": "string"}},
            },
            "required": ["title", "date", "attendees"],
        },
    ),
]


async def invoke_model(params: dict) -> AgentModelResponse:
    """Invoke the model with messages. Return AgentModelResponse."""
    from google import genai
    client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
    response = client.models.generate_content(
        model=params["model"],
        contents=params["messages"],
    )
    # Parse response into AgentModelResponse with tool_calls if present
    return AgentModelResponse(text=response.text)


async def execute_tool(params: dict) -> dict:
    """Execute a tool call. params has 'tool' with name, args."""
    tool = params["tool"]
    if tool.name == "search_knowledge_base":
        return {"results": ["Result 1", "Result 2"]}
    if tool.name == "schedule_meeting":
        return {"meeting_id": "mtg_123"}
    return {"error": f"Unknown tool: {tool.name}"}


result = await arelis.agents.run(GovernedAgentRunInput(
    model="gemini-2.5-flash",
    prompt="Search for EU AI Act info and schedule a review meeting.",
    tools=tools,
    invoke_model=invoke_model,
    execute_tool_call=execute_tool,
    actor={"type": "human", "id": "user_1"},
    context={
        "org": {"id": "org_123", "name": "Acme"},
        "purpose": "chat",
        "environment": "dev",
    },
    max_steps=5,                    # default: 8
    deny_mode="return",
    include_risk=True,
    proof_schema_version="v1",      # generate compliance proof
))

# Inspect result
print(f"Status: {result.status}")
print(f"Steps: {len(result.steps)}")
for step in result.steps:
    print(f"  Step {step.step_number}: {len(step.tool_results)} tool results")
if result.proof:
    print(f"Proof: {result.proof.request}")
if result.risk:
    print(f"Risk: {result.risk}")
```

### GovernedAgentRunResult fields

| Field | Type | Description |
|-------|------|-------------|
| `run_id` | `str` | Unique run identifier |
| `status` | `GovernedAgentRunStatus` | Completion status |
| `decision` | `PreInvocationGateDecision` | Pre-invocation gate result |
| `sanitized_prompt` | `str` | PII-redacted prompt |
| `steps` | `list[GovernedAgentStep]` | Step-by-step execution trace |
| `events` | `list[AuditEvent]` | Local audit events |
| `graph` | `CausalGraph` | Causal lineage graph |
| `output` | `TOutput | None` | Final output (via `map_output`) |
| `platform_events` | `list[EventRecord] | None` | Synced platform events |
| `platform_graph` | `CausalGraphResponse | None` | Platform causal graph |
| `proof` | `GovernedProofResult | None` | Compliance proof |
| `risk` | `RiskEvaluationResponse | None` | Risk assessment |
| `warnings` | `list[str] | None` | Non-fatal warnings |

---

## Manual Agent Loop (Low-Level)

For full control over the agent loop, use direct model provider calls with platform governance. This pattern is useful when `agents.run` doesn't fit your model provider's API (e.g., Gemini function calling with raw `types.Content`).

```python
from google import genai
from google.genai import types
from arelis import create_arelis_platform, scan_prompt_for_pii
import uuid
from datetime import datetime

MODEL_ID = "gemini-2.5-flash"
MAX_TOOL_ITERATIONS = 5

platform = create_arelis_platform({...})

TOOL_DECLARATIONS = [
    types.FunctionDeclaration(
        name="search_knowledge_base",
        description="Search the knowledge base for information",
        parameters=types.Schema(
            type=types.Type.OBJECT,
            properties={"query": types.Schema(type=types.Type.STRING)},
            required=["query"],
        ),
    ),
]

TOOL_TRUST_LEVELS = {"search_knowledge_base": "low"}


async def execute_tool(name: str, args: dict) -> dict:
    if name == "search_knowledge_base":
        return {"success": True, "data": {"results": ["Result 1"]}}
    return {"success": False, "error": f"Unknown tool: {name}"}


async def agent_loop(prompt: str, user_id: str, ai_system_id: str):
    run_id = f"run-agent-{uuid.uuid4()}"
    timestamp = datetime.utcnow().isoformat()
    ctx = {"actor": {"type": "human", "id": user_id}, "environment": "prod"}

    client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
    contents = [types.Content(role="user", parts=[types.Part.from_text(text=prompt)])]
    tools = [types.Tool(function_declarations=TOOL_DECLARATIONS)]
    graph_events = []

    for iteration in range(MAX_TOOL_ITERATIONS):
        response = client.models.generate_content(
            model=MODEL_ID, contents=contents,
            config=types.GenerateContentConfig(tools=tools),
        )

        function_calls = [
            part.function_call
            for part in (response.candidates[0].content.parts or [])
            if part.function_call
        ]

        if not function_calls:
            return response.text

        function_response_parts = []
        for fc in function_calls:
            # BeforeToolCall governance: PII scan on arguments
            pii = scan_prompt_for_pii(str(fc.args))
            if pii.has_pii and ctx["environment"] == "prod":
                platform.events.create({
                    "runId": run_id, "aiSystemId": ai_system_id,
                    "eventType": "tool.call_blocked",
                    "actor": ctx["actor"],
                    "resource": {"type": "tool", "id": fc.name},
                    "action": "blocked_by_policy",
                    "timestamp": timestamp,
                    "metadata": {"toolName": fc.name},
                })
                function_response_parts.append(
                    types.Part.from_function_response(
                        name=fc.name,
                        response={"error": "Tool call blocked by governance policy"},
                    )
                )
                continue

            result = await execute_tool(fc.name, dict(fc.args))

            # Emit tool events
            platform.events.create({
                "runId": run_id, "aiSystemId": ai_system_id,
                "eventType": "tool.call",
                "actor": {"type": "agent", "id": "agent"},
                "resource": {"type": "tool", "id": fc.name},
                "action": "invoke", "timestamp": timestamp,
                "metadata": {"toolName": fc.name, "step": iteration},
            })

            graph_events.append({"eventId": f"{run_id}-tool-{fc.name}", "eventType": "tool.call"})

            function_response_parts.append(
                types.Part.from_function_response(name=fc.name, response=result.get("data", {}))
            )

        # IMPORTANT: Pass raw parts verbatim — Gemini 3 thoughtSignature must be preserved
        contents.append(response.candidates[0].content)
        contents.append(types.Content(role="user", parts=function_response_parts))

    return "Max tool iterations reached"
```

---

## Agent Step Tracking (Manual Loop)

Emit `agent.step` events for each iteration:

```python
platform.events.create({
    "runId": run_id,
    "aiSystemId": ai_system_id,
    "eventType": "agent.step",
    "actor": {"type": "agent", "id": "agent"},
    "resource": {"type": "agent", "id": "agent"},
    "action": "step",
    "timestamp": timestamp,
    "metadata": {"stepNumber": iteration, "toolCalls": [fc.name for fc in function_calls]},
})
```
