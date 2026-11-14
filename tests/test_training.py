"""Dataset merge and metrics for detector training: class mapping, split hygiene, recall-first threshold."""

import importlib.util
import json
from pathlib import Path

import pytest

SCRIPT = Path(__file__).parents[1] / "scripts/train/kontur_training.py"
spec = importlib.util.spec_from_file_location("kontur_training", SCRIPT)
training = importlib.util.module_from_spec(spec)
spec.loader.exec_module(training)


def export(root: Path, split: str, images: list[tuple[str, list[tuple[str, list[float]]]]], categories):
    """A minimal Roboflow COCO export: placeholder category 0 plus the given class names."""
    folder = root / split
    folder.mkdir(parents=True, exist_ok=True)
    cats = [{"id": 0, "name": "src", "supercategory": "none"}] + [
        {"id": index + 1, "name": name, "supercategory": "src"} for index, name in enumerate(categories)]
    ids = {item["name"]: item["id"] for item in cats}
    coco = {"images": [], "annotations": [], "categories": cats}
    for number, (name, boxes) in enumerate(images):
        (folder / name).write_bytes(b"\xff\xd8\xff")
        coco["images"].append({"id": number, "file_name": name, "width": 100, "height": 100})
        for kind, box in boxes:
            coco["annotations"].append({"id": len(coco["annotations"]), "image_id": number,
                                        "category_id": ids[kind], "bbox": box})
    (folder / "_annotations.coco.json").write_text(json.dumps(coco), encoding="utf-8")


def test_base_stem_ties_roboflow_copies_to_one_photo():
    assert training.base_stem("pump_01_jpg.rf.ab12cd.jpg") == "pump_01"
    assert training.base_stem("pump_01_jpg.rf.ffff00.jpg") == "pump_01"
    assert training.base_stem("plain.png") == "plain"


def test_merge_maps_classes_drops_background_and_keeps_public_photos_out_of_test(tmp_path):
    sources = tmp_path / "sources"
    export(sources / "bolts", "train", [("a_jpg.rf.1.jpg", [("Loose bolt", [1, 1, 10, 10]),
                                                             ("Regular bolt", [20, 20, 5, 5])])],
           ["Loose bolt", "Regular bolt"])
    export(sources / "bolts", "test", [("b_jpg.rf.2.jpg", [("Loose bolt", [1, 1, 10, 10])])],
           ["Loose bolt", "Regular bolt"])
    export(sources / "own", "test", [("guard.jpg", [("guard_missing", [5, 5, 50, 50])]),
                                     ("clean.jpg", [])], ["guard_missing"])
    report = training.merge([
        {"id": "bolts", "split": {"test": "valid"},
         "classes": {"loose bolt": "loose_bolt", "Regular bolt": None}},
        {"id": "own", "split": "keep", "classes": {"guard_missing": "guard_missing"}},
    ], sources, tmp_path / "out")
    counts = report["counts"]
    assert (counts["train"]["loose_bolt"], counts["valid"]["loose_bolt"], counts["test"]["loose_bolt"]) == (1, 1, 0)
    assert counts["test"]["images"] == 2 and counts["test"]["guard_missing"] == 1
    train = json.loads((tmp_path / "out/train/_annotations.coco.json").read_text(encoding="utf-8"))
    assert [item["category_id"] for item in train["annotations"]] == [training.CLASSES.index("loose_bolt") + 1]
    assert train["categories"][0]["supercategory"] == "none"
    assert (tmp_path / "out/train/bolts__a_jpg.rf.1.jpg").is_file()


def test_undeclared_class_stops_the_merge(tmp_path):
    export(tmp_path / "src" / "x", "train", [("a.jpg", [])], ["Mystery"])
    with pytest.raises(training.DatasetError, match="Mystery"):
        training.merge([{"id": "x", "classes": {}}], tmp_path / "src", tmp_path / "out")


def test_copies_of_one_photo_stay_in_one_split(tmp_path):
    sources = tmp_path / "sources"
    export(sources / "own", "train", [("p_jpg.rf.1.jpg", [("guard_missing", [1, 1, 5, 5])])], ["guard_missing"])
    export(sources / "own", "test", [("p_jpg.rf.2.jpg", [("guard_missing", [1, 1, 5, 5])]),
                                     ("q.jpg", [("guard_missing", [1, 1, 5, 5])])], ["guard_missing"])
    report = training.merge([{"id": "own", "classes": {"guard_missing": "guard_missing"}}],
                            sources, tmp_path / "out")
    assert report["moved_duplicates"] == 1
    assert report["counts"]["train"]["images"] == 2 and report["counts"]["test"]["images"] == 1


def test_excluded_files_are_left_out_with_all_their_copies(tmp_path):
    sources = tmp_path / "sources"
    export(sources / "bolts", "train", [("stock_jpg.rf.1.jpg", []), ("stock_jpg.rf.2.jpg", []), ("ok.jpg", [])],
           ["Loose bolt"])
    report = training.merge([{"id": "bolts", "classes": {"Loose bolt": "loose_bolt"},
                              "exclude": ["stock_jpg.rf.1.jpg"]}], sources, tmp_path / "out")
    assert report["counts"]["train"]["images"] == 1
    assert report["sources"][0]["excluded_images"] == 2


GUARD = (0.1, 0.1, 0.5, 0.5)


def test_evaluate_counts_boxes_and_photos():
    images = [
        {"truth": [("guard_missing", GUARD)], "predicted": [("guard_missing", (0.12, 0.1, 0.5, 0.5), 0.9),
                                                            ("guard_missing", (0.12, 0.1, 0.5, 0.5), 0.8)]},
        {"truth": [("guard_missing", GUARD)], "predicted": [("guard_missing", (0.7, 0.7, 0.9, 0.9), 0.9)]},
        {"truth": [], "predicted": []},
    ]
    stats = training.evaluate(images, threshold=0.5)["guard_missing"]
    assert (stats["tp"], stats["fp"], stats["fn"]) == (1, 2, 1)
    assert (stats["photos"], stats["photos_found"]) == (2, 1)
    assert stats["recall"] == 0.5 and stats["precision"] == pytest.approx(1 / 3)


def test_threshold_choice_prefers_recall_within_the_precision_floor():
    images = [
        {"truth": [("frame_corrosion", GUARD)], "predicted": [("frame_corrosion", GUARD, 0.9)]},
        {"truth": [("frame_corrosion", GUARD)], "predicted": [("frame_corrosion", GUARD, 0.3)]},
        {"truth": [], "predicted": [("frame_corrosion", GUARD, 0.25)]},
        {"truth": [], "predicted": [("frame_corrosion", GUARD, 0.1)]},
    ]
    threshold, stats = training.choose_threshold(images, [0.1, 0.2, 0.3, 0.5, 0.9], min_precision=0.6)
    assert threshold == 0.3
    assert stats["frame_corrosion"]["recall"] == 1.0
