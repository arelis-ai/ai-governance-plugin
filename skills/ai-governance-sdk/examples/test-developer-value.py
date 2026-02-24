"""
Arelis Governance Platform -- End-to-End Developer Demo (Python)

Demonstrates the full governance lifecycle:
  1. PII scanning + policy gate (block / allow) before model invocation
  2. Real LLM calls through Gemini and Claude, gated by the SDK
  3. Governed agent with Gemini 2.5 Flash function calling (tool use)
  4. Audit event recording for every action (blocked, allowed, tool calls, agent steps)
  5. Runtime risk scoring with escalating signal severity
  6. Causal graph construction, commit, and lineage traversal
  7. Compliance proof generation and cryptographic verification

Usage:
  python scripts/test-developer-value.py

Required env vars (from .env):
  ARELIS_API_KEY      -- Arelis sandbox API key (ak_sandbox_...)
  ARELIS_API_URL      -- API base URL (defaults to http://localhost:3000)
  GEMINI_API_KEY      -- Google AI Studio key
  ANTHROPIC_API_KEY   -- Anthropic API key
"""

import os
import sys
import uuid
from datetime import datetime, timezone
from typing import Any

from dotenv import load_dotenv

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
# Client initialization
# ---------------------------------------------------------------------------

from arelis import create_arelis_platform
from google import genai
from google.genai import types as genai_types
import anthropic

arelis = create_arelis_platform({
    "baseUrl": os.environ.get("ARELIS_API_URL", "http://localhost:3000"),
    "apiKey": os.environ["ARELIS_API_KEY"],
})

gemini_client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
anthropic_client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])

# ---------------------------------------------------------------------------
# Types
# ---------------------------------------------------------------------------

PlatformDecision = dict[str, Any]
EventRef = dict[str, str]
ScenarioResult = dict[str, Any]
RiskResult = dict[str, Any]
ProofResult = dict[str, Any]
GraphResult = dict[str, Any]
AgentResult = dict[str, Any]

# ---------------------------------------------------------------------------
# PII scanning (local regex-based, mirrors the TS SDK's scanPromptForPii)
# ---------------------------------------------------------------------------

import re

PII_PATTERNS: list[dict[str, Any]] = [
    {
        "name": "email",
        "pattern": re.compile(r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}"),
    },
    {
        "name": "ssn",
        "pattern": re.compile(r"\b\d{3}[-.\s]?\d{2}[-.\s]?\d{4}\b"),
    },
    {
        "name": "credit_card",
        "pattern": re.compile(r"\b(?:\d{4}[-.\s]?){3}\d{4}\b"),
    },
    {
        "name": "phone",
        "pattern": re.compile(
            r"(?<!\d)(?:\+1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}(?!\d)"
        ),
    },
    {
        "name": "api_key",
        "pattern": re.compile(r"\b(?:sk|ak|pk)[-_][a-zA-Z0-9]{20,}\b"),
    },
]


def scan_prompt_for_pii(prompt: str) -> dict[str, Any]:
    """Scan a prompt for PII using regex patterns."""
    findings: list[dict[str, str]] = []
    for pii in PII_PATTERNS:
        for match in pii["pattern"].finditer(prompt):
            findings.append({"type": pii["name"], "original": match.group()})
    return {"hasPii": len(findings) > 0, "findings": findings}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def header(title: str) -> None:
    print(f"\n{'=' * 70}")
    print(f"  {title}")
    print(f"{'=' * 70}\n")


def section(title: str) -> None:
    print(f"--- {title} ---\n")


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---------------------------------------------------------------------------
# 1. Policy setup
# ---------------------------------------------------------------------------


def ensure_pii_policy() -> str:
    PII_POLICY_KEY = "pii-deny-before-invocation"
    existing = arelis.governance.policies.list({"search": PII_POLICY_KEY})
    match = next((p for p in existing["data"] if p["key"] == PII_POLICY_KEY), None)

    if match:
        print(f"PII deny policy exists (id: {match['id']})")
        return match["id"]

    policy = arelis.governance.policies.create({
        "key": PII_POLICY_KEY,
        "name": "PII Deny Before Model Invocation",
        "description": (
            "Denies model invocation when PII (SSN, email, phone, credit card) "
            "is detected in the prompt."
        ),
        "condition": {"field": "content.pii_detected", "operator": "eq", "value": True},
        "action": "deny",
        "severity": "critical",
        "priority": 1,
    })

    print(f"PII deny policy created (id: {policy['id']})")
    return policy["id"]


# ---------------------------------------------------------------------------
# 2. Governance gate evaluation (local)
# ---------------------------------------------------------------------------


def evaluate_gate(
    run_id: str, prompt: str, policy_id: str
) -> dict[str, Any]:
    """Scan for PII and evaluate the policy via the platform API."""
    pii = scan_prompt_for_pii(prompt)
    pii_types = list({f["type"] for f in pii["findings"]})

    eval_result = arelis.governance.evaluatePolicy({
        "runId": run_id,
        "checkpoint": {
            "content": {
                "pii_detected": pii["hasPii"],
                "pii_types": pii_types,
                "pii_count": len(pii["findings"]),
            },
        },
        "policyIds": [policy_id],
    })

    decisions = eval_result["decisions"]
    denied = any(d["decision"] == "deny" for d in decisions)

    return {
        "pii": pii,
        "pii_types": pii_types,
        "decision": "block" if denied else "allow",
        "raw_decisions": decisions,
    }


# ---------------------------------------------------------------------------
# 3. Governance gate scenarios
# ---------------------------------------------------------------------------


def run_governance_scenarios(policy_id: str) -> list[ScenarioResult]:
    results: list[ScenarioResult] = []

    # Scenario A: PII prompt -> should be BLOCKED before reaching Gemini
    section("Scenario A: Prompt with PII -> Gemini")

    pii_prompt = (
        "My name is John Smith, SSN 423-91-0482, email john.smith@acmecorp.com. "
        "Help me file taxes."
    )
    run_id_a = f"run-pii-{uuid.uuid4()}"
    gate_a = evaluate_gate(run_id_a, pii_prompt, policy_id)

    print(f"PII detected: {gate_a['pii']['hasPii']}")
    for f in gate_a["pii"]["findings"]:
        print(f"  {f['type']}: \"{f['original']}\"")
    print(f"Decision: {gate_a['decision']} | Model invoked: {gate_a['decision'] == 'allow'}")

    events_a: list[EventRef] = []
    invoked_a = gate_a["decision"] == "allow"

    if not invoked_a:
        ts = now_iso()
        ev = arelis.events.create({
            "runId": run_id_a,
            "eventType": "model_invocation_blocked",
            "actor": {"type": "human", "id": "demo-user"},
            "resource": {"type": "model", "id": "gemini-2.0-flash"},
            "action": "blocked_by_policy",
            "timestamp": ts,
            "metadata": {
                "pii_types": gate_a["pii_types"],
                "pii_count": len(gate_a["pii"]["findings"]),
                "policy_decision": gate_a["decision"],
                "blocking_policy": policy_id,
            },
        })
        events_a.append({
            "eventId": ev["eventId"],
            "eventType": "model_invocation_blocked",
            "action": "blocked_by_policy",
            "timestamp": ts,
        })
        print("Audit event recorded: model_invocation_blocked\n")

    results.append({
        "label": "A (PII -> Gemini)",
        "runId": run_id_a,
        "invoked": invoked_a,
        "decision": gate_a["decision"],
        "events": events_a,
    })

    # Scenario B: Clean prompt -> should PASS and call Gemini
    section("Scenario B: Clean prompt -> Gemini")

    clean_prompt = (
        "Explain the key principles of AI governance for enterprise compliance "
        "in three sentences."
    )
    run_id_b = f"run-clean-{uuid.uuid4()}"
    gate_b = evaluate_gate(run_id_b, clean_prompt, policy_id)

    print(f"PII detected: {gate_b['pii']['hasPii']}")
    print(f"Decision: {gate_b['decision']} | Model invoked: {gate_b['decision'] == 'allow'}")

    events_b: list[EventRef] = []
    invoked_b = gate_b["decision"] == "allow"
    gemini_result_b = ""

    if invoked_b:
        response = gemini_client.models.generate_content(
            model="gemini-2.0-flash",
            contents=clean_prompt,
        )
        gemini_result_b = response.text or ""

        ts1 = now_iso()
        ev1 = arelis.events.create({
            "runId": run_id_b,
            "eventType": "model.invoked",
            "actor": {"type": "human", "id": "demo-user"},
            "resource": {"type": "model", "id": "gemini-2.0-flash"},
            "action": "inference",
            "timestamp": ts1,
            "metadata": {
                "responseLength": len(gemini_result_b),
                "policy_decision": gate_b["decision"],
            },
        })
        events_b.append({
            "eventId": ev1["eventId"],
            "eventType": "model.invoked",
            "action": "inference",
            "timestamp": ts1,
        })

        ts2 = now_iso()
        ev2 = arelis.events.create({
            "runId": run_id_b,
            "eventType": "output.delivered",
            "actor": {"type": "human", "id": "demo-user"},
            "resource": {"type": "model", "id": "gemini-2.0-flash"},
            "action": "deliver",
            "timestamp": ts2,
            "metadata": {"outputLength": len(gemini_result_b), "containsPII": False},
        })
        events_b.append({
            "eventId": ev2["eventId"],
            "eventType": "output.delivered",
            "action": "deliver",
            "timestamp": ts2,
        })

        print(f"Response: \"{gemini_result_b[:150]}...\"")
        print("Audit events recorded: model.invoked, output.delivered\n")

    results.append({
        "label": "B (Clean -> Gemini)",
        "runId": run_id_b,
        "invoked": invoked_b,
        "decision": gate_b["decision"],
        "events": events_b,
    })

    # Scenario C: Clean prompt -> should PASS and call Claude
    section("Scenario C: Clean prompt -> Claude")

    claude_prompt = (
        "What are the three most important considerations when building compliant "
        "AI systems for regulated industries?"
    )
    run_id_c = f"run-claude-{uuid.uuid4()}"
    gate_c = evaluate_gate(run_id_c, claude_prompt, policy_id)

    print(f"PII detected: {gate_c['pii']['hasPii']}")
    print(f"Decision: {gate_c['decision']} | Model invoked: {gate_c['decision'] == 'allow'}")

    events_c: list[EventRef] = []
    invoked_c = gate_c["decision"] == "allow"
    claude_result_c = ""

    if invoked_c:
        message = anthropic_client.messages.create(
            model="claude-sonnet-4-5-20250929",
            max_tokens=300,
            messages=[{"role": "user", "content": claude_prompt}],
        )
        text_block = next((b for b in message.content if b.type == "text"), None)
        claude_result_c = text_block.text if text_block else ""

        ts1 = now_iso()
        ev1 = arelis.events.create({
            "runId": run_id_c,
            "eventType": "model.invoked",
            "actor": {"type": "human", "id": "demo-user"},
            "resource": {"type": "model", "id": "claude-sonnet-4-5-20250929"},
            "action": "inference",
            "timestamp": ts1,
            "metadata": {
                "responseLength": len(claude_result_c),
                "policy_decision": gate_c["decision"],
            },
        })
        events_c.append({
            "eventId": ev1["eventId"],
            "eventType": "model.invoked",
            "action": "inference",
            "timestamp": ts1,
        })

        ts2 = now_iso()
        ev2 = arelis.events.create({
            "runId": run_id_c,
            "eventType": "output.delivered",
            "actor": {"type": "human", "id": "demo-user"},
            "resource": {"type": "model", "id": "claude-sonnet-4-5-20250929"},
            "action": "deliver",
            "timestamp": ts2,
            "metadata": {"outputLength": len(claude_result_c), "containsPII": False},
        })
        events_c.append({
            "eventId": ev2["eventId"],
            "eventType": "output.delivered",
            "action": "deliver",
            "timestamp": ts2,
        })

        print(f"Response: \"{claude_result_c[:150]}...\"")
        print("Audit events recorded: model.invoked, output.delivered\n")

    results.append({
        "label": "C (Clean -> Claude)",
        "runId": run_id_c,
        "invoked": invoked_c,
        "decision": gate_c["decision"],
        "events": events_c,
    })

    return results


# ---------------------------------------------------------------------------
# 4. Risk scoring scenarios
# ---------------------------------------------------------------------------


def run_risk_scenarios(
    pii_run_id: str, clean_run_id: str, policy_id: str
) -> list[RiskResult]:
    results: list[RiskResult] = []

    # D: Low risk
    section("Risk D: Low risk -- clean invocation")

    risk_d = arelis.risk.evaluate({
        "runId": clean_run_id,
        "policyDecisions": [{"policyId": policy_id, "decision": "allow", "severity": "low"}],
        "quotaState": {
            "audit_event": {"used": 4500, "limit": 100_000},
            "compliance_proof": {"used": 23, "limit": 500},
        },
        "evaluationSignals": [
            {"name": "model_latency_ms", "value": 340, "severity": "low"},
            {"name": "output_toxicity_score", "value": 0.02, "severity": "low"},
            {"name": "hallucination_confidence", "value": 0.12, "severity": "medium"},
        ],
    })

    print(f"Action: {risk_d['action']} | Score: {risk_d['score']}")
    print(f"Hash:   {risk_d['deterministicInputsHash']}\n")
    results.append({"label": "D (Low risk)", "action": risk_d["action"], "score": risk_d["score"]})

    # E: Medium risk
    section("Risk E: Medium risk -- PII blocked + elevated signals")

    risk_e = arelis.risk.evaluate({
        "runId": pii_run_id,
        "policyDecisions": [{"policyId": policy_id, "decision": "deny", "severity": "critical"}],
        "quotaState": {
            "audit_event": {"used": 72_000, "limit": 100_000},
            "compliance_proof": {"used": 410, "limit": 500},
        },
        "evaluationSignals": [
            {"name": "pii_detected", "value": 1, "severity": "high"},
            {"name": "output_toxicity_score", "value": 0.35, "severity": "medium"},
            {"name": "hallucination_confidence", "value": 0.45, "severity": "medium"},
        ],
    })

    print(f"Action: {risk_e['action']} | Score: {risk_e['score']}")
    print(f"Hash:   {risk_e['deterministicInputsHash']}\n")
    results.append({"label": "E (Medium risk)", "action": risk_e["action"], "score": risk_e["score"]})

    # F: High risk
    section("Risk F: High risk -- multiple denials + quota exhausted")

    risk_f = arelis.risk.evaluate({
        "runId": f"run-risk-high-{uuid.uuid4()}",
        "policyDecisions": [
            {"policyId": policy_id, "decision": "deny", "severity": "critical"},
            {"policyId": "policy-content-safety", "decision": "deny", "severity": "critical"},
        ],
        "quotaState": {
            "audit_event": {"used": 99_800, "limit": 100_000},
            "compliance_proof": {"used": 498, "limit": 500},
        },
        "evaluationSignals": [
            {"name": "pii_detected", "value": 1, "severity": "high"},
            {"name": "output_toxicity_score", "value": 0.92, "severity": "high"},
            {"name": "hallucination_confidence", "value": 0.87, "severity": "high"},
            {"name": "prompt_injection_score", "value": 0.95, "severity": "high"},
        ],
    })

    print(f"Action: {risk_f['action']} | Score: {risk_f['score']}")
    print(f"Hash:   {risk_f['deterministicInputsHash']}\n")
    results.append({"label": "F (High risk)", "action": risk_f["action"], "score": risk_f["score"]})

    return results


# ---------------------------------------------------------------------------
# 5. Causal graph construction, commit, and lineage
# ---------------------------------------------------------------------------


def build_and_commit_graph(scenario: ScenarioResult) -> GraphResult | None:
    section(f"Graph: {scenario['label']}")

    events = scenario["events"]
    if len(events) == 0:
        print("No events recorded -- skipping graph\n")
        return None

    nodes = [
        {
            "id": ev["eventId"],
            "type": ev["eventType"],
            "data": {"action": ev["action"], "timestamp": ev["timestamp"]},
        }
        for ev in events
    ]

    edges: list[dict[str, str]] = []
    for i in range(1, len(events)):
        edges.append({
            "source": events[i - 1]["eventId"],
            "target": events[i]["eventId"],
            "type": "sequence",
        })

    print(f"Nodes: {len(nodes)} | Edges: {len(edges)}")
    for n in nodes:
        print(f"  [{n['type']}] {n['id']}")
    for e in edges:
        print(f"  {e['source'][:12]}... -> {e['target'][:12]}... ({e['type']})")

    # Submit the causal graph
    arelis.replay.startCausalGraph({
        "runId": scenario["runId"],
        "nodes": nodes,
        "edges": edges,
    })
    print("Graph submitted")

    # Commit the graph
    commit = arelis.graphs.commit(scenario["runId"])
    print(f"Committed:  rootHash={commit['rootHash'][:16]}...")

    # Query full lineage from the first node
    lineage = arelis.graphs.lineage(scenario["runId"], nodes[0]["id"])
    print(f"Lineage:    {len(lineage['nodes'])} node(s), {len(lineage['edges'])} edge(s)\n")

    return {
        "label": scenario["label"],
        "runId": scenario["runId"],
        "rootHash": commit["rootHash"],
        "nodeCount": len(lineage["nodes"]),
        "edgeCount": len(lineage["edges"]),
    }


# ---------------------------------------------------------------------------
# 6. Compliance proof generation + verification
# ---------------------------------------------------------------------------

PROOF_LAYERS = ["event_integrity", "causal_consistency", "policy_compliance"]


def generate_and_verify_proof(run_id: str, label: str) -> ProofResult | None:
    section(f"Proof: {label}")

    proof = arelis.proofs.create({
        "runId": run_id,
        "schemaVersion": "v2",
        "composed": {"layers": PROOF_LAYERS},
    })

    if "jobId" in proof:
        print("Unexpected async response -- proof worker may not be running", file=sys.stderr)
        return None

    print(f"Proof ID:   {proof['proofId']}")
    print(f"Proof hash: {proof['proofHash']}")
    print(f"Layers:     {', '.join(l['name'] for l in proof['layers'])}")

    verification = arelis.proofs.verify({"proofId": proof["proofId"]})

    print(f"Verified:   {verification['verified']}")
    for layer in verification["layers"]:
        status = "PASS" if layer["passed"] else "FAIL"
        print(f"  {layer['name']}: {status}")
    print()

    return {
        "label": label,
        "proofId": proof["proofId"],
        "proofHash": proof["proofHash"],
        "verified": verification["verified"],
    }


# ---------------------------------------------------------------------------
# 7. Agent scenario -- Gemini 2.5 Flash with function calling
# ---------------------------------------------------------------------------

lookup_regulation_decl = genai_types.FunctionDeclaration(
    name="lookupRegulation",
    description=(
        "Look up details about a specific compliance regulation or framework "
        "(e.g. EU AI Act, GDPR, SOC2)."
    ),
    parameters_json_schema={
        "type": "object",
        "properties": {
            "regulationName": {
                "type": "string",
                "description": "Name of the regulation or framework to look up",
            },
        },
        "required": ["regulationName"],
    },
)

check_compliance_status_decl = genai_types.FunctionDeclaration(
    name="checkComplianceStatus",
    description="Check the organization's current compliance status for a specific regulation.",
    parameters_json_schema={
        "type": "object",
        "properties": {
            "regulationId": {
                "type": "string",
                "description": "The regulation identifier (e.g. eu-ai-act, gdpr, soc2)",
            },
        },
        "required": ["regulationId"],
    },
)

AGENT_TOOLS = [genai_types.Tool(function_declarations=[lookup_regulation_decl, check_compliance_status_decl])]


def execute_tool_call(name: str, args: dict[str, Any]) -> dict[str, Any]:
    """Simulated tool execution -- returns realistic compliance data."""
    if name == "lookupRegulation":
        reg = str(args.get("regulationName", "")).lower()
        if "eu ai act" in reg or "ai act" in reg:
            return {
                "id": "eu-ai-act",
                "name": "EU Artificial Intelligence Act",
                "jurisdiction": "European Union",
                "effectiveDate": "2025-08-01",
                "riskCategories": ["unacceptable", "high", "limited", "minimal"],
                "keyRequirements": [
                    "Risk classification for all AI systems",
                    "Conformity assessment for high-risk systems",
                    "Transparency obligations for limited-risk systems",
                    "Human oversight mechanisms",
                    "Technical documentation and logging",
                ],
                "penaltyRange": "Up to 35M EUR or 7% of global annual turnover",
            }
        return {
            "id": "unknown",
            "name": str(args.get("regulationName")),
            "error": "Regulation not found in database",
        }

    if name == "checkComplianceStatus":
        reg_id = str(args.get("regulationId", ""))
        if reg_id == "eu-ai-act":
            return {
                "regulationId": "eu-ai-act",
                "organizationId": "org_arelis",
                "overallStatus": "partially_compliant",
                "lastAssessmentDate": "2025-12-15",
                "controls": [
                    {"name": "Risk Classification", "status": "compliant", "score": 0.95},
                    {"name": "Transparency Obligations", "status": "compliant", "score": 0.88},
                    {"name": "Human Oversight", "status": "in_progress", "score": 0.65},
                    {"name": "Technical Documentation", "status": "in_progress", "score": 0.72},
                    {"name": "Conformity Assessment", "status": "not_started", "score": 0.0},
                ],
                "nextReviewDate": "2026-03-01",
            }
        return {"regulationId": reg_id, "error": "No compliance data found"}

    return {"error": f"Unknown tool: {name}"}


def run_agent_scenario(policy_id: str) -> AgentResult:
    run_id = f"run-agent-{uuid.uuid4()}"
    events: list[EventRef] = []
    step_count = 0
    tool_call_count = 0

    agent_prompt = (
        "What EU AI Act compliance requirements apply to our high-risk AI classification system, "
        "and what is our current compliance status? Provide a brief summary."
    )

    section("Scenario G: Governed Agent with Tool Use (Gemini 2.5 Flash)")
    print(f"Run ID: {run_id}")
    print(f"Prompt: \"{agent_prompt}\"\n")

    # Step 1: PII scan + policy gate before agent execution
    pii = scan_prompt_for_pii(agent_prompt)
    print(f"PII scan: hasPii={pii['hasPii']}")

    eval_result = arelis.governance.evaluatePolicy({
        "runId": run_id,
        "checkpoint": {"content": {"pii_detected": pii["hasPii"], "pii_types": [], "pii_count": 0}},
        "policyIds": [policy_id],
    })
    decisions = eval_result["decisions"]
    denied = any(d["decision"] == "deny" for d in decisions)
    print(f"Policy gate: {'DENIED' if denied else 'ALLOWED'}\n")

    if denied:
        ts = now_iso()
        ev = arelis.events.create({
            "runId": run_id,
            "eventType": "model_invocation_blocked",
            "actor": {"type": "agent", "id": "compliance-agent"},
            "resource": {"type": "model", "id": "gemini-2.5-flash"},
            "action": "blocked_by_policy",
            "timestamp": ts,
            "metadata": {"policy_decision": "deny", "blocking_policy": policy_id},
        })
        events.append({
            "eventId": ev["eventId"],
            "eventType": "model_invocation_blocked",
            "action": "blocked_by_policy",
            "timestamp": ts,
        })
        return {
            "label": "G (Agent -> Gemini)",
            "runId": run_id,
            "steps": 0,
            "toolCalls": 0,
            "finalAnswer": "",
            "events": events,
        }

    # Step 2: Agent step 1 -- initial reasoning + model call with tools
    step_count += 1
    ts1 = now_iso()
    ev_step1 = arelis.events.create({
        "runId": run_id,
        "eventType": "agent.step",
        "actor": {"type": "agent", "id": "compliance-agent"},
        "resource": {"type": "model", "id": "gemini-2.5-flash"},
        "action": "reason",
        "timestamp": ts1,
        "metadata": {"step": step_count, "phase": "initial_reasoning", "prompt": agent_prompt},
    })
    events.append({
        "eventId": ev_step1["eventId"],
        "eventType": "agent.step",
        "action": "reason",
        "timestamp": ts1,
    })
    print(f"Agent step {step_count}: Initial reasoning -- calling Gemini with tools")

    # Build conversation history for multi-turn function calling
    contents: list[genai_types.Content] = [
        genai_types.Content(role="user", parts=[genai_types.Part.from_text(text=agent_prompt)]),
    ]

    # Agentic loop: keep calling Gemini until it returns text (no more function calls)
    MAX_TURNS = 5
    final_answer = ""

    for turn in range(MAX_TURNS):
        response = gemini_client.models.generate_content(
            model="gemini-2.5-flash",
            contents=contents,
            config=genai_types.GenerateContentConfig(tools=AGENT_TOOLS),
        )

        # Check for function calls in the response
        function_calls = response.function_calls or []

        # If no function calls, Gemini returned a final text answer
        if len(function_calls) == 0:
            final_answer = response.text or ""
            break

        print(f"Gemini returned {len(function_calls)} function call(s) (turn {turn + 1})")

        # Add model's function call response to conversation
        contents.append(response.candidates[0].content)

        # Execute each tool and log events
        function_response_parts: list[genai_types.Part] = []

        for fc in function_calls:
            tool_call_count += 1
            tool_name = fc.name if fc.name else "unknown"
            tool_args = dict(fc.args) if fc.args else {}

            # Log tool.call event
            ts_call = now_iso()
            ev_call = arelis.events.create({
                "runId": run_id,
                "eventType": "tool.call",
                "actor": {"type": "agent", "id": "compliance-agent"},
                "resource": {"type": "tool", "id": tool_name},
                "action": "invoke",
                "timestamp": ts_call,
                "metadata": {"toolName": tool_name, "args": tool_args, "step": step_count},
            })
            events.append({
                "eventId": ev_call["eventId"],
                "eventType": "tool.call",
                "action": "invoke",
                "timestamp": ts_call,
            })
            print(f"  tool.call: {tool_name}({tool_args})")

            # Execute tool
            tool_result = execute_tool_call(tool_name, tool_args)

            # Log tool.result event
            ts_result = now_iso()
            ev_result = arelis.events.create({
                "runId": run_id,
                "eventType": "tool.result",
                "actor": {"type": "agent", "id": "compliance-agent"},
                "resource": {"type": "tool", "id": tool_name},
                "action": "complete",
                "timestamp": ts_result,
                "metadata": {
                    "toolName": tool_name,
                    "success": "error" not in tool_result,
                    "resultKeys": list(tool_result.keys()),
                },
            })
            events.append({
                "eventId": ev_result["eventId"],
                "eventType": "tool.result",
                "action": "complete",
                "timestamp": ts_result,
            })
            print(f"  tool.result: {tool_name} -> {len(tool_result)} fields")

            function_response_parts.append(
                genai_types.Part.from_function_response(
                    name=tool_name,
                    response=tool_result,
                )
            )

        # Send tool results back to Gemini for next turn
        contents.append(genai_types.Content(role="tool", parts=function_response_parts))

    # Final agent step -- synthesis
    step_count += 1
    print(f"\nAgent step {step_count}: Synthesized final answer")

    ts2 = now_iso()
    ev_step2 = arelis.events.create({
        "runId": run_id,
        "eventType": "agent.step",
        "actor": {"type": "agent", "id": "compliance-agent"},
        "resource": {"type": "model", "id": "gemini-2.5-flash"},
        "action": "synthesize",
        "timestamp": ts2,
        "metadata": {"step": step_count, "phase": "synthesis", "responseLength": len(final_answer)},
    })
    events.append({
        "eventId": ev_step2["eventId"],
        "eventType": "agent.step",
        "action": "synthesize",
        "timestamp": ts2,
    })

    # Log output delivery
    ts3 = now_iso()
    ev_output = arelis.events.create({
        "runId": run_id,
        "eventType": "output.delivered",
        "actor": {"type": "agent", "id": "compliance-agent"},
        "resource": {"type": "model", "id": "gemini-2.5-flash"},
        "action": "deliver",
        "timestamp": ts3,
        "metadata": {
            "outputLength": len(final_answer),
            "containsPII": False,
            "totalSteps": step_count,
            "totalToolCalls": tool_call_count,
        },
    })
    events.append({
        "eventId": ev_output["eventId"],
        "eventType": "output.delivered",
        "action": "deliver",
        "timestamp": ts3,
    })

    truncated = final_answer[:200] + ("..." if len(final_answer) > 200 else "")
    print(f"\nFinal answer ({len(final_answer)} chars):")
    print(f"\"{truncated}\"")
    print(f"\nEvents: {len(events)} total ({step_count} steps, {tool_call_count} tool calls)\n")

    return {
        "label": "G (Agent -> Gemini)",
        "runId": run_id,
        "steps": step_count,
        "toolCalls": tool_call_count,
        "finalAnswer": final_answer,
        "events": events,
    }


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main() -> None:
    header("Arelis Governance Platform -- End-to-End Demo (Python)")

    # 1. Policy setup
    header("1. Policy Setup")
    policy_id = ensure_pii_policy()

    # 2. Governance gate scenarios (real LLM calls)
    header("2. Governance Gate -- PII Scanning + Policy Enforcement")
    scenarios = run_governance_scenarios(policy_id)

    # 3. Agent scenario (Gemini 2.5 Flash with function calling)
    header("3. Governed Agent -- Tool Use + Step Tracking")
    agent_result = run_agent_scenario(policy_id)

    # 4. Risk scoring
    header("4. Runtime Risk Scoring")
    risks = run_risk_scenarios(scenarios[0]["runId"], scenarios[1]["runId"], policy_id)

    # 5. Causal graphs (governance scenarios + agent)
    header("5. Causal Graphs -- Build, Commit + Lineage")
    all_graph_scenarios: list[ScenarioResult] = [
        *scenarios,
        {
            "label": agent_result["label"],
            "runId": agent_result["runId"],
            "invoked": True,
            "decision": "allow",
            "events": agent_result["events"],
        },
    ]
    graphs: list[GraphResult | None] = []
    for s in all_graph_scenarios:
        graphs.append(build_and_commit_graph(s))

    # 6. Compliance proofs (governance scenarios + agent)
    header("6. Compliance Proofs -- Generate + Verify")
    proofs: list[ProofResult | None] = []
    for s in all_graph_scenarios:
        proofs.append(generate_and_verify_proof(s["runId"], s["label"]))

    # 7. Summary
    header("Summary")

    print("Governance Gate:")
    for s in scenarios:
        status = "ALLOWED" if s["invoked"] else "BLOCKED"
        print(f"  {s['label']:<22} {status:<10} ({s['decision']})")

    print("\nAgent (Tool Use):")
    print(
        f"  {agent_result['label']:<22} {agent_result['steps']} steps, "
        f"{agent_result['toolCalls']} tool calls, {len(agent_result['events'])} events"
    )

    print("\nRisk Scoring:")
    for r in risks:
        print(f"  {r['label']:<22} {r['action']:<10} (score: {r['score']})")

    print("\nCausal Graphs:")
    for g in graphs:
        if g:
            print(
                f"  {g['label']:<22} {g['nodeCount']} nodes, {g['edgeCount']} edges "
                f"(hash: {g['rootHash'][:16]}...)"
            )
        else:
            print(f"  {'(skipped)':<22} no events")

    print("\nCompliance Proofs:")
    for p in proofs:
        status = "VERIFIED" if p and p["verified"] else ("FAILED" if p else "ERROR")
        label = p["label"] if p else "unknown"
        print(f"  {label:<22} {status}")

    print()


if __name__ == "__main__":
    try:
        main()
    except Exception as err:
        print(f"Script failed: {err}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        sys.exit(1)