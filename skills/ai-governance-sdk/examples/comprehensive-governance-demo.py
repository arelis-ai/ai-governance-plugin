"""
Arelis AI Governance SDK -- Comprehensive Python Demo

Demonstrates the FULL SDK surface using the unified `create_arelis` client:

  1.  Unified client initialization (`create_arelis`)
  2.  AI system registration & caching
  3.  Managed PII configuration from platform
  4.  SDK-native PII scanning (`scan_prompt_for_pii`)
  5.  Standalone governance gate (`with_governance_gate`)
  6.  High-level `governed_invoke` with Gemini & Claude
  7.  `agents.run` -- governed agent loop with tool use
  8.  Platform policy CRUD (create, version, simulate, activate)
  9.  Manual pre-invocation gate (`evaluate_pre_invocation_gate`)
 10.  BeforeToolCall / AfterToolResult custom policy evaluation
 11.  Platform events (create, batch, list, count)
 11b.  Platform policy evaluation (evaluatePolicy with PII denials)
 12.  Risk evaluation (low, medium, high scenarios)
 13.  Causal graph construction, commit, lineage
 14.  Compliance proof generation & verification
 15.  Post-stream pipeline (full 8-step)
 16.  MCP server registration & tool discovery
 17.  Quota monitoring & usage reporting
 18.  Error handling with typed error guards
 19.  Approval workflow events
 20.  Export & replay templates

Usage:
  pip install ai-governance-sdk google-genai anthropic python-dotenv
  python comprehensive-governance-demo.py

Required env vars:
  ARELIS_API_KEY       -- Arelis API key (ak_sandbox_... or ak_prod_...)
  ARELIS_API_URL       -- (optional) API base URL, defaults to https://api.arelis.digital
  GEMINI_API_KEY       -- Google Gemini API key
  ANTHROPIC_API_KEY    -- Anthropic API key
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
import uuid
from datetime import datetime, timezone
from typing import Any

from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[3] / ".env.local")
load_dotenv()

# ---------------------------------------------------------------------------
# Environment validation
# ---------------------------------------------------------------------------

REQUIRED_ENV = ["ARELIS_API_KEY", "GEMINI_API_KEY", "ANTHROPIC_API_KEY"]
for key in REQUIRED_ENV:
    if not os.environ.get(key):
        print(f"Missing required env var: {key}", file=sys.stderr)
        sys.exit(1)

# ---------------------------------------------------------------------------
# SDK imports
# ---------------------------------------------------------------------------

from arelis import (
    # Unified client
    create_arelis,
    # governed_invoke types
    GovernedInvokeInput,
    GovernedInvokeResult,
    # agents.run types
    GovernedAgentRunInput,
    GovernedAgentRunResult,
    GovernedAgentTool,
    AgentModelResponse,
    # Standalone governance functions
    scan_prompt_for_pii,
    ScanPromptForPiiOptions,
    evaluate_pre_invocation_gate,
    EvaluatePreInvocationGateInput,
    with_governance_gate,
    WithGovernanceGateOptions,
    # Managed PII config
    GetPiiConfigOptions,
    # Core types
    GovernanceContext,
    ActorRef,
    OrgRef,
    generate_run_id,
    # Error types & guards
    GovernanceGateDeniedError,
    PolicyBlockedError,
    ArelisError,
    is_governance_gate_denied_error,
    is_policy_blocked_error,
    is_arelis_error,
)
from google import genai
from google.genai import types as genai_types
import anthropic

# ---------------------------------------------------------------------------
# Model provider clients
# ---------------------------------------------------------------------------

gemini_client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
anthropic_client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])

MODEL_GEMINI = "gemini-2.5-flash"
MODEL_CLAUDE = "claude-sonnet-4-20250514"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def header(title: str) -> None:
    print(f"\n{'=' * 72}")
    print(f"  {title}")
    print(f"{'=' * 72}\n")


def section(title: str) -> None:
    print(f"--- {title} ---\n")


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def async_wrap(value):
    """Wrap a plain value in an async callable (required by with_governance_gate)."""
    async def _fn():
        return value
    return _fn


# =========================================================================
# 1. Unified Client Initialization
# =========================================================================


def init_arelis():
    """Initialize the unified Arelis client (singleton pattern)."""
    return create_arelis({
        "platform": {
            "apiKey": os.environ["ARELIS_API_KEY"],
            **({"baseUrl": os.environ["ARELIS_API_URL"]} if os.environ.get("ARELIS_API_URL") else {}),
        }
    })


# =========================================================================
# 2. AI System Registration & Caching
# =========================================================================

_ai_system_cache: dict[str, str] = {}


def ensure_ai_system(platform, model_id: str, provider: str) -> str:
    """Register an AI system if not already cached. Returns aiSystemId."""
    if model_id in _ai_system_cache:
        return _ai_system_cache[model_id]

    result = platform.aiSystems.list({"type": "model"})
    existing = result.get("data", [])
    match = next(
        (s for s in existing if s.get("modelRef") == model_id and s.get("status") == "active"),
        None,
    )
    if match:
        _ai_system_cache[model_id] = match["id"]
        print(f"  AI system exists: {model_id} -> {match['id']}")
        return match["id"]

    record = platform.aiSystems.register({
        "name": model_id,
        "type": "model",
        "provider": provider,
        "modelRef": model_id,
        "description": f"Governed AI system for {model_id}",
        "metadata": {"registeredAt": now_iso(), "demo": True},
        "tags": ["governance-demo", provider],
    })
    _ai_system_cache[model_id] = record["id"]
    print(f"  AI system registered: {model_id} -> {record['id']}")
    return record["id"]


# =========================================================================
# 3. Managed PII Configuration
# =========================================================================


async def demo_managed_pii_config(arelis) -> None:
    header("3. Managed PII Configuration from Platform")

    # Default namespace
    config = await arelis.governance.get_pii_config()
    print(f"  Default PII config loaded: {config}")

    # Custom namespace
    try:
        custom_config = await arelis.governance.get_pii_config(
            GetPiiConfigOptions(namespace="pii.strict")
        )
        print(f"  Strict PII config loaded: {custom_config}")
    except Exception as e:
        print(f"  Custom namespace 'pii.strict' not configured (expected): {e}")


# =========================================================================
# 4. SDK-Native PII Scanning
# =========================================================================


def demo_pii_scanning() -> None:
    header("4. SDK-Native PII Scanning")

    prompts = [
        "Hello, explain AI governance to me.",
        "My SSN is 123-45-6789 and email is john@acme.com.",
        "Call me at 555-867-5309. My card is 4111-1111-1111-1111.",
    ]

    for prompt in prompts:
        result = scan_prompt_for_pii(prompt, ScanPromptForPiiOptions(
            detect_emails=True,
            detect_phones=True,
            detect_ssns=True,
            detect_credit_cards=True,
        ))
        status = "PII FOUND" if result.has_pii else "CLEAN"
        print(f"  [{status}] \"{prompt[:60]}...\"")
        for finding in result.findings:
            print(f"    -> {finding.type}: \"{finding.original}\"")
    print()


# =========================================================================
# 5. Standalone Governance Gate (with_governance_gate)
# =========================================================================


async def demo_standalone_gate(arelis) -> None:
    header("5. Standalone Governance Gate (with_governance_gate)")

    # Gate with clean prompt -- should ALLOW
    section("5a. Clean prompt -> should ALLOW")
    result_clean = await with_governance_gate(
        source=arelis.platform,
        input=EvaluatePreInvocationGateInput(
            prompt="Explain AI governance best practices.",
            actor=ActorRef(type="human", id="demo-user"),
            run_id=generate_run_id(),
            model=MODEL_GEMINI,
        ),
        invoke=async_wrap("Simulated model response for clean prompt"),
        options=WithGovernanceGateOptions(
            deny_mode="return",
            detect_emails=True,
            detect_ssns=True,
        ),
    )
    print(f"  Invoked: {result_clean.invoked}")
    print(f"  Decision: {result_clean.decision.decision}")
    if result_clean.invoked:
        print(f"  Result: {result_clean.result}")
    for w in result_clean.warnings or []:
        print(f"  Warning: {w}")

    # Gate with PII prompt -- should DENY
    section("5b. PII prompt -> should DENY")
    result_pii = await with_governance_gate(
        source=arelis.platform,
        input=EvaluatePreInvocationGateInput(
            prompt="My SSN is 123-45-6789. Help me file taxes.",
            actor=ActorRef(type="human", id="demo-user"),
            run_id=generate_run_id(),
            model=MODEL_GEMINI,
        ),
        invoke=async_wrap("This should not be reached"),
        options=WithGovernanceGateOptions(deny_mode="return"),
    )
    print(f"  Invoked: {result_pii.invoked}")
    print(f"  Decision: {result_pii.decision.decision}")
    print(f"  PII found: {result_pii.decision.pii.has_pii}")
    print(f"  Reasons: {result_pii.decision.reasons}")
    print()


# =========================================================================
# 6. governed_invoke -- Gemini & Claude
# =========================================================================


async def demo_governed_invoke(arelis) -> dict[str, GovernedInvokeResult]:
    header("6. governed_invoke -- Gemini & Claude")
    results = {}

    # 6a. Gemini -- clean prompt
    section("6a. governed_invoke -> Gemini (clean)")
    result_gemini = await arelis.governed_invoke(GovernedInvokeInput(
        model=MODEL_GEMINI,
        prompt="List three key principles of responsible AI in one sentence each.",
        invoke=lambda sanitized: gemini_client.models.generate_content(
            model=MODEL_GEMINI, contents=sanitized
        ).text,
        actor=ActorRef(type="human", id="demo-user"),
        context=GovernanceContext(
            org=OrgRef(id="org_demo", name="Demo Corp"),
            actor=ActorRef(type="human", id="demo-user"),
            purpose="governance-demo",
            environment="dev",
        ),
        deny_mode="return",
        include_risk=True,
    ))
    print(f"  Run ID: {result_gemini.run_id}")
    print(f"  Invoked: {result_gemini.invoked}")
    print(f"  Sanitized prompt: \"{result_gemini.sanitized_prompt[:80]}...\"")
    if result_gemini.invoked:
        print(f"  Response: \"{str(result_gemini.result)[:150]}...\"")
    print(f"  Risk: {result_gemini.risk}")
    for w in result_gemini.warnings or []:
        print(f"  Warning: {w}")
    results["gemini_clean"] = result_gemini

    # 6b. Claude -- clean prompt
    section("6b. governed_invoke -> Claude (clean)")
    result_claude = await arelis.governed_invoke(GovernedInvokeInput(
        model=MODEL_CLAUDE,
        prompt="What are the three most important AI compliance considerations for enterprises?",
        invoke=lambda sanitized: anthropic_client.messages.create(
            model=MODEL_CLAUDE,
            max_tokens=512,
            messages=[{"role": "user", "content": sanitized}],
        ).content[0].text,
        actor=ActorRef(type="human", id="demo-user"),
        context=GovernanceContext(
            org=OrgRef(id="org_demo", name="Demo Corp"),
            actor=ActorRef(type="human", id="demo-user"),
            purpose="governance-demo",
            environment="dev",
        ),
        deny_mode="return",
    ))
    print(f"  Run ID: {result_claude.run_id}")
    print(f"  Invoked: {result_claude.invoked}")
    if result_claude.invoked:
        print(f"  Response: \"{str(result_claude.result)[:150]}...\"")
    results["claude_clean"] = result_claude

    # 6c. governed_invoke with PII -- should be blocked
    section("6c. governed_invoke with PII -> should BLOCK")
    result_blocked = await arelis.governed_invoke(GovernedInvokeInput(
        model=MODEL_GEMINI,
        prompt="My SSN is 123-45-6789 and my email is sensitive@secret.com. Summarize my taxes.",
        invoke=lambda sanitized: "SHOULD NOT REACH HERE",
        deny_mode="return",
    ))
    print(f"  Invoked: {result_blocked.invoked}")
    print(f"  Decision: {result_blocked.decision.decision}")
    print(f"  PII detected: {result_blocked.decision.pii.has_pii}")
    print(f"  Codes: {result_blocked.decision.codes}")
    results["pii_blocked"] = result_blocked

    # 6d. governed_invoke with deny_mode="throw"
    section("6d. governed_invoke deny_mode='throw' -> should raise")
    try:
        await arelis.governed_invoke(GovernedInvokeInput(
            model=MODEL_GEMINI,
            prompt="SSN 999-88-7777 -- process this immediately.",
            invoke=lambda s: "SHOULD NOT REACH",
            deny_mode="throw",
        ))
        print("  ERROR: Should have raised GovernanceGateDeniedError")
    except GovernanceGateDeniedError as e:
        print(f"  Caught GovernanceGateDeniedError: {e.decision}")
        print(f"  is_governance_gate_denied_error: {is_governance_gate_denied_error(e)}")
    except Exception as e:
        print(f"  Caught unexpected error: {type(e).__name__}: {e}")

    print()
    return results


# =========================================================================
# 7. agents.run -- Governed Agent Loop with Tool Use
# =========================================================================

# Define agent tools
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


async def invoke_agent_model(params: dict) -> AgentModelResponse:
    """Invoke Gemini for the agent loop. Returns AgentModelResponse."""
    response = gemini_client.models.generate_content(
        model=params["model"],
        contents=params["messages"],
    )
    return AgentModelResponse(text=response.text)


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


async def demo_agents_run(arelis) -> GovernedAgentRunResult | None:
    header("7. agents.run -- Governed Agent Loop with Tool Use")

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
    print()
    return result


# =========================================================================
# 8. Platform Policy CRUD
# =========================================================================


def demo_policy_crud(platform) -> str:
    header("8. Platform Policy CRUD")

    POLICY_KEY = "demo-content-safety"

    # List existing
    existing = platform.governance.policies.list({"search": POLICY_KEY})
    match = next((p for p in existing.get("data", []) if p.get("key") == POLICY_KEY), None)

    if match:
        policy_id = match["id"]
        print(f"  Policy exists: {policy_id}")
    else:
        # Create policy
        policy = platform.governance.policies.create({
            "key": POLICY_KEY,
            "name": "Content Safety Gate",
            "description": "Blocks prompts with unsafe content signals.",
            "condition": {
                "field": "content.toxicity_score",
                "operator": "gt",
                "value": 0.8,
            },
            "action": "deny",
            "severity": "high",
            "priority": 2,
        })
        policy_id = policy["id"]
        print(f"  Policy created: {policy_id}")

    # Create a new version
    section("Create policy version")
    try:
        version = platform.governance.policies.createVersion(policy_id, {
            "condition": {
                "field": "content.toxicity_score",
                "operator": "gt",
                "value": 0.7,
            },
            "action": "deny",
            "severity": "critical",
        })
        print(f"  Version created: {version}")
    except Exception as e:
        print(f"  Version creation (may already exist): {e}")

    # List versions
    section("List policy versions")
    try:
        versions = platform.governance.policies.listVersions(policy_id)
        print(f"  Versions: {len(versions.get('data', []))}")
    except Exception as e:
        print(f"  List versions: {e}")

    # Simulate policy
    section("Simulate policy evaluation")
    try:
        sim_result = platform.governance.policies.simulate(policy_id, {
            "checkpoint": {
                "content": {"toxicity_score": 0.95},
            },
        })
        print(f"  Simulation result: {sim_result}")
    except Exception as e:
        print(f"  Simulation: {e}")

    print()
    return policy_id


# =========================================================================
# 9. Manual Pre-Invocation Gate (evaluate_pre_invocation_gate)
# =========================================================================


async def demo_manual_gate(arelis) -> None:
    header("9. Manual Pre-Invocation Gate (evaluate_pre_invocation_gate)")

    ctx = GovernanceContext(
        org=OrgRef(id="org_demo", name="Demo Corp"),
        actor=ActorRef(type="human", id="demo-user", email="demo@corp.com", roles=["analyst"]),
        purpose="compliance-check",
        environment="dev",
        session_id=f"sess_{uuid.uuid4().hex[:8]}",
        tags={"feature": "governance-demo"},
    )

    decision = await evaluate_pre_invocation_gate(
        source=arelis.platform,
        input=EvaluatePreInvocationGateInput(
            prompt="Analyze compliance gaps for our high-risk AI system.",
            actor=ActorRef(type="human", id="demo-user"),
            run_id=generate_run_id(),
            model=MODEL_GEMINI,
            context=ctx,
        ),
        options=ScanPromptForPiiOptions(
            detect_emails=True,
            detect_phones=True,
            detect_ssns=True,
            detect_credit_cards=True,
        ),
    )

    print(f"  Decision: {decision.decision}")
    print(f"  PII found: {decision.pii.has_pii}")
    print(f"  Policy: {decision.policy}")
    print(f"  Timings: {decision.metadata.timings if hasattr(decision.metadata, 'timings') else 'N/A'}")
    print()


# =========================================================================
# 10. BeforeToolCall / AfterToolResult Custom Policy
# =========================================================================


def demo_tool_governance() -> None:
    header("10. BeforeToolCall / AfterToolResult Custom Policy Evaluation")

    # BeforeToolCall -- PII in tool arguments
    section("BeforeToolCall: PII scan on tool args")
    tool_args_clean = {"query": "EU AI Act compliance requirements"}
    tool_args_pii = {"query": "Look up SSN 123-45-6789 in the database"}

    for label, args in [("clean", tool_args_clean), ("with PII", tool_args_pii)]:
        pii = scan_prompt_for_pii(str(args))
        allowed = not pii.has_pii
        print(f"  [{label}] PII found: {pii.has_pii} -> {'ALLOW' if allowed else 'BLOCK'}")
        for f in pii.findings:
            print(f"    -> {f.type}: \"{f.original}\"")

    # AfterToolResult -- credential detection
    section("AfterToolResult: Credential pattern scan")
    import re
    cred_pattern = r"(?:api[_-]?key|secret|password|bearer\s+token|access[_-]?token)\s*[:=]\s*\S{8,}"

    tool_outputs = [
        {"data": {"results": ["EU AI Act effective 2025"]}},
        {"data": {"config": "api_key=sk_live_EXAMPLE_KEY_REPLACE_ME"}},
    ]

    for i, output in enumerate(tool_outputs):
        output_str = str(output)
        has_creds = bool(re.search(cred_pattern, output_str, re.IGNORECASE))
        status = "CREDENTIAL DETECTED" if has_creds else "CLEAN"
        print(f"  Output {i + 1}: [{status}]")

    print()


# =========================================================================
# 11. Platform Events
# =========================================================================


def demo_platform_events(platform, ai_system_id: str) -> list[dict]:
    header("11. Platform Events (create, batch, list, count)")
    run_id = f"run-events-demo-{uuid.uuid4()}"
    events_log = []

    # Single event
    section("Create single event")
    ts = now_iso()
    ev1 = platform.events.create({
        "runId": run_id,
        "aiSystemId": ai_system_id,
        "eventType": "model.invoked",
        "actor": {"type": "human", "id": "demo-user"},
        "resource": {"type": "model", "id": MODEL_GEMINI},
        "action": "inference",
        "timestamp": ts,
        "metadata": {"demo": True, "responseLength": 256},
    })
    print(f"  Event created: {ev1.get('eventId', ev1)}")
    events_log.append({"eventId": ev1.get("eventId", ""), "eventType": "model.invoked", "timestamp": ts})

    # Batch events
    section("Create batch events")
    ts2 = now_iso()
    try:
        batch = platform.events.createBatch([
            {
                "runId": run_id,
                "aiSystemId": ai_system_id,
                "eventType": "output.delivered",
                "actor": {"type": "human", "id": "demo-user"},
                "resource": {"type": "model", "id": MODEL_GEMINI},
                "action": "deliver",
                "timestamp": ts2,
                "metadata": {"outputLength": 256},
            },
            {
                "runId": run_id,
                "aiSystemId": ai_system_id,
                "eventType": "policy.evaluated",
                "actor": {"type": "human", "id": "demo-user"},
                "resource": {"type": "model", "id": MODEL_GEMINI},
                "action": "evaluate",
                "timestamp": ts2,
                "metadata": {"checkpoints": ["BeforePrompt"]},
            },
        ])
        print(f"  Batch created: {batch}")
    except Exception as e:
        print(f"  Batch (may not be supported): {e}")

    # Governance gate event with PII (triggers policy denials)
    section("Emit governance gate event with PII")
    try:
        platform.events.create({
            "runId": run_id,
            "aiSystemId": ai_system_id,
            "eventType": "governance.gate.evaluated",
            "actor": {"type": "human", "id": "demo-user"},
            "resource": {"type": "model", "id": MODEL_GEMINI},
            "action": "evaluate",
            "timestamp": now_iso(),
            "metadata": {
                "pii_detected": True,
                "pii_types": ["ssn", "email"],
                "pii_count": 2,
                "decision": "deny",
            },
        })
        print(f"  governance.gate.evaluated event emitted (PII detected)")
    except Exception as e:
        print(f"  governance.gate.evaluated: {e}")

    # List events
    section("List events for run")
    try:
        event_list = platform.events.list({"runId": run_id})
        print(f"  Events found: {len(event_list.get('data', []))}")
    except Exception as e:
        print(f"  List events: {e}")

    # Count events
    section("Count events")
    try:
        count = platform.events.count({"runId": run_id})
        print(f"  Event count: {count}")
    except Exception as e:
        print(f"  Count events: {e}")

    print()
    return events_log


# =========================================================================
# 11b. Platform Policy Evaluation (evaluatePolicy)
# =========================================================================


def demo_policy_evaluation(platform) -> None:
    header("11b. Platform Policy Evaluation (evaluatePolicy)")
    run_id = f"run-policy-eval-{uuid.uuid4()}"

    section("evaluatePolicy with PII (should trigger denials)")
    try:
        result_pii = platform.governance.evaluatePolicy({
            "runId": run_id,
            "checkpoint": {
                "content": {"pii_detected": True, "pii_types": ["ssn", "email"], "pii_count": 2},
            },
        })
        decisions = result_pii.get("decisions", [])
        deny_count = sum(1 for d in decisions if d.get("decision") == "deny")
        allow_count = sum(1 for d in decisions if d.get("decision") == "allow")
        print(f"  Decisions: {len(decisions)} total ({deny_count} deny, {allow_count} allow)")
        for d in decisions:
            decision = d.get("decision", "?")
            name = d.get("metadata", {}).get("policyName", d.get("policyId", "?"))
            if decision == "deny":
                print(f"  - {decision} ({name})")
    except Exception as e:
        print(f"  evaluatePolicy (PII) failed: {e}")

    section("evaluatePolicy clean (should all allow)")
    try:
        result_clean = platform.governance.evaluatePolicy({
            "runId": f"{run_id}-clean",
            "checkpoint": {
                "content": {"pii_detected": False, "pii_types": [], "pii_count": 0},
            },
        })
        decisions = result_clean.get("decisions", [])
        deny_count = sum(1 for d in decisions if d.get("decision") == "deny")
        allow_count = sum(1 for d in decisions if d.get("decision") == "allow")
        print(f"  Decisions: {len(decisions)} total ({deny_count} deny, {allow_count} allow)")
    except Exception as e:
        print(f"  evaluatePolicy (clean) failed: {e}")

    print()


# =========================================================================
# 12. Risk Evaluation
# =========================================================================


def demo_risk_evaluation(platform, ai_system_id: str) -> list[dict]:
    header("12. Risk Evaluation")
    run_id = f"run-risk-{uuid.uuid4()}"

    try:
        risk = platform.risk.evaluate({
            "runId": run_id,
            "aiSystemId": ai_system_id,
            "policyDecisions": [
                {"effect": "block", "reason": "PII detected in prompt", "code": "PII_DENY"},
                {"effect": "block", "reason": "Credential pattern in output", "code": "CRED_LEAK"},
            ],
            "quotaState": {},
            "evaluationSignals": [],
            "explicitSignals": {
                "surface": "model",
                "outcome": "blocked",
                "environment": "prod",
                "contentSafety": "fail",
                "credentialDetected": True,
            },
        })
        print(f"  Action: {risk.get('action')} | Score: {risk.get('score')}")
        print(f"  Hash: {risk.get('deterministicInputsHash', 'N/A')[:24]}...")
        return [{"action": risk.get("action"), "score": risk.get("score")}]
    except Exception as e:
        print(f"  Risk evaluation failed: {e}")
        return [{"action": "error", "score": -1}]


# =========================================================================
# 13. Causal Graph Construction, Commit, Lineage
# =========================================================================


def demo_causal_graph(platform, run_id: str, events: list[dict]) -> dict | None:
    header("13. Causal Graph -- Build, Commit, Lineage")

    if not events:
        print("  No events to build graph from -- skipping")
        return None

    # Build nodes from event log
    nodes = [
        {
            "id": ev.get("eventId", f"{run_id}-node-{i}"),
            "type": ev["eventType"],
            "data": {"timestamp": ev.get("timestamp", now_iso())},
        }
        for i, ev in enumerate(events)
    ]

    # Build sequential edges
    edges = [
        {"source": nodes[i - 1]["id"], "target": nodes[i]["id"], "type": "sequence"}
        for i in range(1, len(nodes))
    ]

    print(f"  Nodes: {len(nodes)}")
    for n in nodes:
        print(f"    [{n['type']}] {n['id'][:40]}...")
    print(f"  Edges: {len(edges)}")
    for e in edges:
        print(f"    {e['source'][:20]}... -> {e['target'][:20]}...")

    # Submit causal graph (MUST precede commit)
    try:
        platform.replay.startCausalGraph({"runId": run_id, "nodes": nodes, "edges": edges})
        print("  Graph submitted")
    except Exception as e:
        print(f"  startCausalGraph failed: {e}")
        return None

    # Commit (ALWAYS LAST)
    try:
        commit = platform.graphs.commit(run_id)
        print(f"  Committed: rootHash={commit['rootHash'][:24]}...")
    except Exception as e:
        print(f"  graphs.commit failed: {e}")
        return None

    # Query lineage
    try:
        lineage = platform.graphs.lineage(run_id, nodes[0]["id"])
        print(f"  Lineage: {len(lineage['nodes'])} node(s), {len(lineage['edges'])} edge(s)")
    except Exception as e:
        print(f"  Lineage query: {e}")

    print()
    return {"rootHash": commit["rootHash"], "nodeCount": len(nodes), "edgeCount": len(edges)}


# =========================================================================
# 14. Compliance Proof Generation & Verification
# =========================================================================


def demo_compliance_proofs(platform, run_id: str, ai_system_id: str) -> dict | None:
    header("14. Compliance Proofs -- Generate & Verify")

    # Generate proof
    try:
        proof = platform.proofs.create({
            "runId": run_id,
            "aiSystemId": ai_system_id,
            "schemaVersion": "v1",
        })
        print(f"  Proof ID: {proof.get('proofId', 'N/A')}")
        print(f"  Proof hash: {proof.get('proofHash', 'N/A')}")
        if "layers" in proof:
            print(f"  Layers: {', '.join(l.get('name', '?') for l in proof['layers'])}")
    except Exception as e:
        print(f"  proofs.create failed: {e}")
        return None

    # Verify proof
    try:
        verification = platform.proofs.verify({"proofId": proof["proofId"]})
        print(f"  Verified: {verification['verified']}")
        for layer in verification.get("layers", []):
            status = "PASS" if layer.get("passed") else "FAIL"
            print(f"    {layer.get('name', '?')}: {status}")
    except Exception as e:
        print(f"  proofs.verify failed: {e}")

    print()
    return {"proofId": proof.get("proofId"), "verified": verification.get("verified", False)}


# =========================================================================
# 15. Post-Stream Pipeline (Full 8-Step)
# =========================================================================


def demo_post_stream_pipeline(platform, ai_system_id: str) -> None:
    header("15. Post-Stream Pipeline (Full 8-Step)")

    run_id = f"run-pipeline-{uuid.uuid4()}"
    actor = {"type": "human", "id": "demo-user"}
    timestamp = now_iso()
    total_output = "This is a simulated model output for the post-stream pipeline demo."

    # A. Policy decisions (from earlier gate)
    policy_decisions = [{"policyId": "pii-deny", "decision": "allow", "severity": "low"}]
    print("  A. Policy decisions extracted")

    # B. Emit policy.evaluated event
    try:
        platform.events.create({
            "runId": run_id,
            "aiSystemId": ai_system_id,
            "eventType": "policy.evaluated",
            "actor": actor,
            "resource": {"type": "model", "id": MODEL_GEMINI},
            "action": "evaluate",
            "timestamp": timestamp,
            "metadata": {
                "checkpoints": ["BeforePrompt", "AfterModelOutput"],
                "decisionsCount": len(policy_decisions),
                "pii_detected": False,
            },
        })
        print("  B. policy.evaluated event emitted")
    except Exception as e:
        print(f"  B. policy.evaluated failed: {e}")

    # C. Emit model.invoked + output.delivered
    try:
        platform.events.create({
            "runId": run_id,
            "aiSystemId": ai_system_id,
            "eventType": "model.invoked",
            "actor": actor,
            "resource": {"type": "model", "id": MODEL_GEMINI},
            "action": "inference",
            "timestamp": timestamp,
            "metadata": {"responseLength": len(total_output)},
        })
        platform.events.create({
            "runId": run_id,
            "aiSystemId": ai_system_id,
            "eventType": "output.delivered",
            "actor": actor,
            "resource": {"type": "model", "id": MODEL_GEMINI},
            "action": "deliver",
            "timestamp": timestamp,
            "metadata": {"outputLength": len(total_output), "containsPII": False},
        })
        print("  C. model.invoked + output.delivered events emitted")
    except Exception as e:
        print(f"  C. Events failed: {e}")

    # D. Post-stream policy evaluation (AfterModelOutput)
    try:
        eval_result = platform.governance.evaluatePolicy({
            "runId": run_id,
            "checkpoint": {
                "content": {"pii_detected": True, "pii_types": ["email"], "pii_count": 1},
            },
        })
        decisions = eval_result.get("decisions", [])
        deny_count = sum(1 for d in decisions if d.get("decision") == "deny")
        print(f"  D. Policy evaluated: {len(decisions)} decisions ({deny_count} deny)")
    except Exception as e:
        print(f"  D. Post-stream evaluatePolicy: {e}")

    # E. Risk evaluation
    try:
        risk = platform.risk.evaluate({
            "runId": run_id,
            "aiSystemId": ai_system_id,
            "policyDecisions": policy_decisions,
            "quotaState": {},
            "evaluationSignals": [],
            "explicitSignals": {"surface": "model", "outcome": "allowed"},
        })
        print(f"  E. Risk evaluated: action={risk.get('action')}, score={risk.get('score')}")
    except Exception as e:
        print(f"  E. risk.evaluate: {e}")

    # F. Compliance proof
    try:
        proof = platform.proofs.create({
            "runId": run_id,
            "aiSystemId": ai_system_id,
            "schemaVersion": "v1",
        })
        print(f"  F. Proof created: {proof.get('proofId', 'N/A')}")
    except Exception as e:
        print(f"  F. proofs.create: {e}")

    # G. Causal graph (MUST precede commit)
    graph_events = [
        {"eventId": f"{run_id}-policy-evaluated", "eventType": "policy.evaluated"},
        {"eventId": f"{run_id}-model-invoked", "eventType": "model.invoked"},
        {"eventId": f"{run_id}-output-delivered", "eventType": "output.delivered"},
    ]
    nodes = [
        {"id": ev["eventId"], "type": ev["eventType"], "data": {"timestamp": timestamp}}
        for ev in graph_events
    ]
    edges = [
        {"source": graph_events[i - 1]["eventId"], "target": graph_events[i]["eventId"], "type": "sequence"}
        for i in range(1, len(graph_events))
    ]
    try:
        platform.replay.startCausalGraph({"runId": run_id, "nodes": nodes, "edges": edges})
        print("  G. Causal graph submitted")
    except Exception as e:
        print(f"  G. startCausalGraph: {e}")

    # H. Commit causal graph (ALWAYS LAST)
    try:
        commit = platform.graphs.commit(run_id)
        print(f"  H. Graph committed: rootHash={commit['rootHash'][:20]}...")
    except Exception as e:
        print(f"  H. graphs.commit: {e}")

    print()


# =========================================================================
# 16. MCP Server Registration & Tool Discovery
# =========================================================================


def demo_mcp_server(platform) -> None:
    header("16. MCP Server Registration & Tool Discovery")

    # Register MCP server
    section("Register MCP server")
    try:
        server = platform.mcpServers.create({
            "name": "compliance-tools-mcp",
            "url": "https://mcp.example.com/compliance",
            "description": "MCP server providing compliance checking tools",
            "metadata": {"version": "1.0", "capabilities": ["tool-use"]},
        })
        server_id = server.get("id", "unknown")
        print(f"  MCP server registered: {server_id}")

        # List MCP servers
        servers = platform.mcpServers.list({})
        print(f"  Total MCP servers: {len(servers.get('data', []))}")

        # Discover tools
        try:
            tools = platform.mcpServers.listTools(server_id)
            print(f"  Tools discovered: {len(tools.get('data', []))}")
        except Exception as e:
            print(f"  Tool discovery: {e}")

        # Health check
        try:
            health = platform.mcpServers.healthCheck(server_id)
            print(f"  Health: {health}")
        except Exception as e:
            print(f"  Health check: {e}")

    except Exception as e:
        print(f"  MCP registration: {e}")

    print()


# =========================================================================
# 17. Quota Monitoring & Usage Reporting
# =========================================================================


def demo_quota_and_usage(platform) -> None:
    header("17. Quota Monitoring & Usage Reporting")

    # Check usage
    section("Current usage")
    try:
        usage = platform.usage.get({})
        print(f"  Usage: {json.dumps(usage, indent=2)[:300]}")
    except Exception as e:
        print(f"  usage.get: {e}")

    # Usage history
    section("Usage history")
    try:
        history = platform.usage.history({})
        print(f"  History entries: {len(history.get('data', []))}")
    except Exception as e:
        print(f"  usage.history: {e}")

    # Billing summary
    section("Billing summary")
    try:
        billing = platform.billing.summary({})
        print(f"  Billing: {json.dumps(billing, indent=2)[:300]}")
    except Exception as e:
        print(f"  billing.summary: {e}")

    # Telemetry report
    section("Telemetry usage report")
    try:
        platform.telemetry.reportUsage({
            "metrics": {
                "governed_invoke_calls": 15,
                "agent_runs": 3,
                "events_emitted": 42,
                "proofs_generated": 5,
            },
            "timestamp": now_iso(),
        })
        print("  Telemetry report submitted")
    except Exception as e:
        print(f"  telemetry.reportUsage: {e}")

    print()


# =========================================================================
# 18. Error Handling with Typed Guards
# =========================================================================


async def demo_error_handling(arelis) -> None:
    header("18. Error Handling with Typed Error Guards")

    errors_caught = []

    # GovernanceGateDeniedError
    try:
        await arelis.governed_invoke(GovernedInvokeInput(
            model=MODEL_GEMINI,
            prompt="SSN 111-22-3333 -- process this.",
            invoke=lambda s: "UNREACHABLE",
            deny_mode="throw",
        ))
    except GovernanceGateDeniedError as e:
        errors_caught.append("GovernanceGateDeniedError")
        print(f"  GovernanceGateDeniedError caught:")
        print(f"    is_governance_gate_denied_error: {is_governance_gate_denied_error(e)}")
        print(f"    is_policy_blocked_error: {is_policy_blocked_error(e)}")
        print(f"    is_arelis_error: {is_arelis_error(e)}")
    except Exception as e:
        errors_caught.append(type(e).__name__)
        print(f"  Caught: {type(e).__name__}: {e}")
        print(f"    is_arelis_error: {is_arelis_error(e)}")

    print(f"\n  Errors caught: {errors_caught}")
    print()


# =========================================================================
# 19. Approval Workflow Events
# =========================================================================


def demo_approval_workflow(platform, ai_system_id: str) -> None:
    header("19. Approval Workflow Events")
    run_id = f"run-approval-{uuid.uuid4()}"

    # Emit approval.requested event
    ts = now_iso()
    try:
        platform.events.create({
            "runId": run_id,
            "aiSystemId": ai_system_id,
            "eventType": "approval.requested",
            "actor": {"type": "agent", "id": "compliance-agent"},
            "resource": {"type": "tool", "id": "financial-report-generator"},
            "action": "request_approval",
            "timestamp": ts,
            "metadata": {
                "approvalId": f"appr_{uuid.uuid4().hex[:8]}",
                "approvers": ["cfo@acme.com", "compliance@acme.com"],
                "reason": "Financial reporting tool requires approval in prod",
                "context": {"purpose": "financial-reporting", "environment": "prod"},
            },
        })
        print("  approval.requested event emitted")
    except Exception as e:
        print(f"  approval.requested: {e}")

    # List approvals
    try:
        approvals = platform.approvals.list({})
        print(f"  Pending approvals: {len(approvals.get('data', []))}")
    except Exception as e:
        print(f"  approvals.list: {e}")

    print()


# =========================================================================
# 20. Export & Replay Templates
# =========================================================================


def demo_export_and_replay(platform) -> None:
    header("20. Export & Replay Templates")

    # Create export
    section("Create export")
    try:
        export = platform.exports.create({
            "type": "events",
            "format": "json",
            "filters": {"eventType": "model.invoked"},
        })
        print(f"  Export created: {export}")
    except Exception as e:
        print(f"  exports.create: {e}")

    # List exports
    try:
        exports = platform.exports.list({})
        print(f"  Exports: {len(exports.get('data', []))}")
    except Exception as e:
        print(f"  exports.list: {e}")

    # Replay templates
    section("Replay templates")
    try:
        templates = platform.replay.listTemplates({})
        print(f"  Replay templates: {len(templates.get('data', []))}")
    except Exception as e:
        print(f"  replay.listTemplates: {e}")

    print()


# =========================================================================
# Main
# =========================================================================


async def main() -> None:
    header("Arelis AI Governance SDK -- Comprehensive Python Demo")
    print("This demo exercises the FULL SDK surface across 20 sections.\n")

    # 1. Initialize unified client
    header("1. Unified Client Initialization")
    arelis = init_arelis()
    platform = arelis.platform
    print("  Arelis unified client initialized")
    print(f"  Namespaces: governed_invoke, agents.run, governance, platform")

    # 2. Register AI systems
    header("2. AI System Registration")
    gemini_system_id = ensure_ai_system(platform, MODEL_GEMINI, "google")
    claude_system_id = ensure_ai_system(platform, MODEL_CLAUDE, "anthropic")

    # 3. Managed PII config
    await demo_managed_pii_config(arelis)

    # 4. PII scanning
    demo_pii_scanning()

    # 5. Standalone governance gate
    await demo_standalone_gate(arelis)

    # 6. governed_invoke
    invoke_results = await demo_governed_invoke(arelis)

    # 7. agents.run
    agent_result = await demo_agents_run(arelis)

    # 8. Policy CRUD
    content_policy_id = demo_policy_crud(platform)

    # 9. Manual pre-invocation gate
    await demo_manual_gate(arelis)

    # 10. BeforeToolCall / AfterToolResult
    demo_tool_governance()

    # 11. Platform events
    events_run_id = f"run-events-demo-{uuid.uuid4()}"
    events_log = demo_platform_events(platform, gemini_system_id)

    # 11b. Platform policy evaluation
    demo_policy_evaluation(platform)

    # 12. Risk evaluation
    risk_results = demo_risk_evaluation(platform, gemini_system_id)

    # 13. Causal graph
    graph_result = demo_causal_graph(
        platform,
        events_run_id,
        events_log,
    )

    # 14. Compliance proofs
    proof_result = demo_compliance_proofs(platform, events_run_id, gemini_system_id)

    # 15. Post-stream pipeline
    demo_post_stream_pipeline(platform, gemini_system_id)

    # 16. MCP server
    demo_mcp_server(platform)

    # 17. Quota & usage
    demo_quota_and_usage(platform)

    # 18. Error handling
    await demo_error_handling(arelis)

    # 19. Approval workflow
    demo_approval_workflow(platform, gemini_system_id)

    # 20. Export & replay
    demo_export_and_replay(platform)

    # =====================================================================
    # Final Summary
    # =====================================================================
    header("FINAL SUMMARY")

    print("governed_invoke results:")
    for label, res in invoke_results.items():
        status = "INVOKED" if res.invoked else "BLOCKED"
        print(f"  {label:<20} {status:<10} run_id={res.run_id}")

    if agent_result:
        print(f"\nagents.run:")
        print(f"  Status: {agent_result.status}")
        print(f"  Steps: {len(agent_result.steps)}")
        print(f"  Events: {len(agent_result.events)}")

    print(f"\nRisk evaluation:")
    for r in risk_results:
        print(f"  action={r.get('action', 'N/A')}, score={r.get('score', 'N/A')}")

    if graph_result:
        print(f"\nCausal graph:")
        print(f"  Nodes: {graph_result['nodeCount']}, Edges: {graph_result['edgeCount']}")
        print(f"  Root hash: {graph_result['rootHash'][:24]}...")

    if proof_result:
        print(f"\nCompliance proof:")
        print(f"  Proof ID: {proof_result['proofId']}")
        print(f"  Verified: {proof_result['verified']}")

    print(f"\nDemo complete -- 21 sections exercised.")
    print()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nInterrupted by user")
    except Exception as err:
        print(f"\nScript failed: {err}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        sys.exit(1)
