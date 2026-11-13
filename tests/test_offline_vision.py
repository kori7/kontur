import asyncio
import json

import httpx
import pytest

from app.vision import VisionClient, VisionError
from test_vision import IMAGE


@pytest.mark.parametrize("url", ["https://agentrouter.org/v1", "http://192.168.1.3:8081/v1",
                                 "http://localhost:8081/v1", "http://127.0.0.1.evil.test/v1",
                                 "http://user:password@127.0.0.1:8081/v1"])
def test_offline_adapter_rejects_non_literal_loopback_or_credentials(url):
    with pytest.raises(ValueError, match="loopback"):
        VisionClient(base_url=url)


def test_local_model_needs_no_key_and_sends_no_authorization(monkeypatch):
    monkeypatch.setenv("HTTP_PROXY", "http://public-proxy.invalid:8888")
    monkeypatch.setenv("HTTPS_PROXY", "http://public-proxy.invalid:8888")

    def local_server(request):
        assert request.url.host == "127.0.0.1"
        assert "authorization" not in request.headers
        body = json.loads(request.content)
        assert body["response_format"]["type"] == "json_object"
        assert "schema" in body["response_format"]
        assert body["temperature"] == 0
        result = {"quality": "good", "summary": "Коррозия рамы", "observations": [
            {"kind": "base_corrosion", "present": True, "description": "Ржавчина на раме", "bbox": None}]}
        return httpx.Response(200, json={"choices": [{"message": {"content": json.dumps(result)}}]})

    result = asyncio.run(VisionClient(transport=httpx.MockTransport(local_server)).analyze(IMAGE))
    assert result["offline"] is True
    assert result["observations"][0]["component_id"] == "base"


def test_local_redirect_is_never_followed():
    calls = []

    def redirect(request):
        calls.append(str(request.url))
        return httpx.Response(302, headers={"Location": "https://public-model.invalid/"})

    with pytest.raises(VisionError, match="302"):
        asyncio.run(VisionClient(transport=httpx.MockTransport(redirect)).analyze(IMAGE))
    assert len(calls) == 1


def test_local_model_failure_has_no_remote_fallback():
    calls = []

    def unavailable(request):
        calls.append(str(request.url))
        raise httpx.ConnectError("offline", request=request)

    with pytest.raises(VisionError, match="локаль"):
        asyncio.run(VisionClient(transport=httpx.MockTransport(unavailable)).analyze(IMAGE))
    assert len(calls) == 1
