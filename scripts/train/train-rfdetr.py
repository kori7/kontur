"""Fine-tune RF-DETR on the merged dataset.

    python scripts/train/train-rfdetr.py [--size small] [--epochs 40] [--batch 4] [--device mps]

Starts from the published COCO weights of the chosen size (Nano, Small or Medium — the sizes under
Apache 2.0) and writes checkpoints to .models/rfdetr/kontur/. The server picks up
checkpoint_best_total.pth with KONTUR_DETECTOR=rfdetr.

On a MacBook training is slow; the same script runs unchanged on a machine with an NVIDIA GPU (for
example Google Colab): copy .models/rfdetr/dataset/ and this folder there, run, and bring
checkpoint_best_total.pth back. Internet is allowed while training; the defence runs offline.
"""

import argparse
import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATASET = ROOT / ".models" / "rfdetr" / "dataset"
OUTPUT = ROOT / ".models" / "rfdetr" / "kontur"
SIZES = {"nano": "RFDETRNano", "small": "RFDETRSmall", "medium": "RFDETRMedium"}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--size", choices=sorted(SIZES), default="small")
    parser.add_argument("--epochs", type=int, default=40)
    parser.add_argument("--batch", type=int, default=4)
    parser.add_argument("--accumulate", type=int, default=4, help="шагов накопления градиента")
    parser.add_argument("--lr", type=float, default=1e-4)
    parser.add_argument("--device", default=None, help="mps, cuda или cpu; по умолчанию — лучшее доступное")
    parser.add_argument("--progress", choices=["tqdm", "rich", "none"], default="tqdm",
                        help="полоса прогресса: без неё не видно ни скорости, ни сколько осталось")
    parser.add_argument("--single-scale", action="store_true",
                        help="учить на родном разрешении модели: на Mac многомасштабное обучение до 672 px в разы дольше")
    parser.add_argument("--dataset", type=Path, default=DATASET)
    parser.add_argument("--output", type=Path, default=OUTPUT)
    args = parser.parse_args()
    if not (args.dataset / "train" / "_annotations.coco.json").is_file():
        raise SystemExit(f"Нет выборки в {args.dataset}: сначала scripts/train/prepare-dataset.py")

    os.environ.setdefault("RF_HOME", str(ROOT / ".models" / "rfdetr"))
    import rfdetr

    model = getattr(rfdetr, SIZES[args.size])()
    options = {"dataset_dir": str(args.dataset), "epochs": args.epochs, "batch_size": args.batch,
               "grad_accum_steps": args.accumulate, "lr": args.lr, "output_dir": str(args.output)}
    if args.device:
        options["device"] = args.device
    if args.single_scale:
        options["multi_scale"] = False
    if args.progress != "none":
        options["progress_bar"] = args.progress
    started = time.time()
    model.train(**options)
    args.output.mkdir(parents=True, exist_ok=True)
    sources = args.dataset / "SOURCES.json"
    (args.output / "TRAINING.json").write_text(json.dumps({
        "size": args.size, "epochs": args.epochs, "single_scale": args.single_scale, "batch": args.batch, "accumulate": args.accumulate,
        "lr": args.lr, "rfdetr": rfdetr.__version__ if hasattr(rfdetr, "__version__") else None,
        "finished_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "minutes": round((time.time() - started) / 60, 1),
        "dataset": json.loads(sources.read_text(encoding="utf-8")) if sources.is_file() else None,
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Готово: {args.output / 'checkpoint_best_total.pth'}")


if __name__ == "__main__":
    main()
