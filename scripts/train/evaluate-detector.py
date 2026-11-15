"""Measure recall and precision of a detector on the held-out test split, and pick a threshold.

    python scripts/train/evaluate-detector.py rfdetr [--split test] [--min-precision 0.5]
    python scripts/train/evaluate-detector.py owlvit          # the untrained baseline, same photos

Every photo is scaled to 640 px on the longer side and JPEG-encoded, as the live camera sends it.
Predictions are collected once at a low threshold, then thresholds are swept offline. The chosen
threshold maximises recall while precision stays at or above --min-precision: the customer counts a
missed defect as worse than a false alarm. Results go to stdout and artifacts/eval-<model>.md.
"""

import argparse
import io
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(ROOT / "services" / "api"))

from kontur_training import choose_class_thresholds, choose_threshold, evaluate  # noqa: E402

from app.detector import MODELS, MODELS_DIR, RFDETR_CHECKPOINT, OwlDetector, RfDetrDetector  # noqa: E402
from app.live import MAX_SIDE  # noqa: E402

DATASET = ROOT / ".models" / "rfdetr" / "dataset"
THRESHOLDS = [round(0.05 * step, 2) for step in range(1, 19)]


def frame(path: Path):
    from PIL import Image

    image = Image.open(path).convert("RGB")
    scale = min(1.0, MAX_SIDE / max(image.size))
    image = image.resize((round(image.width * scale), round(image.height * scale)))
    buffer = io.BytesIO()
    image.save(buffer, "JPEG", quality=70)
    return buffer.getvalue()


def load(name: str, checkpoint: Path):
    detector = (RfDetrDetector(checkpoint, threshold=min(THRESHOLDS)) if name == "rfdetr"
                else OwlDetector(name, MODELS_DIR / name))
    if isinstance(detector, OwlDetector):
        detector.queries = tuple(type(query)(query.kind, query.label, query.text, min(THRESHOLDS))
                                 for query in detector.queries)
    while detector.state == "загружается":
        __import__("time").sleep(0.1)
    if not detector.ready:
        raise SystemExit(f"Детектор не загрузился: {detector.state}")
    return detector


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("model", choices=["rfdetr"] + sorted(MODELS))
    parser.add_argument("--checkpoint", type=Path, default=RFDETR_CHECKPOINT)
    parser.add_argument("--split", default="test")
    parser.add_argument("--dataset", type=Path, default=DATASET)
    parser.add_argument("--min-precision", type=float, default=0.5)
    args = parser.parse_args()
    folder = args.dataset / args.split
    coco = json.loads((folder / "_annotations.coco.json").read_text(encoding="utf-8"))
    names = {item["id"]: item["name"] for item in coco["categories"]}
    truth = {image["id"]: [] for image in coco["images"]}
    for item in coco["annotations"]:
        x, y, w, h = item["bbox"]
        truth[item["image_id"]].append((names[item["category_id"]], (x, y, x + w, y + h)))

    detector = load(args.model, args.checkpoint)
    images = []
    for image in coco["images"]:
        width, height = image["width"], image["height"]
        found = detector.detect(frame(folder / image["file_name"]))
        images.append({
            "file": image["file_name"],
            "truth": [(kind, (box[0] / width, box[1] / height, box[2] / width, box[3] / height))
                      for kind, box in truth[image["id"]]],
            "predicted": [(item.kind, item.bbox, item.confidence or 0.0) for item in found]})

    threshold, _ = choose_threshold(images, THRESHOLDS, args.min_precision)
    per_class = choose_class_thresholds(images, THRESHOLDS, args.min_precision)
    percent = lambda value: "—" if value is None else f"{value * 100:.0f}%"  # noqa: E731
    lines = [f"# {detector.name}: {args.split}, {len(images)} фото",
             f"Порог у каждого класса свой: наибольшая полнота при точности не ниже {args.min_precision:.0%}", "",
             "| Класс | Порог | Полнота по рамкам | Точность | Замечен на фото с дефектом | Рамок в разметке |",
             "|---|---|---|---|---|---|"]
    for kind, value in per_class.items():
        item = evaluate(images, value)[kind]
        lines.append(f"| {kind} | {value} | {percent(item['recall'])} | {percent(item['precision'])} | "
                     f"{item['photos_found']} из {item['photos']} | {item['tp'] + item['fn']} |")
    # Pictures with nothing wrong in them: how often the detector still reports something.
    clean = [image for image in images if not image["truth"]]
    noisy = [image for image in clean if any(score >= per_class.get(kind, threshold)
                                               for kind, _, score in image["predicted"])]
    lines += ["", f"Снимки без дефектов: рамка хотя бы одна на {len(noisy)} из {len(clean)}"]
    text = "\n".join(lines)
    print(text)
    (ROOT / "artifacts").mkdir(exist_ok=True)
    (ROOT / "artifacts" / f"eval-{args.model}-{args.split}.md").write_text(text + "\n", encoding="utf-8")
    if args.model == "rfdetr" and args.split == "test":
        # The server reads this file, so the threshold in use is the one measured here.
        (args.checkpoint.parent / "threshold.json").write_text(json.dumps({
            "threshold": threshold, "per_class": per_class, "min_precision": args.min_precision, "photos": len(images),
            "dataset": str(args.dataset), "evaluated_at": __import__("datetime").datetime.now().isoformat(
                timespec="seconds")}, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"Порог записан рядом с моделью: {args.checkpoint.parent / 'threshold.json'}")


if __name__ == "__main__":
    main()
