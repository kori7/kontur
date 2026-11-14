"""Reference imports must preserve physical units, source clocks and provenance."""

from datetime import datetime, timedelta
import importlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys

import pytest


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data/imported"
MANIFEST = ROOT / "data/reference/organizer/manifest.json"
SCRIPT = ROOT / "scripts/data/import-reference-data.py"


@pytest.fixture
def reference():
    assert (ROOT / "services/api/app/reference_data.py").exists(), "Reference series provider is missing."
    return importlib.import_module("app.reference_data")


@pytest.fixture
def importer():
    assert SCRIPT.exists(), "Reference import script is missing."
    spec = importlib.util.spec_from_file_location("reference_import_script", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_catalog_lists_two_independent_hourly_series(reference):
    catalog = reference.list_reference_series()
    assert {entry["id"] for entry in catalog} == {"vibration-001", "temperature-001"}
    for entry in catalog:
        assert entry["record_count"] == 500
        assert entry["equipment_id"] is None
        assert entry["source"] == "reference"
        assert entry["source_time"]["timezone"] is None
        assert entry["source_time"]["time_basis"] == "floating_local_unknown_timezone"
        assert entry["source_time"]["sample_interval_seconds"] == 3600
        assert entry["source_time"]["first_raw"] == "2026-11-10 08:00"
        assert entry["source_time"]["last_raw"] == "2026-12-01 03:00"
        assert entry["limitations"]


def test_channels_keep_acceleration_distinct_from_velocity(reference):
    catalog = {item["id"]: item for item in reference.list_reference_series()}
    vibration = {item["key"]: item for item in catalog["vibration-001"]["channels"]}
    assert set(vibration) == {"rpm", "vibration", "vibration_1x", "vibration_2x", "high_frequency_acceleration_g"}
    assert vibration["high_frequency_acceleration_g"]["unit"] == "g"
    assert vibration["high_frequency_acceleration_g"]["raw_header"] == "ВЧ шум (g)"
    assert vibration["vibration"]["unit"] == "mm/s"
    assert vibration["vibration_1x"]["unit"] == "mm/s"
    temperature = {item["key"]: item for item in catalog["temperature-001"]["channels"]}
    assert set(temperature) == {"rpm", "temperature", "winding_temperature"}
    assert temperature["temperature"]["unit"] == "degC"
    assert temperature["winding_temperature"]["unit"] == "degC"


def test_window_preserves_hour_step_and_original_excel_record(reference):
    window = reference.get_reference_window("vibration-001", end_index=9)
    assert len(window["records"]) == len(window["telemetry"]["samples"]) == 10
    first = window["records"][0]
    assert first["index"] == 0
    assert first["row"] == 2
    assert first["sheet"] == "Вибрация"
    assert first["raw_date"] == "2026-11-10 08:00"
    assert first["original_path"] == "Вибрация\\БД значений (вибрация).xlsx"
    assert first["path"] == "vibration/vibration-001.xlsx"
    assert first["sha256"] == "a744dbaa8780bfac7c650e3e82449e6e844a6b73984a3a0625aecf7073a8e525"
    assert first["raw_values"]["СКЗ общее (мм/с)"] == 1.02
    assert first["values"]["vibration"] == 1.02
    dates = [datetime.fromisoformat(item["at"]) for item in window["telemetry"]["samples"]]
    assert set(right - left for left, right in zip(dates, dates[1:])) == {timedelta(hours=1)}
    assert window["telemetry"]["timestamp"] == dates[-1].isoformat()


def test_technical_clock_is_explicit_and_raw_clock_remains_unzoned(reference):
    window = reference.get_reference_window("temperature-001", end_index=0)
    assert window["source_time"]["timezone"] is None
    assert window["source_time"]["time_basis"] == "floating_local_unknown_timezone"
    assert window["source_time"]["first_raw"] == "2026-11-10 08:00"
    assert window["telemetry"]["time_basis"] == "floating_clock_technical_utc_coordinate"
    assert window["telemetry"]["timestamp_is_technical"] is True
    assert window["evaluation_time"] == "2026-11-10T08:00:00+00:00"
    assert window["records"][0]["source_time"] == "2026-11-10T08:00:00"


@pytest.mark.parametrize("identifier", ["vibration-001", "temperature-001"])
def test_reference_annotations_do_not_become_system_observations(reference, identifier):
    window = reference.get_reference_window(identifier)
    assert window["observations"] == []
    assert window["source"] == window["telemetry"]["source"] == "reference"
    assert window["records"][-1]["annotation"]
    assert "baseline" not in window["telemetry"]
    assert "equipment_id" not in window["telemetry"]
    assert "runtime_hours" not in window["telemetry"]
    fields = set(window["telemetry"]["samples"][-1]) - {"at"}
    channels = {item["key"] for item in window["channels"]}
    assert fields == channels
    assert "high_frequency_vibration" not in fields
    assert "axial_vibration" not in fields


@pytest.mark.parametrize("identifier", ["vibration-001", "temperature-001"])
def test_incomplete_hourly_series_do_not_satisfy_ten_minute_demo_rules(reference, identifier):
    from app.diagnostics.engine import evaluate

    window = reference.get_reference_window(identifier)
    result = evaluate(window["telemetry"], window["observations"], now=datetime.fromisoformat(window["evaluation_time"]))
    assert result["alerts"] == []
    assert {item["status"] for item in result["rule_results"]} == {"insufficient"}
    assert result["features"]["temperature_trend"] is None
    assert result["features"]["vibration_trend"] is None


def test_default_window_contains_last_ten_records_and_calls_are_independent(reference):
    first = reference.get_reference_window("temperature-001")
    assert [item["index"] for item in first["records"]] == list(range(490, 500))
    first["telemetry"]["samples"][-1]["temperature"] = -100
    first["records"][-1]["values"]["temperature"] = -100
    assert reference.get_reference_window("temperature-001")["telemetry"]["samples"][-1]["temperature"] == 50.8
    catalog = reference.list_reference_series()
    catalog[0]["equipment_id"] = "fabricated"
    assert reference.list_reference_series()[0]["equipment_id"] is None


def test_missing_channel_value_stays_unknown(reference, tmp_path, monkeypatch):
    catalog = json.loads((DATA_DIR / "catalog.json").read_text(encoding="utf-8"))
    series = json.loads((DATA_DIR / "temperature-001.json").read_text(encoding="utf-8"))
    series["records"][0]["values"]["temperature"] = None
    (tmp_path / "catalog.json").write_text(json.dumps(catalog), encoding="utf-8")
    (tmp_path / "temperature-001.json").write_text(json.dumps(series), encoding="utf-8")
    monkeypatch.setattr(reference, "DATA_DIR", tmp_path)
    window = reference.get_reference_window("temperature-001", end_index=0)
    assert window["telemetry"]["samples"][0]["temperature"] is None


@pytest.mark.parametrize("kwargs", [{"end_index": -1}, {"end_index": 500}, {"end_index": True},
                                    {"end_index": 1.5}, {"limit": 0}, {"limit": -1}, {"limit": True}])
def test_invalid_window_boundaries_are_rejected(reference, kwargs):
    with pytest.raises(ValueError):
        reference.get_reference_window("vibration-001", **kwargs)


def test_unknown_series_is_rejected(reference):
    with pytest.raises(KeyError):
        reference.get_reference_window("unknown")


def test_document_thresholds_are_stored_separately_with_citations():
    path = DATA_DIR / "reference-thresholds.json"
    assert path.exists(), "Document threshold reference is missing."
    reference = json.loads(path.read_text(encoding="utf-8"))
    assert reference["applied_to_demo_rules"] is False
    assert len(reference["documents"]) == 2
    thresholds = {(item["channel"], item["level"]): item for item in reference["thresholds"]}
    assert thresholds["vibration_1x", "warning"]["value"] == 2.8
    assert thresholds["vibration_1x", "alarm"]["value"] == 4.5
    assert thresholds["vibration_2x", "warning"]["value"] == 1.8
    assert thresholds["vibration_2x", "alarm"]["value"] == 3.0
    assert thresholds["high_frequency_acceleration_g", "indication"]["value"] == 2.5
    assert thresholds["high_frequency_acceleration_g", "indication"]["unit"] == "g"
    assert ("high_frequency_acceleration_g", "warning") not in thresholds
    assert thresholds["temperature", "warning"]["value"] == 75
    assert thresholds["temperature", "alarm"]["value"] == 90
    assert thresholds["winding_temperature", "warning"]["value"] == 90
    assert thresholds["winding_temperature", "alarm"]["value"] == 110
    for item in thresholds.values():
        assert item["operator"] == ">"
        assert item["citation"]["paragraph"] >= 1
        assert item["citation"]["text"]
        assert len(item["citation"]["sha256"]) == 64


def test_import_is_deterministic_and_checks_manifest_integrity(importer, tmp_path):
    runtime = Path(sys.executable)
    if importlib.util.find_spec("openpyxl") is None:
        runtime = Path.home() / ".cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe"
        if not runtime.exists():
            pytest.skip("Import verification requires openpyxl or the bundled Codex Python runtime.")
    command = [str(runtime), str(SCRIPT), "--manifest", str(MANIFEST), "--output", str(tmp_path)]
    summary = json.loads(subprocess.run(command, check=True, capture_output=True, text=True, encoding="utf-8").stdout)
    assert summary["manifest_entry_count"] == 84
    assert summary["series_count"] == 2
    assert summary["record_count"] == 1000
    assert summary["document_count"] == 2
    first = {path.name: path.read_bytes() for path in tmp_path.glob("*.json")}
    subprocess.run(command, check=True, capture_output=True, text=True, encoding="utf-8")
    assert {path.name: path.read_bytes() for path in tmp_path.glob("*.json")} == first
    for name, content in first.items():
        assert (DATA_DIR / name).read_bytes() == content


def test_import_output_does_not_depend_on_line_endings(importer, tmp_path):
    """Windows checks the manifest out with CRLF; the catalogue must come out identical."""
    if importlib.util.find_spec("openpyxl") is None:
        pytest.skip("Import requires openpyxl.")
    lf = MANIFEST.read_bytes().replace(b"\r\n", b"\n")
    for name, content in (("lf", lf), ("crlf", lf.replace(b"\n", b"\r\n"))):
        manifest = tmp_path / name / "manifest.json"
        manifest.parent.mkdir()
        manifest.write_bytes(content)
        importer.import_reference(manifest, tmp_path / name / "out", source_root=MANIFEST.parent)
    for path in (tmp_path / "lf" / "out").glob("*.json"):
        crlf_twin = tmp_path / "crlf" / "out" / path.name
        assert crlf_twin.read_bytes() == path.read_bytes(), f"{path.name} depends on the manifest's line endings."
        assert b"\r\n" not in path.read_bytes(), f"{path.name} must be written with LF on every OS."


def test_corrupt_manifest_hash_is_rejected_before_output(importer, tmp_path):
    entries = json.loads(MANIFEST.read_text(encoding="utf-8"))
    entries[0]["sha256"] = "0" * 64
    manifest = tmp_path / "manifest.json"
    manifest.write_text(json.dumps(entries), encoding="utf-8")
    with pytest.raises(ValueError, match="SHA-256"):
        importer.import_reference(manifest, tmp_path / "result", source_root=MANIFEST.parent)
    assert not (tmp_path / "result").exists()
