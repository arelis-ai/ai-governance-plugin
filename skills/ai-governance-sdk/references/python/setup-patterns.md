# Python SDK — Setup Patterns

Installation, platform client initialization, AI system registration, and web framework integration.

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

## Platform Client Initialization

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
        "base_url": base_url,
        "api_key": api_key,
        "max_retries": 2,
        "timeout": 15_000,
    })
    return _platform
```

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ARELIS_API_KEY` | yes | Platform API key (`ak_sandbox_...` or `ak_prod_...`) |
| `ARELIS_API_URL` | yes | Platform URL (`https://api.arelis.digital`) |
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
from .governance import get_arelis_platform, ensure_ai_system_registered

MODEL_ID = "gemini-2.5-flash"

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Register AI system at startup
    platform = get_arelis_platform()
    await ensure_ai_system_registered(platform, MODEL_ID)
    yield

app = FastAPI(lifespan=lifespan)
```

---

## Django Integration

```python
# myapp/apps.py
from django.apps import AppConfig

class MyAppConfig(AppConfig):
    name = "myapp"

    def ready(self):
        from .governance import get_arelis_platform
        # Initialize platform singleton at startup
        get_arelis_platform()
```

---

## Flask Integration

```python
from flask import Flask
from .governance import get_arelis_platform

app = Flask(__name__)

@app.before_first_request
def init_governance():
    get_arelis_platform()
```
