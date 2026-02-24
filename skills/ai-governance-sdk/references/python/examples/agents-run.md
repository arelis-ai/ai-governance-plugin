# Agents Run

Governed agent loop with tool use via `agents.run`, including tool definitions,
model invocation callback, tool execution dispatch, and result inspection.

> Extracted from the comprehensive Python governance demo. See [setup-and-registration.md](setup-and-registration.md) for initialization.

## GovernedAgentTool Definitions

```python
from arelis import GovernedAgentTool

AGENT_TOOLS = [
    GovernedAgentTool(
        name="search_knowledge_base",
        description="Search the compliance knowledge base for regulatory information",
        schema={
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Search query"},
                "jurisdiction": {"type": "string", "description": "Optional jurisdiction filter"},
            },
            "required": ["query"],
        },
    ),
    GovernedAgentTool(
        name="check_compliance_status",
        description="Check the organization's compliance status for a regulation",
        schema={
            "type": "object",
            "properties": {
                "regulation_id": {"type": "string", "description": "Regulation identifier"},
            },
            "required": ["regulation_id"],
        },
    ),
    GovernedAgentTool(
        name="schedule_review",
        description="Schedule a compliance review meeting",
        schema={
            "type": "object",
            "properties": {
                "title": {"type": "string"},
                "date": {"type": "string"},
                "attendees": {"type": "array", "items": {"type": "string"}},
            },
            "required": ["title", "date"],
        },
    ),
]
```

## Model Invocation Callback

```python
from arelis import AgentModelResponse

async def invoke_agent_model(params: dict) -> AgentModelResponse:
    """Invoke Gemini for the agent loop. Returns AgentModelResponse."""
    response = gemini_client.models.generate_content(
        model=params["model"],
        contents=params["messages"],
    )
    return AgentModelResponse(text=response.text)
```

## Tool Execution Dispatch

```python
async def execute_agent_tool(params: dict) -> dict:
    """Execute a tool call within the governed agent loop."""
    tool = params["tool"]
    args = tool.args if hasattr(tool, "args") else {}

    if tool.name == "search_knowledge_base":
        return {
            "results": [
                {
                    "title": "EU AI Act Overview",
                    "summary": "The EU AI Act establishes risk-based regulation for AI systems.",
                    "jurisdiction": "EU",
                    "effective_date": "2025-08-01",
                },
                {
                    "title": "NIST AI RMF",
                    "summary": "NIST framework for managing AI risks throughout the lifecycle.",
                    "jurisdiction": "US",
                },
            ],
            "total": 2,
        }

    if tool.name == "check_compliance_status":
        return {
            "regulation_id": args.get("regulation_id", "eu-ai-act"),
            "status": "partially_compliant",
            "score": 0.72,
            "controls": [
                {"name": "Risk Classification", "status": "compliant", "score": 0.95},
                {"name": "Transparency", "status": "compliant", "score": 0.88},
                {"name": "Human Oversight", "status": "in_progress", "score": 0.65},
                {"name": "Documentation", "status": "in_progress", "score": 0.70},
                {"name": "Conformity Assessment", "status": "not_started", "score": 0.0},
            ],
        }

    if tool.name == "schedule_review":
        return {"meeting_id": f"mtg_{uuid.uuid4().hex[:8]}", "status": "scheduled"}

    return {"error": f"Unknown tool: {tool.name}"}
```

## agents.run Call

```python
from arelis import GovernedAgentRunInput, GovernanceContext, ActorRef, OrgRef

result = await arelis.agents.run(GovernedAgentRunInput(
    model=MODEL_GEMINI,
    prompt=(
        "Search the knowledge base for EU AI Act compliance requirements, "
        "check our current compliance status, and schedule a review meeting "
        "for next week with the compliance team."
    ),
    tools=AGENT_TOOLS,
    invoke_model=invoke_agent_model,
    execute_tool_call=execute_agent_tool,
    actor=ActorRef(type="human", id="demo-user"),
    context=GovernanceContext(
        org=OrgRef(id="org_demo", name="Demo Corp"),
        actor=ActorRef(type="human", id="demo-user"),
        purpose="compliance-review",
        environment="dev",
    ),
    max_steps=6,
    deny_mode="return",
    include_risk=True,
    proof_schema_version="v1",
))
```

## Result Inspection

```python
print(f"  Run ID: {result.run_id}")
print(f"  Status: {result.status}")
print(f"  Gate decision: {result.decision.decision}")
print(f"  Sanitized prompt: \"{result.sanitized_prompt[:80]}...\"")
print(f"  Steps: {len(result.steps)}")
for step in result.steps:
    print(f"    Step {step.step_number}: {len(step.tool_results)} tool result(s)")
print(f"  Local events: {len(result.events)}")
print(f"  Causal graph nodes: {len(result.graph.nodes) if result.graph else 0}")
if result.platform_events:
    print(f"  Platform events synced: {len(result.platform_events)}")
if result.platform_graph:
    print(f"  Platform graph: rootHash={result.platform_graph.get('rootHash', 'N/A')}")
if result.proof:
    print(f"  Proof: {result.proof.request}")
if result.risk:
    print(f"  Risk: {result.risk}")
for w in result.warnings or []:
    print(f"  Warning: {w}")
```

**Key patterns:**

- `GovernedAgentTool` defines tool name, description, and JSON Schema for arguments
- `invoke_model` callback receives `params["model"]` and `params["messages"]`, returns `AgentModelResponse(text=...)`
- `execute_tool_call` callback receives `params["tool"]` with `.name` and `.args`
- `max_steps` limits the agent loop iterations
- `proof_schema_version="v1"` enables automatic compliance proof generation
- Result includes `steps`, `events`, `graph`, `platform_events`, `platform_graph`, `proof`, `risk`, `warnings`
- The `aiSystemId` from client config auto-propagates through all agent governance
