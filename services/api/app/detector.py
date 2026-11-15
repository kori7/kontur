"""Detectors for live inspection: OWL-ViT / OWLv2 without training, RF-DETR after fine-tuning.

All three are Apache 2.0 (for RF-DETR: the Nano, Small and Medium sizes only). OWL models find
visible signs by text queries, as published; they are the baseline the plan measured first (see
docs/architecture.md: fast enough, not accurate enough). RF-DETR is fine-tuned on classes named
after our own visual kinds, so its class names map to rules and labels directly.

A zero-shot detector finds what is in the picture, not what is missing. So the guard rule asks for
the thing the guard would hide: a visible shaft coupling means the guard is not in place. A
coupling out of frame is not evidence of anything.

torch, transformers and rfdetr are optional. Without them, or without the weights on disk, the server
runs with ``NullDetector`` and says why. Weights are read only from the local folder: the server never
downloads anything (scripts/data/prepare-detector.py and the training script do that beforehand).
"""

import io
import json
import os
import threading
from dataclasses import dataclass
from pathlib import Path


from app.live import Detection, NullDetector

ROOT = Path(__file__).resolve().parents[3]
MODELS_DIR = ROOT / ".models" / "detectors"
RFDETR_CHECKPOINT = ROOT / ".models" / "rfdetr" / "kontur" / "checkpoint_best_total.pth"

# Labels for the classes a fine-tuned model may report. The class names are our visual kinds.
KIND_LABELS = {
    "guard_missing": "Нет кожуха муфты",
    "guard_damaged": "Кожух разрушен или смещён",
    "liquid_leak": "Жидкость, течь",
    "seal_leak_excessive": "Течь уплотнения",
    "oil_leak_at_housing": "Подтёк масла",
    "frame_corrosion": "Коррозия",
    "missing_bolt": "Нет болта",
    "loose_bolt": "Болт ослаблен",
}


@dataclass(frozen=True)
class Query:
    kind: str
    label: str
    text: str
    threshold: float


# Thresholds are set low on purpose: the customer counts a missed defect as worse than a false alarm
# (organizer answers §5). They are a starting point to be tuned on the held-out set, not a result.
QUERIES = (
    Query("guard_missing", "Открытая муфта — нет кожуха?", "a photo of an exposed shaft coupling", 0.12),
    Query("liquid_leak", "Жидкость, течь", "a puddle of leaking liquid on industrial equipment", 0.12),
    Query("oil_leak_at_housing", "Подтёк масла", "an oil stain on a metal machine housing", 0.12),
    Query("frame_corrosion", "Коррозия", "rust on a metal surface", 0.12),
    Query("missing_bolt", "Нет болта", "an empty bolt hole in a metal flange", 0.15),
)

# Which published checkpoint each short name means. Folder names under .models/detectors/.
MODELS = {
    "owlvit": "google/owlvit-base-patch32",
    "owlv2": "google/owlv2-base-patch16-ensemble",
}
MAX_PER_KIND = 5


def _iou(a, b) -> float:
    x1, y1 = max(a[0], b[0]), max(a[1], b[1])
    x2, y2 = min(a[2], b[2]), min(a[3], b[3])
    inter = max(0.0, x2 - x1) * max(0.0, y2 - y1)
    union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / union if union > 0 else 0.0


def boxes_from_outputs(scores, boxes, queries, width: int, height: int,
                       padded_square: bool, iou_limit: float = 0.5) -> list[Detection]:
    """Turn raw OWL outputs into boxes in the frame's 0..1 coordinates.

    ``scores`` is a ``patches × queries`` list after a sigmoid, ``boxes`` a ``patches × 4`` list of centre x,
    centre y, width, height relative to the model input. OWLv2 pads the picture to a square at the
    bottom and right before resizing, so its coordinates are relative to that square and are
    rescaled here; OWL-ViT stretches the picture instead and needs no correction.
    """
    sx = max(width, height) / width if padded_square else 1.0
    sy = max(width, height) / height if padded_square else 1.0
    found: list[Detection] = []
    for index, query in enumerate(queries):
        column = [row[index] for row in scores]
        candidates = sorted((i for i, score in enumerate(column) if score >= query.threshold),
                            key=lambda i: -column[i])
        kept: list[tuple[float, float, float, float]] = []
        for patch in candidates:
            cx, cy, w, h = (float(value) for value in boxes[patch])
            box = ((cx - w / 2) * sx, (cy - h / 2) * sy, (cx + w / 2) * sx, (cy + h / 2) * sy)
            if any(_iou(box, other) > iou_limit for other in kept):
                continue
            kept.append(box)
            found.append(Detection(query.kind, query.label, box, round(float(column[patch]), 3)))
            if len(kept) >= MAX_PER_KIND:
                break
    return found


class OwlDetector:
    """One OWL checkpoint from the local folder. Loads in the background; ``ready`` says when."""

    def __init__(self, short_name: str, folder: Path, queries=QUERIES, device: str | None = None):
        self.short_name = short_name
        self.folder = folder
        self.queries = tuple(queries)
        self.device = device
        self.ready = False
        self.state = "загружается"
        self._lock = threading.Lock()
        self._model = self._processor = self._text = None
        threading.Thread(target=self._load, daemon=True).start()

    @property
    def name(self) -> str:
        label = {"owlvit": "OWL-ViT", "owlv2": "OWLv2"}.get(self.short_name, self.short_name)
        return f"{label} без обучения" + ("" if self.ready else f" · {self.state}")

    def _load(self):
        try:
            import torch
            from transformers import AutoModelForZeroShotObjectDetection, AutoProcessor

            device = self.device or os.getenv("KONTUR_DETECTOR_DEVICE") or (
                "mps" if torch.backends.mps.is_available() else "cpu")
            processor = AutoProcessor.from_pretrained(self.folder, local_files_only=True)
            model = AutoModelForZeroShotObjectDetection.from_pretrained(self.folder, local_files_only=True)
            model.to(device).eval()
            # The queries never change, so they are tokenised once rather than with every frame.
            text = processor(text=[[query.text for query in self.queries]], return_tensors="pt")
            self._text = {key: value.to(device) for key, value in text.items()}
            self._model, self._processor, self.device = model, processor, device
            self._padded = model.config.model_type == "owlv2"
            self.ready, self.state = True, "готов"
        except Exception as exc:  # the server keeps running; the reason is shown to the engineer
            self.state = f"не загрузился: {type(exc).__name__}"

    def detect(self, jpeg: bytes) -> list[Detection]:
        if not self.ready:
            return []
        import torch
        from PIL import Image

        image = Image.open(io.BytesIO(jpeg)).convert("RGB")
        with self._lock, torch.inference_mode():
            pixels = self._processor(images=image, return_tensors="pt")["pixel_values"].to(self.device)
            outputs = self._model(pixel_values=pixels, **self._text)
            scores = torch.sigmoid(outputs.logits[0]).float().cpu().tolist()
            boxes = outputs.pred_boxes[0].float().cpu().tolist()
        return boxes_from_outputs(scores, boxes, self.queries, image.width, image.height, self._padded)


class RfDetrDetector:
    """A fine-tuned RF-DETR checkpoint. Classes outside ``KIND_LABELS`` are not reported.

    ``threshold`` is the confidence a box must exceed. It is chosen on the held-out set for recall:
    the customer counts a missed defect as worse than a false alarm.
    """

    def __init__(self, checkpoint: Path, threshold: float = 0.3, model=None, label: str = "RF-DETR, дообучен",
                 per_class: dict[str, float] | None = None):
        self.checkpoint = Path(checkpoint)
        self.label = label
        self.threshold = threshold
        # Classes differ in how sure the model is when right: corrosion on a real photo is never as clean
        # as a drawn leak, so each class can keep the threshold measured for it.
        self.per_class = per_class or {}
        self.ready = False
        self.state = "загружается"
        self.device = "auto"
        self._lock = threading.Lock()
        self._model = model
        if model is not None:
            self.ready, self.state = True, "готов"
        else:
            threading.Thread(target=self._load, daemon=True).start()

    @property
    def name(self) -> str:
        return self.label + ("" if self.ready else f" · {self.state}")

    def _load(self):
        try:
            from rfdetr import RFDETR

            self._model = RFDETR.from_checkpoint(str(self.checkpoint))
            self.ready, self.state = True, "готов"
        except Exception as exc:  # the server keeps running; the reason is shown to the engineer
            self.state = f"не загрузился: {type(exc).__name__}"

    def detect(self, jpeg: bytes) -> list[Detection]:
        if not self.ready:
            return []
        from PIL import Image

        image = Image.open(io.BytesIO(jpeg)).convert("RGB")
        with self._lock:
            lowest = min([self.threshold, *self.per_class.values()])
            found = self._model.predict(image, threshold=lowest, include_source_image=False)
            names = self._model.class_names
        return [item for item in detections_from_rfdetr(found.xyxy.tolist(), found.confidence.tolist(),
                                                        found.class_id.tolist(), names, image.width, image.height)
                if (item.confidence or 0) >= self.per_class.get(item.kind, self.threshold)]


def detections_from_rfdetr(xyxy, confidence, class_id, names, width: int, height: int) -> list[Detection]:
    """Pixel boxes from RF-DETR to 0..1 boxes with our labels; unknown classes are dropped."""
    found = []
    for (x1, y1, x2, y2), score, index in zip(xyxy, confidence, class_id):
        kind = names[int(index)] if 0 <= int(index) < len(names) else None
        if kind not in KIND_LABELS:
            continue
        found.append(Detection(kind, KIND_LABELS[kind], (x1 / width, y1 / height, x2 / width, y2 / height),
                               round(float(score), 3)))
    return found


def rfdetr_threshold(checkpoint: Path) -> float:
    """KONTUR_DETECTOR_THRESHOLD, else the threshold evaluate-detector.py chose on the test photos, else 0.3."""
    if os.getenv("KONTUR_DETECTOR_THRESHOLD"):
        return float(os.getenv("KONTUR_DETECTOR_THRESHOLD"))
    chosen = checkpoint.parent / "threshold.json"
    try:
        return float(json.loads(chosen.read_text(encoding="utf-8"))["threshold"])
    except (OSError, ValueError, KeyError, TypeError):
        return 0.3


def rfdetr_class_thresholds(checkpoint: Path) -> dict[str, float]:
    """Per-class thresholds evaluate-detector.py measured; none when KONTUR_DETECTOR_THRESHOLD overrides."""
    if os.getenv("KONTUR_DETECTOR_THRESHOLD"):
        return {}
    try:
        chosen = json.loads((checkpoint.parent / "threshold.json").read_text(encoding="utf-8"))
        return {kind: float(value) for kind, value in chosen.get("per_class", {}).items()}
    except (OSError, ValueError, TypeError, AttributeError):
        return {}


def from_environment():
    """The detector named by KONTUR_DETECTOR (owlvit, owlv2 or rfdetr), or a stand-in that says why not."""
    choice = os.getenv("KONTUR_DETECTOR", "").strip().lower()
    if not choice or choice == "none":
        return NullDetector()
    if choice == "rfdetr":
        checkpoint = Path(os.getenv("KONTUR_DETECTOR_CHECKPOINT", RFDETR_CHECKPOINT))
        if not checkpoint.is_file():
            return NullDetector(f"нет дообученной модели {checkpoint.name}, запустите scripts/train/train-rfdetr.py")
        try:
            import rfdetr  # noqa: F401
        except ImportError:
            return NullDetector("не установлен rfdetr (requirements-detector.txt)")
        return RfDetrDetector(checkpoint, rfdetr_threshold(checkpoint), per_class=rfdetr_class_thresholds(checkpoint))
    if choice not in MODELS:
        return NullDetector(f"неизвестный KONTUR_DETECTOR={choice}")
    folder = Path(os.getenv("KONTUR_DETECTOR_DIR", MODELS_DIR / choice))
    if not (folder / "config.json").is_file():
        return NullDetector(f"веса {choice} не найдены, запустите scripts/data/prepare-detector.py")
    try:
        import torch  # noqa: F401
        import transformers  # noqa: F401
    except ImportError:
        return NullDetector("не установлены torch и transformers (requirements-detector.txt)")
    return OwlDetector(choice, folder)
