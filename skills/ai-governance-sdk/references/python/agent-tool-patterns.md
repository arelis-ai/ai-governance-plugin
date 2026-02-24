# Python SDK — Agent & Tool Patterns

Governed agent loops with tool use using direct model provider calls.

---

## Gemini Function Calling with Governance

```python
from google import genai
from google.genai import types
import uuid
from datetime import datetime
from .governance import get_arelis_platform, ensure_ai_system_registered, scan_for_pii

MODEL_ID = "gemini-2.5-flash"
MAX_TOOL_ITERATIONS = 5

TOOL_DECLARATIONS = [
    types.FunctionDeclaration(
        name="search_knowledge_base",
        description="Search the knowledge base for information",
        parameters=types.Schema(
            type=types.Type.OBJECT,
            properties={
                "query": types.Schema(type=types.Type.STRING, description="Search query"),
            },
            required=["query"],
        ),
    ),
    types.FunctionDeclaration(
        name="schedule_meeting",
        description="Schedule a meeting with attendees",
        parameters=types.Schema(
            type=types.Type.OBJECT,
            properties={
                "title": types.Schema(type=types.Type.STRING, description="Meeting title"),
                "date": types.Schema(type=types.Type.STRING, description="Date"),
                "attendees": types.Schema(
                    type=types.Type.ARRAY,
                    items=types.Schema(type=types.Type.STRING),
                    description="Attendees",
                ),
            },
            required=["title", "date", "attendees"],
        ),
    ),
]

TOOL_TRUST_LEVELS = {
    "search_knowledge_base": "low",
    "schedule_meeting": "medium",
}


async def execute_tool(name: str, args: dict) -> dict:
    """Execute a tool by name. Replace with actual implementations."""
    if name == "search_knowledge_base":
        return {"success": True, "data": {"results": ["Result 1", "Result 2"]}}
    if name == "schedule_meeting":
        return {"success": True, "data": {"meeting_id": "mtg_123"}}
    return {"success": False, "error": f"Unknown tool: {name}"}


async def agent_loop(prompt: str, user_id: str):
    platform = get_arelis_platform()
    run_id = f"run-agent-{uuid.uuid4()}"
    ai_system_id = await ensure_ai_system_registered(platform, MODEL_ID)
    timestamp = datetime.utcnow().isoformat()

    ctx = {
        "org": {"id": "org_123", "name": "Acme"},
        "actor": {"type": "human", "id": user_id},
        "purpose": "chat",
        "environment": "prod",
    }

    client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
    contents = [types.Content(role="user", parts=[types.Part.from_text(text=prompt)])]
    tools = [types.Tool(function_declarations=TOOL_DECLARATIONS)]
    graph_events = []

    for iteration in range(MAX_TOOL_ITERATIONS):
        response = client.models.generate_content(
            model=MODEL_ID,
            contents=contents,
            config=types.GenerateContentConfig(tools=tools),
        )

        # Check for function calls
        function_calls = [
            part.function_call
            for part in (response.candidates[0].content.parts or [])
            if part.function_call
        ]

        if not function_calls:
            # No tool calls — return text response
            return response.text

        function_response_parts = []
        for fc in function_calls:
            trust_level = TOOL_TRUST_LEVELS.get(fc.name, "low")

            # BeforeToolCall governance check
            pii = scan_for_pii(str(fc.args))
            if pii["has_pii"] and ctx["environment"] == "prod":
                # Block tool call
                await platform.events.create({
                    "runId": run_id,
                    "aiSystemId": ai_system_id,
                    "eventType": "tool.call_blocked",
                    "actor": ctx["actor"],
                    "resource": {"type": "tool", "id": fc.name},
                    "action": "blocked_by_policy",
                    "timestamp": timestamp,
                    "metadata": {"toolName": fc.name, "trustLevel": trust_level},
                })
                function_response_parts.append(
                    types.Part.from_function_response(
                        name=fc.name,
                        response={"error": "Tool call blocked by governance policy"},
                    )
                )
                continue

            # Execute tool
            result = await execute_tool(fc.name, dict(fc.args))

            # Emit tool events
            await platform.events.create({
                "runId": run_id,
                "aiSystemId": ai_system_id,
                "eventType": "tool.call",
                "actor": {"type": "agent", "id": "agent"},
                "resource": {"type": "tool", "id": fc.name},
                "action": "invoke",
                "timestamp": timestamp,
                "metadata": {"toolName": fc.name, "step": iteration},
            })
            await platform.events.create({
                "runId": run_id,
                "aiSystemId": ai_system_id,
                "eventType": "tool.result",
                "actor": {"type": "agent", "id": "agent"},
                "resource": {"type": "tool", "id": fc.name},
                "action": "complete",
                "timestamp": timestamp,
                "metadata": {"toolName": fc.name, "success": result.get("success", False)},
            })

            graph_events.append({"eventId": f"{run_id}-tool-call-{fc.name}", "eventType": "tool.call", "action": "invoke"})
            graph_events.append({"eventId": f"{run_id}-tool-result-{fc.name}", "eventType": "tool.result", "action": "complete"})

            function_response_parts.append(
                types.Part.from_function_response(
                    name=fc.name,
                    response=result.get("data", {}),
                )
            )

        # IMPORTANT: Pass raw parts from model response verbatim
        # Gemini 3 includes thoughtSignature fields that must be preserved
        contents.append(response.candidates[0].content)
        contents.append(types.Content(role="user", parts=function_response_parts))

    return "Max tool iterations reached"
```

---

## Agent Step Tracking

Emit `agent.step` events for each iteration of the agent loop:

```python
await platform.events.create({
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
