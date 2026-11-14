"""Download a zero-shot detector once, while internet is available; the server never downloads.

    python scripts/data/prepare-detector.py owlvit      # google/owlvit-base-patch32, ~0.6 GB
    python scripts/data/prepare-detector.py owlv2       # google/owlv2-base-patch16-ensemble, ~0.6 GB

Files go to .models/detectors/<name>/ (not committed). The script refuses a checkpoint whose model
card does not say Apache 2.0, and writes SOURCE.json with the exact revision, licence and SHA-256 of
every file, so the copy used at the defence can be traced to its source.
"""

import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "services" / "api"))

from app.detector import MODELS, MODELS_DIR  # noqa: E402

ALLOWED_LICENSES = {"apache-2.0"}
WANTED = ("config.json", "preprocessor_config.json", "tokenizer_config.json", "tokenizer.json",
          "vocab.json", "merges.txt", "special_tokens_map.json")


def digest(path: Path) -> str:
    hasher = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            hasher.update(chunk)
    return hasher.hexdigest()


def main(name: str) -> None:
    from huggingface_hub import HfApi, hf_hub_download

    repo = MODELS[name]
    info = HfApi().model_info(repo, files_metadata=False)
    license_id = (info.card_data or {}).get("license") if info.card_data else None
    if license_id not in ALLOWED_LICENSES:
        raise SystemExit(f"{repo}: лицензия «{license_id}» не входит в разрешённые {sorted(ALLOWED_LICENSES)}")
    files = {sibling.rfilename for sibling in info.siblings}
    weights = "model.safetensors" if "model.safetensors" in files else "pytorch_model.bin"
    target = MODELS_DIR / name
    target.mkdir(parents=True, exist_ok=True)
    record = {"repo": repo, "revision": info.sha, "license": license_id,
              "downloaded_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "files": {}}
    for filename in [item for item in WANTED if item in files] + [weights]:
        print(f"{repo}@{info.sha[:10]}: {filename}", flush=True)
        path = Path(hf_hub_download(repo, filename, revision=info.sha, local_dir=target))
        record["files"][filename] = digest(path)
    (target / "SOURCE.json").write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Готово: {target}\nЗапуск сервера с детектором: KONTUR_DETECTOR={name} ./scripts/dev/start.sh")


if __name__ == "__main__":
    if len(sys.argv) != 2 or sys.argv[1] not in MODELS:
        raise SystemExit(f"Укажите модель: {' или '.join(MODELS)}")
    main(sys.argv[1])
