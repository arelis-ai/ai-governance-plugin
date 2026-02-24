# Python SDK — Setup Patterns

Installation, client initialization, AI system registration, and web framework integration.

---

## Installation

```bash
pip install ai-governance-sdk    # PyPI package name (imports as `from arelis import ...`)
# Model provider SDKs (install as needed)
pip install google-genai         # Google Gemini
pip install anthropic            # Anthropic Claude
pip install openai               # OpenAI
```

> **Important:** The PyPI package name is `ai-governance-sdk`, NOT `arelis`. The import name remains `arelis`.

---

## Unified Client Initialization (Recommended)

```python
import os
from arelis import create_arelis

# Module-level singleton
_arelis = None

def get_arelis():
    global _arelis
    if _arelis is not None:
        return _arelis

    api_key = os.environ.get("ARELIS_API_KEY")
    if not api_key:
        raise RuntimeError("ARELIS_API_KEY is not set")

    _arelis = create_arelis({
        "platform": {
            "apiKey": api_key,
            **({"baseUrl": os.environ["ARELIS_API_URL"]} if os.environ.get("ARELIS_API_URL") else {}),
        }
    })
    return _arelis
```

The unified client exposes:
- `arelis.governed_invoke(...)` — high-level orchestrated model invocation
- `arelis.agents.run(...)` — multi-step governed agent loop
- `arelis.governance.get_pii_config(...)` — managed PII configuration from platform
- `arelis.platform` — low-level platform namespaces (events, governance, risk, graphs, etc.)
- `arelis.runtime` — local runtime client (if configured with `"runtime"` key)

---

## Platform Client Initialization (Low-Level)

For manual governance orchestration without `governed_invoke`:

```python
import os
from arelis import create_arelis_platform

# Module-level singleton
_platform = None

def get_arelis_platform():
    global _platform
    if _platform is not None:
        return _platform

    api_key = os.environ.get("ARELIS_API_KEY")
    base_url = os.environ.get("ARELIS_API_URL")
    if not api_key:
        raise RuntimeError("ARELIS_API_KEY is not set")
    if not base_url:
        raise RuntimeError("ARELIS_API_URL is not set")

    _platform = create_arelis_platform({
        "baseUrl": base_url,
        "apiKey": api_key,
        "maxRetries": 2,
        "timeout": 15_000,
    })
    return _platform
```

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ARELIS_API_KEY` | yes | Platform API key (`ak_sandbox_...` or `ak_prod_...`) |
| `ARELIS_API_URL` | no | Platform URL (defaults to `https://api.arelis.digital`) |
| `GEMINI_API_KEY` | if using Gemini | Google Gemini API key |
| `ANTHROPIC_API_KEY` | if using Anthropic | Anthropic API key |
| `OPENAI_API_KEY` | if using OpenAI | OpenAI API key |

---

## AI System Registration

```python
import os

_ai_system_id = None

async def ensure_ai_system_registered(platform, model_id: str) -> str:
    global _ai_system_id
    if _ai_system_id is not None:
        return _ai_system_id

    result = await platform.ai_systems.list({"type": "model"})
    existing = result.get("data", [])
    match = next(
        (s for s in existing if s.get("modelRef") == model_id and s.get("status") == "active"),
        None,
    )
    if match:
        _ai_system_id = match["id"]
        return _ai_system_id

    record = await platform.ai_systems.register({
        "name": model_id,
        "type": "model",
        "provider": "google",
        "modelRef": model_id,
        "description": f"AI system for {model_id}",
        "metadata": {"registeredAt": datetime.utcnow().isoformat()},
    })
    _ai_system_id = record["id"]
    return _ai_system_id
```

---

## FastAPI Integration

```python
from contextlib import asynccontextmanager
from fastapi import FastAPI
from .governance import get_arelis
from arelis import GovernedInvokeInput
from google import genai

MODEL_ID = "gemini-2.5-flash"

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initialize unified client at startup
    get_arelis()
    yield

app = FastAPI(lifespan=lifespan)

@app.post("/generate")
async def generate(prompt: str):
    arelis = get_arelis()
    gemini = genai.Client(api_key=os.environ["GEMINI_API_KEY"])

    result = await arelis.governed_invoke(GovernedInvokeInput(
        model=MODEL_ID,
        prompt=prompt,
        invoke=lambda s: gemini.models.generate_content(model=MODEL_ID, contents=s).text,
        deny_mode="return",
    ))

    if not result.invoked:
        return {"error": "Blocked by policy", "decision": str(result.decision)}
    return {"output": result.result, "run_id": result.run_id}
```

---

## Django Integration

```python
# myapp/apps.py
from django.apps import AppConfig

class MyAppConfig(AppConfig):
    name = "myapp"

    def ready(self):
        from .governance import get_arelis
        get_arelis()
```

---

## Flask Integration

```python
from flask import Flask
from .governance import get_arelis

app = Flask(__name__)

@app.before_first_request
def init_governance():
    get_arelis()
```
