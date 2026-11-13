import hashlib
import importlib.util
from pathlib import Path


def test_complete_verified_partial_is_promoted_without_network(tmp_path, monkeypatch):
    script = Path(__file__).parents[1] / "scripts/prepare-local-model.py"
    spec = importlib.util.spec_from_file_location("prepare_local_model", script)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    monkeypatch.setattr(module, "ROOT", tmp_path)
    data = b"completed-model-download"
    partial = tmp_path / "model.gguf.partial"
    partial.write_bytes(data)

    def unexpected_request(*args, **kwargs):
        raise AssertionError("A completed verified download must not request an EOF range")

    monkeypatch.setattr(module.urllib.request, "urlopen", unexpected_request)
    module.download(("https://example.invalid/model", "model.gguf", hashlib.sha256(data).hexdigest()))
    assert (tmp_path / "model.gguf").read_bytes() == data
