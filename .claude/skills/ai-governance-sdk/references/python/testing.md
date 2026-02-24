# Python SDK — Testing Patterns

Pytest setup, mocking the platform client, and asserting governance events.

---

## Mocking the Platform Client

```python
import pytest
from unittest.mock import MagicMock, patch

@pytest.fixture
def mock_platform():
    """Create a mock Arelis platform client."""
    platform = MagicMock()
    platform.events.create = MagicMock(return_value={"id": "evt_123"})
    platform.aiSystems.list = MagicMock(return_value={"data": []})
    platform.aiSystems.register = MagicMock(return_value={
        "id": "ais_123",
        "name": "test-model",
        "type": "model",
        "status": "active",
    })
    platform.governance.evaluatePolicy = MagicMock(return_value={
        "decisions": [{"decision": "allow", "policyId": "test-policy"}]
    })
    platform.risk.evaluate = MagicMock(return_value={"action": "allow", "score": 0})
    platform.proofs.create = MagicMock(return_value={"proofId": "proof_123"})
    platform.replay.startCausalGraph = MagicMock(return_value={"jobId": "job_123"})
    platform.graphs.commit = MagicMock(return_value={"rootHash": "abc123"})
    return platform
```

---

## Testing PII Gate

```python
from unittest.mock import MagicMock
from myapp.governance import scan_for_pii, manual_pre_invocation_gate as evaluate_pre_invocation_gate

def test_scan_for_pii_detects_ssn():
    result = scan_for_pii("My SSN is 123-45-6789")
    assert result["has_pii"] is True
    assert any(f["type"] == "ssn" for f in result["findings"])

def test_scan_for_pii_clean():
    result = scan_for_pii("Hello, how are you?")
    assert result["has_pii"] is False
    assert len(result["findings"]) == 0

def test_gate_blocks_pii(mock_platform):
    mock_platform.governance.evaluatePolicy = MagicMock(return_value={
        "decisions": [{"decision": "deny", "policyId": "pii-policy", "metadata": {"policyName": "PII Block"}}]
    })

    result = evaluate_pre_invocation_gate(
        mock_platform, "run_123", "My SSN is 123-45-6789", "ais_123", {"type": "human", "id": "u1"}
    )
    assert result["allowed"] is False
    assert "PII Block" in result["reason"]

def test_gate_allows_clean_prompt(mock_platform):
    result = evaluate_pre_invocation_gate(
        mock_platform, "run_123", "Hello world", "ais_123", {"type": "human", "id": "u1"}
    )
    assert result["allowed"] is True
```

---

## Testing Event Emission

```python
@pytest.mark.asyncio
async def test_events_emitted_after_generation(mock_platform):
    from myapp.chat import generate_with_governance

    with patch("myapp.chat.get_arelis_platform", return_value=mock_platform):
        await generate_with_governance("Hello", "user_1")

    # Verify events were emitted
    event_types = [
        call.args[0]["eventType"]
        for call in mock_platform.events.create.call_args_list
    ]
    assert "model.invoked" in event_types
    assert "output.delivered" in event_types
```

---

## Testing Post-Stream Pipeline

```python
def test_full_pipeline(mock_platform):
    from myapp.pipeline import run_post_stream_pipeline

    run_post_stream_pipeline(
        platform=mock_platform,
        run_id="run_test",
        ai_system_id="ais_123",
        actor={"type": "human", "id": "u1"},
        model_id="test-model",
        total_output="Hello world",
        pii_result={"has_pii": False, "findings": []},
        ctx={"purpose": "test", "environment": "dev"},
    )

    # Verify all pipeline steps executed
    assert mock_platform.events.create.call_count >= 3  # policy.evaluated + model.invoked + output.delivered
    mock_platform.governance.evaluatePolicy.assert_called_once()
    mock_platform.risk.evaluate.assert_called_once()
    mock_platform.proofs.create.assert_called_once()
    mock_platform.replay.startCausalGraph.assert_called_once()
    mock_platform.graphs.commit.assert_called_once_with("run_test")
```
