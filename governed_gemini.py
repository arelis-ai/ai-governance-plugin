"""
Governed Gemini model invocation using the Arelis AI Governance SDK (Python).

Uses create_arelis + governed_invoke for automatic PII redaction,
policy gate, event reporting, and risk evaluation.
"""

import asyncio
import os

from dotenv import load_dotenv

# ---------------------------------------------------------------------------
# 1. Environment
# ---------------------------------------------------------------------------
load_dotenv(".env.local")

# ---------------------------------------------------------------------------
# 2. Arelis Unified Client
# ---------------------------------------------------------------------------
from arelis import create_arelis, GovernedInvokeInput, GovernanceContext, ActorRef, OrgRef

arelis = create_arelis({
    "platform": {
        "apiKey": os.environ["ARELIS_API_KEY"],
        **({"baseUrl": os.environ["ARELIS_API_URL"]} if os.environ.get("ARELIS_API_URL") else {}),
    }
})

# ---------------------------------------------------------------------------
# 3. Constants
# ---------------------------------------------------------------------------
MODEL_ID = "gemini-2.5-flash"


# ---------------------------------------------------------------------------
# 4. Main — Governed Gemini Call
# ---------------------------------------------------------------------------
async def main():
    from google import genai

    gemini = genai.Client(api_key=os.environ["GEMINI_API_KEY"])

    prompt = "Explain the key principles of the EU AI Act in three bullet points."

    result = await arelis.governed_invoke(GovernedInvokeInput(
        model=MODEL_ID,
        prompt=prompt,
        invoke=lambda sanitized: gemini.models.generate_content(
            model=MODEL_ID, contents=sanitized
        ).text,
        actor=ActorRef(type="human", id="user_1"),
        context=GovernanceContext(
            org=OrgRef(id="org_123", name="Acme"),
            actor=ActorRef(type="human", id="user_1"),
            purpose="demo",
            environment="dev",
        ),
        deny_mode="return",
    ))

    if not result.invoked:
        print(f"BLOCKED: {result.decision}")
        return

    print(f"Sanitized prompt: {result.sanitized_prompt}")
    print(f"\n--- Gemini Response ---\n{result.result}\n")

    if result.risk:
        print(f"Risk score: {result.risk}")

    for warning in result.warnings or []:
        print(f"Warning: {warning}")

    print("Governance pipeline completed.")


if __name__ == "__main__":
    asyncio.run(main())
