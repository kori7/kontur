"""Supplied materials are served for review with their provenance, and never as equipment telemetry."""

import hashlib
import json
from pathlib import Path

from fastapi.testclient import TestClient
import pytest

from app.library import ORGANIZER, resolve
from app.main import create_app
from app.reference_data import organizer_assessment

ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture
def client(tmp_path):
    with TestClient(create_app(tmp_path / "inspection.db")) as client:
        yield client


def test_series_are_listed_with_their_own_setpoints(client):
    payload = client.get("/api/reference/series").json()
    assert [item["id"] for item in payload["series"]] == ["vibration-001", "temperature-001"]
    channels = {item["id"]: item for item in payload["thresholds"]["channels"]}
    assert channels["vibration_1x"]["warning"] == 2.8 and channels["vibration_1x"]["alarm"] == 4.5
    assert channels["high_frequency_acceleration_g"]["unit"] == "g"
    assert payload["thresholds"]["applies_to_status"] == "unknown"
    assert payload["thresholds"]["conflicts_with_project"], (
        "Расхождение с проектными уставками должно доезжать до интерфейса, а не теряться."
    )


def test_series_never_claim_an_equipment_identifier(client):
    for item in client.get("/api/reference/series").json()["series"]:
        assert item["equipment_id"] is None
        window = client.get(f"/api/reference/series/{item['id']}").json()
        assert window["equipment_id"] is None
        assert window["observations"] == [], "Пометка организатора не становится наблюдением системы."


def test_window_keeps_the_hour_step_and_the_original_row(client):
    window = client.get("/api/reference/series/vibration-001",
                        params={"end_index": 120, "limit": 5}).json()
    assert window["start_index"] == 116 and window["end_index"] == 120
    assert len(window["telemetry"]["samples"]) == 5
    assert window["source_time"]["timezone"] is None
    assert window["telemetry"]["timestamp_is_technical"] is True
    raw = [record["raw_date"] for record in window["records"]]
    assert raw == ["2026-11-15 04:00", "2026-11-15 05:00", "2026-11-15 06:00",
                   "2026-11-15 07:00", "2026-11-15 08:00"]


def test_assessment_covers_only_the_channels_this_series_measures(client):
    vibration = client.get("/api/reference/series/vibration-001").json()["organizer_assessment"]
    temperature = client.get("/api/reference/series/temperature-001").json()["organizer_assessment"]
    assert {item["id"] for item in vibration} == {"vibration_1x", "vibration_2x",
                                                  "high_frequency_acceleration_g"}
    assert {item["id"] for item in temperature} == {"temperature", "winding_temperature"}
    for item in vibration + temperature:
        assert item["source"] == "Описание ряда организатора"
        assert item["status"] != "unknown", "Канал ряда не должен отчитываться как отсутствующий."


def test_assessment_reports_crossing_the_organizer_setpoint():
    crossed = organizer_assessment([{"vibration_1x": 4.9, "vibration_2x": 2.0}],
                                   ["vibration_1x", "vibration_2x"])
    statuses = {item["id"]: item["status"] for item in crossed}
    assert statuses["vibration_1x"] == "above_alarm"
    assert statuses["vibration_2x"] == "above_warning"
    assert organizer_assessment([], ["vibration_1x"])[0]["status"] == "unknown"


def test_acceleration_is_never_assessed_against_a_velocity_setpoint(client):
    window = client.get("/api/reference/series/vibration-001").json()
    assessment = {item["id"]: item for item in window["organizer_assessment"]}
    assert assessment["high_frequency_acceleration_g"]["unit"] == "g"
    assert assessment["vibration_1x"]["unit"] == "mm/s"
    assert any("g" in text and "мм/с" in text for text in window["limitations"]), (
        "Ограничение о несовместимости g и мм/с должно приходить вместе с окном."
    )


def test_invalid_window_boundaries_are_rejected(client):
    assert client.get("/api/reference/series/vibration-001", params={"end_index": 500}).status_code == 422
    assert client.get("/api/reference/series/vibration-001", params={"limit": 0}).status_code == 422
    assert client.get("/api/reference/series/nope").status_code == 404


def test_library_counts_match_the_inventory(client):
    totals = client.get("/api/library").json()["totals"]
    assert totals == {"files": 84, "images": 55, "unique_images": 52,
                      "training_candidates": 24, "documents": 27}


def test_library_shows_why_a_file_cannot_be_reused(client):
    images = {item["id"]: item for item in client.get("/api/library").json()["images"]}
    assert images["pipes-009"]["provenance"] == "stock_watermark"
    assert images["pipes-009"]["training_use_label"] == "Исключён"
    assert images["pumps-004"]["provenance"] == "generated_watermark"
    assert images["motors-010"]["editing"] == "annotation_burned_in"
    assert images["valves-008"]["duplicate_of"] == "pumps-011"
    assert images["pumps-013"]["training_use"] == "candidate"


def test_library_serves_a_supplied_file_unchanged(client):
    response = client.get("/api/library/pumps-013/file")
    assert response.status_code == 200
    assert response.headers["content-type"] == "image/jpeg"
    entry = next(item for item in json.loads((ROOT / "data/registry/sources.json").read_text(encoding="utf-8"))["sources"]
                 if item["id"] == "pumps-013")
    assert hashlib.sha256(response.content).hexdigest() == entry["sha256"], (
        "Выданный файл должен совпадать с переданным оригиналом."
    )


def test_library_addresses_files_only_through_the_manifest(client):
    assert client.get("/api/library/nope/file").status_code == 404
    assert client.get("/api/library/..%2F..%2Fetc%2Fpasswd/file").status_code == 404
    assert client.get("/api/library/manifest/file").status_code == 404
    with pytest.raises(KeyError):
        resolve("../manifest.json")


def test_unknown_api_paths_are_404_even_when_the_frontend_is_built(tmp_path, monkeypatch):
    """With apps/web/dist present the SPA catch-all exists; it must not swallow /api/*."""
    import app.main as main

    dist = tmp_path / "root" / "apps" / "web" / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<!doctype html><title>spa</title>", encoding="utf-8")
    monkeypatch.setattr(main, "ROOT", tmp_path / "root")
    with TestClient(main.create_app(tmp_path / "inspection.db")) as built:
        assert built.get("/").status_code == 200, "Фронтенд по-прежнему отдаётся."
        assert built.get("/history").status_code == 200, "Маршруты SPA по-прежнему отдаются."
        for path in ("/api/nope", "/api/library/..%2F..%2Fetc%2Fpasswd/file", "/api"):
            response = built.get(path)
            assert response.status_code == 404, path
            assert "spa" not in response.text, f"{path}: вместо ошибки API пришла страница."


def test_every_resolved_file_stays_inside_the_organizer_directory(client):
    root = ORGANIZER.resolve()
    for group in ("images", "documents", "series"):
        for item in client.get("/api/library").json()[group]:
            if item["media_type"] is None:
                continue
            path, media_type, name = resolve(item["id"])
            assert path.resolve().is_relative_to(root)
            assert path.is_file() and media_type and name
