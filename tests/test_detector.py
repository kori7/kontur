"""Zero-shot detector: output conversion and configuration, without torch or weights."""

from pathlib import Path

import pytest

from app.detector import Query, boxes_from_outputs, from_environment

QUERIES = (Query("guard_missing", "Открытая муфта", "coupling", 0.3),
           Query("frame_corrosion", "Коррозия", "rust", 0.3))


def test_scores_below_the_class_threshold_are_dropped():
    scores = [[0.29, 0.9], [0.31, 0.1]]
    boxes = [[0.5, 0.5, 0.2, 0.2], [0.25, 0.25, 0.1, 0.1]]
    found = boxes_from_outputs(scores, boxes, QUERIES, 100, 100, padded_square=False)
    assert [(item.kind, item.confidence) for item in found] == [("guard_missing", 0.31), ("frame_corrosion", 0.9)]
    assert found[0].bbox == pytest.approx((0.2, 0.2, 0.3, 0.3))


def test_overlapping_boxes_of_one_kind_collapse_to_the_strongest():
    scores = [[0.8, 0], [0.7, 0], [0.6, 0]]
    boxes = [[0.5, 0.5, 0.4, 0.4], [0.51, 0.5, 0.4, 0.4], [0.1, 0.1, 0.1, 0.1]]
    found = boxes_from_outputs(scores, boxes, QUERIES, 100, 100, padded_square=False)
    assert [item.confidence for item in found] == [0.8, 0.6]


def test_owlv2_boxes_are_rescaled_from_the_padded_square():
    # A 200×100 frame is padded to 200×200: the frame's bottom edge sits at 0.5 of the model input.
    found = boxes_from_outputs([[0.9, 0]], [[0.5, 0.25, 0.5, 0.5]], QUERIES, 200, 100, padded_square=True)
    assert found[0].bbox == pytest.approx((0.25, 0.0, 0.75, 1.0))


def test_without_a_choice_the_server_says_no_detector(monkeypatch):
    monkeypatch.delenv("KONTUR_DETECTOR", raising=False)
    detector = from_environment()
    assert (detector.name, detector.ready) == ("не подключён", False)


def test_unknown_choice_and_missing_weights_are_explained(monkeypatch, tmp_path):
    monkeypatch.setenv("KONTUR_DETECTOR", "yolo")
    assert "неизвестный" in from_environment().name
    monkeypatch.setenv("KONTUR_DETECTOR", "owlv2")
    monkeypatch.setenv("KONTUR_DETECTOR_DIR", str(tmp_path / "empty"))
    detector = from_environment()
    assert not detector.ready
    assert "prepare-detector.py" in detector.name


def test_queries_cover_only_classes_the_rules_or_registry_know():
    import json

    from app.detector import QUERIES as ALL
    from app.vision import VISUAL_COMPONENTS
    registry = json.loads((Path(__file__).resolve().parents[1] / "data/registry/defect-classes.json")
                          .read_text(encoding="utf-8"))
    known = set(VISUAL_COMPONENTS) | {item["id"] for item in registry["classes"]}
    assert {query.kind for query in ALL} <= known


def test_rfdetr_boxes_map_to_our_kinds_and_skip_others():
    from app.detector import detections_from_rfdetr

    found = detections_from_rfdetr([[10, 20, 60, 70], [0, 0, 5, 5]], [0.8, 0.9], [1, 2],
                                   ["kontur-defects", "frame_corrosion", "person"], 100, 100)
    assert [(item.kind, item.label, item.confidence) for item in found] == [("frame_corrosion", "Коррозия", 0.8)]
    assert found[0].bbox == pytest.approx((0.1, 0.2, 0.6, 0.7))


def test_rfdetr_threshold_comes_from_env_then_evaluation_then_default(monkeypatch, tmp_path):
    from app.detector import rfdetr_threshold

    checkpoint = tmp_path / "checkpoint_best_total.pth"
    monkeypatch.delenv("KONTUR_DETECTOR_THRESHOLD", raising=False)
    assert rfdetr_threshold(checkpoint) == 0.3
    (tmp_path / "threshold.json").write_text('{"threshold": 0.15}', encoding="utf-8")
    assert rfdetr_threshold(checkpoint) == 0.15
    monkeypatch.setenv("KONTUR_DETECTOR_THRESHOLD", "0.4")
    assert rfdetr_threshold(checkpoint) == 0.4


def test_rfdetr_without_a_trained_model_is_explained(monkeypatch, tmp_path):
    monkeypatch.setenv("KONTUR_DETECTOR", "rfdetr")
    monkeypatch.setenv("KONTUR_DETECTOR_CHECKPOINT", str(tmp_path / "missing.pth"))
    detector = from_environment()
    assert not detector.ready and "train-rfdetr.py" in detector.name
