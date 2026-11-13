import asyncio
import base64
import json

import httpx
import pytest

from app.vision import VisionClient, VisionError, validate_image


IMAGE = "data:image/png;base64," + base64.b64encode(b"\x89PNG\r\n\x1a\n" + b"0" * 32).decode()


def test_reject_remote_url_and_malformed_image():
    for value in ["https://example.org/pump.jpg", "data:image/png;base64,garbage"]:
        with pytest.raises(ValueError):
            validate_image(value)


def test_vision_uses_requested_model_and_does_not_receive_demo_scenario():
    def gateway(request):
        body = json.loads(request.content)
        assert body["model"] == "Qwen3-VL-4B-Instruct"
        assert body["messages"][1]["content"][1]["image_url"]["url"] == IMAGE
        assert "scenario_id" not in request.content.decode()
        content = {"quality": "good", "summary": "Кожух отсутствует", "observations": [
            {"kind": "guard_missing", "present": True, "description": "Видна открытая муфта",
             "bbox": [0.3, 0.4, 0.5, 0.6]}]}
        return httpx.Response(200, json={"choices": [{"message": {"content": json.dumps(content)}}]})
    result = asyncio.run(VisionClient(transport=httpx.MockTransport(gateway)).analyze(IMAGE))
    assert result["observations"][0]["source"] == "model"
    assert result["observations"][0]["component_id"] == "guard"


def test_unavailable_vision_fails_explicitly():
    def unavailable(request):
        raise httpx.ConnectError("unavailable", request=request)
    with pytest.raises(VisionError, match="локаль"):
        asyncio.run(VisionClient(transport=httpx.MockTransport(unavailable)).analyze(IMAGE))


def test_upstream_error_does_not_leak_body_or_secret():
    transport = httpx.MockTransport(lambda request: httpx.Response(401, text="secret-key-from-provider"))
    with pytest.raises(VisionError) as error:
        asyncio.run(VisionClient(transport=transport).analyze(IMAGE))
    assert "secret-key" not in str(error.value)


def test_local_server_status_is_reported_without_provider_body():
    transport = httpx.MockTransport(lambda request: httpx.Response(401, json={
        "error": {"message": "unauthorized client detected"}}))
    with pytest.raises(VisionError, match="401"):
        asyncio.run(VisionClient(transport=transport).analyze(IMAGE))


def test_unreadable_image_cannot_report_positive_observation():
    content = {"quality": "unreadable", "summary": "Размыто", "observations": [
        {"kind": "guard_missing", "present": True, "description": "Неясно", "bbox": None}]}
    transport = httpx.MockTransport(lambda request: httpx.Response(200, json={
        "choices": [{"message": {"content": json.dumps(content)}}]}))
    result = asyncio.run(VisionClient(transport=transport).analyze(IMAGE))
    assert result["observations"] == []


def test_real_adapter_shape_triggers_guard_rule_without_invented_confidence():
    from app.demo import get_scenario
    from app.diagnostics.engine import evaluate
    content = {"quality": "good", "summary": "Видна открытая муфта", "observations": [
        {"kind": "guard_missing", "present": True, "description": "Кожух отсутствует", "bbox": None}]}
    transport = httpx.MockTransport(lambda request: httpx.Response(200, json={
        "choices": [{"message": {"content": json.dumps(content)}}]}))
    result = asyncio.run(VisionClient(transport=transport).analyze(IMAGE))
    scenario = get_scenario("normal")
    observations = [item for item in scenario["observations"] if item["kind"] != "guard_missing"]
    evaluated = evaluate(scenario["telemetry"], observations + result["observations"])
    assert any("R11" in item["rule_ids"] for item in evaluated["alerts"])
    assert "confidence" not in result["observations"][0]
