"""Time the zero-shot detector on frames prepared exactly as the phone sends them.

    python scripts/qa/bench-detector.py owlvit [--device cpu] [--runs 10] [images...]
    python scripts/qa/bench-detector.py rfdetr-nano      # published COCO weights: speed only
    python scripts/qa/bench-detector.py rfdetr --checkpoint .models/rfdetr/kontur/checkpoint_best_total.pth

Each image is scaled so its longer side is 640 px and encoded as JPEG at quality 0.7, like the
live camera does; the measured time covers decoding, the model and box conversion. Without image
arguments the three demo images are used. This measures speed, not recognition quality: the boxes
printed below are what the untrained model says, not checked against any labels.
"""

import argparse
import io
import statistics
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "services" / "api"))

from app.detector import MODELS, MODELS_DIR, RFDETR_CHECKPOINT, OwlDetector, RfDetrDetector  # noqa: E402
from app.live import MAX_SIDE  # noqa: E402


def frame(path: Path) -> bytes:
    from PIL import Image

    image = Image.open(path).convert("RGB")
    scale = min(1.0, MAX_SIDE / max(image.size))
    image = image.resize((round(image.width * scale), round(image.height * scale)))
    buffer = io.BytesIO()
    image.save(buffer, "JPEG", quality=70)
    return buffer.getvalue()


RFDETR_SIZES = {"rfdetr-nano": "RFDETRNano", "rfdetr-small": "RFDETRSmall", "rfdetr-medium": "RFDETRMedium"}


def build(args):
    if args.model in MODELS:
        return OwlDetector(args.model, MODELS_DIR / args.model, device=args.device)
    if args.model == "rfdetr":
        return RfDetrDetector(args.checkpoint)
    # Published COCO weights, fetched into RF_HOME on first use. They know no defects: speed only.
    import rfdetr

    model = getattr(rfdetr, RFDETR_SIZES[args.model])()
    detector = RfDetrDetector(Path(args.model), model=model, label=f"{args.model}, веса COCO (только скорость)")
    detector.threshold = 0.5
    return detector


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("model", choices=sorted(MODELS) + ["rfdetr"] + sorted(RFDETR_SIZES))
    parser.add_argument("--checkpoint", type=Path, default=RFDETR_CHECKPOINT)
    parser.add_argument("images", nargs="*", type=Path)
    parser.add_argument("--device", default=None, help="cpu или mps; по умолчанию mps, если доступен")
    parser.add_argument("--runs", type=int, default=10)
    args = parser.parse_intermixed_args()
    images = args.images or sorted((ROOT / "data" / "demo" / "images").glob("*.png"))

    started = time.perf_counter()
    detector = build(args)
    while detector.state == "загружается":
        time.sleep(0.1)
    if not detector.ready:
        raise SystemExit(f"Детектор не загрузился: {detector.state}")
    print(f"{args.model}: {detector.name} · устройство {detector.device} · загрузка {time.perf_counter() - started:.1f} с")

    timings = []
    for path in images:
        jpeg = frame(path)
        for _ in range(2):  # warm-up: the first runs include one-off compilation and allocation
            detector.detect(jpeg)
        for _ in range(args.runs):
            began = time.perf_counter()
            found = detector.detect(jpeg)
            timings.append((time.perf_counter() - began) * 1000)
        boxes = ", ".join(f"{item.label} {item.confidence:.2f}" for item in found) or "ничего"
        print(f"{path.name}: {boxes}")
    timings.sort()
    p90 = timings[min(len(timings) - 1, int(len(timings) * 0.9))]
    print(f"Кадров: {len(timings)} · медиана {statistics.median(timings):.0f} мс · 90-й процентиль {p90:.0f} мс"
          f" · ≈{1000 / statistics.median(timings):.1f} кадра/с без сети")


if __name__ == "__main__":
    main()
