"""Dataset merging and detector metrics for КОНТУР. Plain Python: no torch, testable anywhere.

Datasets arrive as Roboflow COCO exports (``train/``, ``valid/``, ``test/`` each with
``_annotations.coco.json``). Every source declares in ``sources.json`` how its classes map to our
visual kinds; a class it does not declare stops the merge, so nothing is relabelled by accident. ``split`` says where a
source's images go: ``keep`` its own split, one fixed split (``test`` for our own photos), or a
mapping such as ``{"test": "valid"}`` so that public photos never sit in our test set. A
class mapped to ``null`` becomes background: e.g. an ordinary bolt is exactly what the detector
must learn not to report.

Roboflow names augmented copies ``<name>_jpg.rf.<hash>.jpg``. Copies of one photo must not end up in
both training and test, or the measured recall is inflated; the merge keeps every copy of a photo in
the first split it was met in and reports how many it moved.
"""

import json
import shutil
from collections import defaultdict
from pathlib import Path

# Training classes, in category-id order (id 0 is the Roboflow-style supercategory placeholder).
CLASSES = ("guard_missing", "seal_leak_excessive", "oil_leak_at_housing", "frame_corrosion",
           "missing_bolt", "loose_bolt")
SPLITS = ("train", "valid", "test")
ANNOTATIONS = "_annotations.coco.json"


class DatasetError(ValueError):
    pass


def base_stem(file_name: str) -> str:
    """The photo a Roboflow file was made from: ``pump_jpg.rf.ab12.jpg`` → ``pump``."""
    name = Path(file_name).name.split(".rf.")[0]
    for suffix in ("_jpg", "_jpeg", "_png", "_JPG", "_JPEG", "_PNG"):
        if name.endswith(suffix):
            return name[: -len(suffix)]
    return Path(name).stem


def _class_map(source: dict, categories: list[dict]) -> dict[int, str | None]:
    declared = {key.strip().lower(): value for key, value in source["classes"].items()}
    used = {}
    for category in categories:
        key = category["name"].strip().lower()
        if category.get("supercategory") == "none":  # Roboflow's placeholder, never annotated
            used[category["id"]] = None
            continue
        if key not in declared:
            raise DatasetError(f"{source['id']}: класс «{category['name']}» не описан в sources.json")
        target = declared[key]
        if target is not None and target not in CLASSES:
            raise DatasetError(f"{source['id']}: «{category['name']}» → «{target}», такого класса нет")
        used[category["id"]] = target
    return used


def merge(sources: list[dict], sources_root: Path, out_dir: Path) -> dict:
    """Write one Roboflow-format dataset with our classes; return counts per split and class."""
    if out_dir.exists():
        shutil.rmtree(out_dir)
    output = {split: {"images": [], "annotations": []} for split in SPLITS}
    report = {"sources": [], "moved_duplicates": 0,
              "counts": {split: {"images": 0, **{name: 0 for name in CLASSES}} for split in SPLITS}}
    for source in sources:
        folder = sources_root / source["id"]
        exclude = {Path(item).name for item in source.get("exclude", [])}
        exclude_stems = {base_stem(item) for item in exclude}
        seen_split: dict[str, str] = {}
        excluded = 0
        for split in SPLITS:
            path = folder / split / ANNOTATIONS
            if not path.is_file():
                continue
            coco = json.loads(path.read_text(encoding="utf-8"))
            mapping = _class_map(source, coco["categories"])
            by_image = defaultdict(list)
            for item in coco["annotations"]:
                by_image[item["image_id"]].append(item)
            for image in coco["images"]:
                stem = base_stem(image["file_name"])
                if image["file_name"] in exclude or stem in exclude_stems:
                    excluded += 1
                    continue
                rule = source.get("split", "keep")
                target = split if rule == "keep" else rule.get(split, split) if isinstance(rule, dict) else rule
                if target not in SPLITS:
                    raise DatasetError(f"{source['id']}: неизвестная часть выборки «{target}»")
                if stem in seen_split and seen_split[stem] != target:
                    target = seen_split[stem]
                    report["moved_duplicates"] += 1
                seen_split.setdefault(stem, target)
                new_name = f"{source['id']}__{Path(image['file_name']).name}"
                (out_dir / target).mkdir(parents=True, exist_ok=True)
                shutil.copyfile(folder / split / image["file_name"], out_dir / target / new_name)
                image_id = len(output[target]["images"])
                output[target]["images"].append({"id": image_id, "file_name": new_name,
                                                 "width": image["width"], "height": image["height"]})
                report["counts"][target]["images"] += 1
                for item in by_image[image["id"]]:
                    kind = mapping.get(item["category_id"])
                    if kind is None:
                        continue
                    output[target]["annotations"].append({
                        "id": len(output[target]["annotations"]), "image_id": image_id,
                        "category_id": CLASSES.index(kind) + 1, "bbox": item["bbox"],
                        "area": item.get("area", item["bbox"][2] * item["bbox"][3]), "iscrowd": 0})
                    report["counts"][target][kind] += 1
        report["sources"].append({key: source.get(key) for key in ("id", "url", "license", "author", "version")}
                                 | {"excluded_images": excluded})
    categories = [{"id": 0, "name": "kontur-defects", "supercategory": "none"}] + [
        {"id": index + 1, "name": name, "supercategory": "kontur-defects"} for index, name in enumerate(CLASSES)]
    for split in SPLITS:
        if not output[split]["images"]:
            continue
        (out_dir / split).mkdir(parents=True, exist_ok=True)
        (out_dir / split / ANNOTATIONS).write_text(
            json.dumps({"images": output[split]["images"], "annotations": output[split]["annotations"],
                        "categories": categories}, ensure_ascii=False), encoding="utf-8")
    (out_dir / "SOURCES.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    return report


def iou(a, b) -> float:
    x1, y1 = max(a[0], b[0]), max(a[1], b[1])
    x2, y2 = min(a[2], b[2]), min(a[3], b[3])
    inter = max(0.0, x2 - x1) * max(0.0, y2 - y1)
    union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / union if union > 0 else 0.0


def evaluate(images: list[dict], threshold: float, iou_limit: float = 0.5) -> dict:
    """Recall and precision per class at one confidence threshold.

    ``images`` holds ``truth``: [(kind, xyxy)] and ``predicted``: [(kind, xyxy, score)]. A prediction
    counts once, for the best-overlapping unmatched truth box of its class. Besides boxes, the result
    says on how many photos with a defect the class was noticed at all — what an inspector cares about.
    """
    stats = {kind: {"tp": 0, "fp": 0, "fn": 0, "photos": 0, "photos_found": 0} for kind in CLASSES}
    for image in images:
        for kind in CLASSES:
            truths = [box for name, box in image["truth"] if name == kind]
            guesses = sorted(((box, score) for name, box, score in image["predicted"]
                              if name == kind and score >= threshold), key=lambda item: -item[1])
            matched = set()
            for box, _ in guesses:
                best, best_iou = None, iou_limit
                for index, truth in enumerate(truths):
                    overlap = iou(box, truth)
                    if index not in matched and overlap >= best_iou:
                        best, best_iou = index, overlap
                if best is None:
                    stats[kind]["fp"] += 1
                else:
                    matched.add(best)
                    stats[kind]["tp"] += 1
            stats[kind]["fn"] += len(truths) - len(matched)
            if truths:
                stats[kind]["photos"] += 1
                stats[kind]["photos_found"] += bool(matched)
    for value in stats.values():
        found = value["tp"] + value["fn"]
        said = value["tp"] + value["fp"]
        value["recall"] = value["tp"] / found if found else None
        value["precision"] = value["tp"] / said if said else None
        value["photo_recall"] = value["photos_found"] / value["photos"] if value["photos"] else None
    return stats


def choose_class_thresholds(images: list[dict], candidates, min_precision: float = 0.5) -> dict[str, float]:
    """The same rule as ``choose_threshold``, class by class, for the classes the test photos contain.

    A class that never reaches ``min_precision`` gets the threshold with its best precision, so it at
    least stays as quiet as the model allows.
    """
    chosen = {}
    for kind in CLASSES:
        rows = [(threshold, evaluate(images, threshold)[kind]) for threshold in sorted(candidates, reverse=True)]
        if not rows or rows[0][1]["tp"] + rows[0][1]["fn"] == 0:
            continue
        good = [(row["recall"] or 0.0, threshold) for threshold, row in rows
                if row["precision"] is not None and row["precision"] >= min_precision]
        if good:
            chosen[kind] = max(good, key=lambda item: (item[0], item[1]))[1]
        else:
            chosen[kind] = max(rows, key=lambda item: (item[1]["precision"] or 0.0, item[0]))[0]
    return chosen


def choose_threshold(images: list[dict], candidates, min_precision: float = 0.5) -> tuple[float, dict]:
    """The threshold with the highest recall over all classes whose precision is still ≥ ``min_precision``.

    Missing a defect is worse than a false alarm (organizer answers §5), so recall decides; the
    precision floor keeps the screen from filling with boxes. Ties go to the higher threshold.
    """
    best = None
    for threshold in sorted(candidates, reverse=True):
        stats = evaluate(images, threshold)
        tp = sum(item["tp"] for item in stats.values())
        fn = sum(item["fn"] for item in stats.values())
        fp = sum(item["fp"] for item in stats.values())
        recall = tp / (tp + fn) if tp + fn else 0.0
        precision = tp / (tp + fp) if tp + fp else 1.0
        if precision >= min_precision and (best is None or recall > best[0]):
            best = (recall, threshold, stats)
    if best is None:
        threshold = min(candidates)
        return threshold, evaluate(images, threshold)
    return best[1], best[2]
