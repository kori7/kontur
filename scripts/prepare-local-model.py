"""Preparation-only downloads, pinned and verified; never used by application startup."""

import hashlib
import json
import time
import urllib.request
import zipfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REVISION = "1cd86afb9a95c410a6038ab3b40d8b578c892266"
HF = f"https://huggingface.co/Qwen/Qwen3-VL-4B-Instruct-GGUF/resolve/{REVISION}"
GH = "https://github.com/ggml-org/llama.cpp/releases/download/b12359"
ASSETS = [
    (f"{HF}/Qwen3VL-4B-Instruct-Q4_K_M.gguf", ".models/Qwen3VL-4B-Instruct-Q4_K_M.gguf",
     "66358cb18bb6b3b1b6675aa412c7a88ef01d228f481184d13668e5201c730a0a"),
    (f"{HF}/mmproj-Qwen3VL-4B-Instruct-Q8_0.gguf", ".models/mmproj-Qwen3VL-4B-Instruct-Q8_0.gguf",
     "30ba2c7dd3127a4561b6cba9d13d0f711c91bdb38742e2f56d73c8cb596bd06d"),
    (f"{GH}/llama-b12359-bin-win-cuda-12.4-x64.zip", ".runtime/downloads/llama.zip",
     "e9c0abf442e8339c06728366c1ad2c711332f9939c0c00603fb75d85fd44c914"),
    (f"{GH}/cudart-llama-bin-win-cuda-12.4-x64.zip", ".runtime/downloads/cudart.zip",
     "8c79a9b226de4b3cacfd1f83d24f962d0773be79f1e7b75c6af4ded7e32ae1d6"),
]


def digest(path):
    # Chunked read instead of hashlib.file_digest, which needs Python 3.11.
    hasher = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            hasher.update(chunk)
    return hasher.hexdigest()


def download(asset):
    url, relative, expected = asset
    path = ROOT / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() and digest(path) == expected:
        print(f"Verified existing {path.name}", flush=True)
        return
    partial = path.with_suffix(path.suffix + ".partial")
    if partial.exists() and digest(partial) == expected:
        partial.replace(path)
        print(f"Verified and promoted completed {path.name}", flush=True)
        return
    offset = partial.stat().st_size if partial.exists() else 0
    request = urllib.request.Request(url, headers={"Range": f"bytes={offset}-"} if offset else {})
    with urllib.request.urlopen(request, timeout=60) as response:
        resume = offset > 0 and response.status == 206
        total = offset if resume else 0
        last = time.monotonic()
        with partial.open("ab" if resume else "wb") as handle:
            while chunk := response.read(4 * 1024 * 1024):
                handle.write(chunk)
                total += len(chunk)
                if time.monotonic() - last > 20:
                    print(f"{path.name}: {total / 1024**2:.0f} MiB", flush=True)
                    last = time.monotonic()
    if digest(partial) != expected:
        raise RuntimeError(f"SHA256 mismatch: {path.name}")
    partial.replace(path)
    print(f"Downloaded and verified {path.name} ({path.stat().st_size / 1024**2:.0f} MiB)", flush=True)


def main():
    with ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(download, ASSETS))
    target = ROOT / ".runtime" / "llama"
    target.mkdir(parents=True, exist_ok=True)
    for name in ("llama.zip", "cudart.zip"):
        with zipfile.ZipFile(ROOT / ".runtime/downloads" / name) as archive:
            for member in archive.infolist():
                if not (target / member.filename).resolve().is_relative_to(target.resolve()):
                    raise ValueError("Unsafe archive path")
            archive.extractall(target)
    manifest = {"runtime": "llama.cpp b12359 CUDA 12.4 x64", "model": "Qwen3-VL-4B-Instruct",
                "quantization": "Q4_K_M", "projector": "Q8_0", "model_license": "Apache-2.0",
                "runtime_license": "MIT", "revision": REVISION,
                "assets": [{"url": u, "path": p, "sha256": h} for u, p, h in ASSETS]}
    (ROOT / ".runtime/manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print("Local runtime and model ready. Startup does not download anything.", flush=True)


if __name__ == "__main__":
    main()
