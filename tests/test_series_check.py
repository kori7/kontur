"""The main pump: Wilo card, organizer series as telemetry, motor hours, and agreement with «Диагноз»."""

from fastapi.testclient import TestClient

from app.catalog import card
from app.main import create_app
from app.series_check import compare, evaluate_series, running_hours

SCHEDULE = card("wilo-il65-160")["maintenance_schedule"]


def test_stated_thresholds_reproduce_the_diagnosis_column_and_miss_no_deviation():
    vibration, temperature = compare("vibration-001"), compare("temperature-001")
    assert (vibration["exact"], vibration["records"]) == (482, 500)
    assert (temperature["exact"], temperature["records"]) == (500, 500)
    assert vibration["abnormal_missed"] == 0 and temperature["abnormal_missed"] == 0
    # The description gives no alarm rule for a bearing defect; the gap is reported, not fitted.
    assert vibration["labels_without_rule"] == ["Тревога: Дефект подшипника"]
    assert vibration["labels"]["Тревога: Дефект подшипника"]["ours"] == {"Пред: Износ/Шум": 18}


def test_motor_hours_count_only_running_records():
    hours = running_hours(["vibration-001", "temperature-001"])
    assert (hours["running_hours"], hours["recorded_hours"]) == (500, 500)
    assert "в работе" in hours["rule"]


def test_wilo_card_marks_what_the_manual_does_not_give():
    wilo = card("wilo-il65-160")
    components = {item["id"]: item for item in wilo["components"]}
    assert components["seal"]["code"] == "поз. 1.21" and components["seal"]["norm_hours"] is None
    assert components["bearing"]["norm_hours"] == 20000 and components["bearing"]["accepted_by_team"]
    assert "Принято командой" in components["pump"]["norm_source"]
    assert [item["hours"] for item in wilo["maintenance_schedule"]] == [4000, 8000, 16000]
    assert wilo["telemetry"]["series"] == ["vibration-001", "temperature-001"]
    assert "не доказана" in wilo["telemetry"]["note"]
    assert any("принято командой" in text for text in wilo["limitations"])


def test_service_milestone_raises_the_organizers_recommendation():
    window = [{"at": "t", "rpm": 2950, "vibration_1x": 1.0, "vibration_2x": 0.5,
               "high_frequency_acceleration_g": 0.2, "temperature": 50.0, "winding_temperature": 65.0}]
    quiet = evaluate_series(window, {"running_hours": 3999, "rule": "r"}, SCHEDULE)
    due = evaluate_series(window, {"running_hours": 4100, "rule": "r"}, SCHEDULE)
    assert quiet["alerts"] == [] and quiet["maintenance"]["due_in_hours"] == 1
    alert = due["alerts"][0]
    assert alert["severity"] == "info" and "ТО-1" in alert["title"]
    assert alert["recommendation"].startswith("Достигнут регламентный межремонтный интервал")


def test_alarm_and_warning_levels_follow_the_description():
    window = [{"at": "t", "vibration_1x": 4.6, "vibration_2x": 2.0, "high_frequency_acceleration_g": 0.1,
               "temperature": 50.0, "winding_temperature": 65.0}]
    result = evaluate_series(window, {"running_hours": 10, "rule": "r"}, SCHEDULE)
    levels = {alert["component_id"]: alert["severity"] for alert in result["alerts"]}
    assert levels == {"impeller": "critical", "coupling": "warning"}
    coupling = next(alert for alert in result["alerts"] if alert["component_id"] == "coupling")
    assert "лазерным методом" in coupling["recommendation"]


def test_analysis_of_the_main_pump_replays_a_chosen_record(tmp_path):
    with TestClient(create_app(tmp_path / "app.db")) as client:
        latest = client.post("/api/analyze", json={"equipment_id": "wilo-il65-160", "scenario_id": None}).json()
        early = client.post("/api/analyze", json={"equipment_id": "wilo-il65-160", "scenario_id": None,
                                                  "series_index": 0}).json()
        agreement = client.get("/api/reference/agreement").json()
    assert latest["telemetry"]["organizer_annotations"]["temperature-001"] == "Тревога: Перегрев обмоток ЭД"
    assert [alert["title"] for alert in latest["evaluation"]["alerts"]] == ["Перегрев обмоток двигателя"]
    assert early["evaluation"]["alerts"] == [] and early["telemetry"]["runtime_hours"] == 1
    assert len(latest["telemetry"]["samples"]) == 10
    assert [item["series"] for item in agreement] == ["vibration-001", "temperature-001"]
