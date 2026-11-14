"""Rules for the documented equipment must quote their documents and stay silent without inputs."""

from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient
import pytest

from app.catalog import card
from app.diagnostics.documented import (
    MEASUREMENTS,
    RULES,
    THRESHOLDS,
    evaluate_documented,
    measurement_vocabulary,
    rules_for,
)
from app.main import create_app

NOW = datetime(2026, 11, 14, 12, 0, tzinfo=timezone.utc)
PUMP = "pcp_pump_unit"


@pytest.fixture
def client(tmp_path):
    with TestClient(create_app(tmp_path / "inspection.db")) as client:
        yield client


def documented(equipment_type=PUMP, measurements=None, findings=None, events=None,
               object_id="pcp-21031004-1", now=NOW):
    return evaluate_documented(equipment_type, measurements=measurements, findings=findings,
                               events=events, card=card(object_id), now=now)


def statuses(result):
    return {item["id"]: item["status"] for item in result["rule_results"]}


def alerts(result):
    return {item["rule_ids"][0]: item for item in result["alerts"]}


def test_every_rule_names_its_document_and_its_component():
    for rule in RULES:
        assert rule["basis"], f"{rule['id']}: не указан источник."
        assert "manuals-" in rule["basis"] or "guides-" in rule["basis"], (
            f"{rule['id']}: источник должен ссылаться на переданный документ."
        )
        assert rule["severity"] in ("critical", "warning", "info")
        for equipment_type in rule["types"]:
            assert equipment_type in rule["components"], f"{rule['id']}: нет узла для {equipment_type}."


def test_rules_only_read_inputs_the_equipment_actually_has():
    """A rule may not require a measurement that is absent from the type's vocabulary."""
    for equipment_type, vocabulary in MEASUREMENTS.items():
        result = documented(equipment_type, object_id={
            "pcp_pump_unit": "pcp-21031004-1",
            "induction_motor": "motor-230201069",
            "gear_reducer": "gearbox-SAL023020084",
        }[equipment_type])
        for item in result["rule_results"]:
            for name in item["missing"]:
                area, _, key = name.partition(".")
                if area == "measurements":
                    assert key in vocabulary, (
                        f"{item['id']} требует измерение {key}, которого нет в словаре {equipment_type}."
                    )


def test_without_inputs_no_rule_says_normal():
    result = documented()
    assert result["alerts"] == []
    assert set(statuses(result).values()) == {"insufficient"}
    for item in result["rule_results"]:
        assert item["missing"]


def test_dry_run_setpoint_comes_from_the_protection_list():
    below = documented(measurements={"dts_temperature_c": 99.0})
    at_setpoint = documented(measurements={"dts_temperature_c": 100.0})
    critical = documented(measurements={"dts_temperature_c": 106.0})
    assert statuses(below)["P01"] == "clear"
    assert statuses(at_setpoint)["P01"] == "triggered"
    assert statuses(critical)["P01"] == "triggered"
    evidence = alerts(critical)["P01"]["evidence"]
    assert any("105" in str(item["threshold"]) for item in evidence)
    assert any("manuals-017" in item["source"] for item in evidence)
    assert THRESHOLDS["dts_setpoint_c"] == 100.0 and THRESHOLDS["dts_critical_c"] == 105.0


def test_ptc_is_reported_as_discrete_and_never_as_degrees():
    tripped = documented(measurements={"stator_ptc_tripped": True})
    assert statuses(tripped)["P02"] == "triggered"
    evidence = alerts(tripped)["P02"]["evidence"][0]
    assert evidence["value"] == "сработал"
    assert "числовой температуры нет" in evidence["threshold"]
    assert statuses(documented(measurements={"stator_ptc_tripped": False}))["P02"] == "clear"


def test_seal_overheat_needs_both_temperatures_and_names_the_pyrometer():
    partial = documented(measurements={"seal_surface_temperature_c": 75.0})
    assert statuses(partial)["P03"] == "insufficient"
    assert "measurements.product_temperature_c" in next(
        item["missing"] for item in partial["rule_results"] if item["id"] == "P03")

    within = documented(measurements={"seal_surface_temperature_c": 60.0, "product_temperature_c": 45.0})
    assert statuses(within)["P03"] == "clear", "Ровно 15 K — в пределах 20 K."
    over = documented(measurements={"seal_surface_temperature_c": 70.0, "product_temperature_c": 45.0})
    assert statuses(over)["P03"] == "triggered"
    assert any("пирометром" in item["source"] or "пирометр" in item["source"].lower()
               for item in alerts(over)["P03"]["evidence"])


def test_a_mechanical_seal_has_no_normal_leak():
    """pcp-21031004-* carry a single mechanical seal, so a visible leak is never штатной."""
    visible = documented(findings=[{"class_id": "seal_leak_excessive", "present": True}])
    assert statuses(visible)["P04"] == "triggered"
    assert "торцевого уплотнения" in alerts(visible)["P04"]["evidence"][0]["threshold"]
    clean = documented(findings=[{"class_id": "seal_leak_excessive", "present": False}])
    assert statuses(clean)["P04"] == "clear"


def test_a_gland_leak_within_the_stated_band_is_not_a_defect():
    """§8.1.4 requires 5-20 drops a minute: both too much and too little are faults."""
    gland_card = {**card("pcp-21031004-1"), "materials": {"stator": "HNBR"}}

    def run(rate):
        result = evaluate_documented(PUMP, measurements={"gland_drip_rate_per_min": rate},
                                     card=gland_card, now=NOW)
        return statuses(result)["P04"]

    assert run(12.0) == "clear", "12 капель в минуту — штатный режим, а не дефект."
    assert run(25.0) == "triggered"
    assert run(2.0) == "triggered", "Меньше нормы означает перетянутый сальник."
    assert THRESHOLDS["gland_drip_min_per_min"] == 5.0
    assert THRESHOLDS["gland_drip_max_per_min"] == 20.0


def test_calendar_rules_use_the_journal_of_this_object(client):
    fresh = [{"action": "inspection", "created_at": (NOW - timedelta(days=2)).isoformat()}]
    stale = [{"action": "inspection", "created_at": (NOW - timedelta(days=9)).isoformat()}]
    assert statuses(documented(events=fresh))["P05"] == "clear"
    assert statuses(documented(events=stale))["P05"] == "triggered"
    assert statuses(documented(events=[]))["P05"] == "insufficient"

    quarterly = [{"action": "maintenance", "created_at": (NOW - timedelta(days=100)).isoformat()}]
    assert statuses(documented(events=quarterly))["P06"] == "triggered"
    assert THRESHOLDS["weekly_interval_days"] == 7
    assert THRESHOLDS["quarterly_interval_days"] == 90


def test_wear_part_limit_stays_unknown_while_the_commissioning_date_is_missing():
    result = documented(measurements={"runtime_hours": 4000.0})
    missing = next(item["missing"] for item in result["rule_results"] if item["id"] == "P07")
    assert statuses(result)["P07"] == "insufficient"
    assert "equipment.commissioned_at" in missing, (
        "Без даты ввода в эксплуатацию предел считать не от чего."
    )

    commissioned = {**card("pcp-21031004-1"), "commissioned_at": "2026-01-10"}
    reached = evaluate_documented(PUMP, measurements={"runtime_hours": 3100.0},
                                  card=commissioned, now=NOW)
    assert statuses(reached)["P07"] == "triggered"
    within = evaluate_documented(PUMP, measurements={"runtime_hours": 900.0},
                                 card={**commissioned, "commissioned_at": "2026-09-01"}, now=NOW)
    assert statuses(within)["P07"] == "clear"


def test_guard_rule_fires_without_any_measurement():
    result = documented(findings=[{"class_id": "guard_missing", "present": True}])
    assert statuses(result)["P08"] == "triggered"
    assert alerts(result)["P08"]["severity"] == "critical"
    assert alerts(result)["P08"]["component_id"] == "guard"


def test_motor_rules_use_the_passport_vibration_limit():
    def run(value):
        return statuses(evaluate_documented("induction_motor",
                                            measurements={"vibration_velocity_mm_s": value},
                                            card=card("motor-230201069"), now=NOW))["M02"]

    assert run(2.0) == "clear"
    assert run(2.2) == "clear", "Ровно допуск паспорта нарушением не является."
    assert run(2.5) == "triggered"
    assert THRESHOLDS["motor_vibration_mm_s"] == 2.2


def test_motor_grounding_rule_is_critical_and_quotes_the_manual():
    result = evaluate_documented("induction_motor",
                                 findings=[{"class_id": "earth_conductor_missing", "present": True}],
                                 card=card("motor-230201069"), now=NOW)
    alert = alerts(result)["M03"]
    assert alert["severity"] == "critical"
    assert "заземлить" in alert["evidence"][0]["source"]


def test_gearbox_oil_interval_is_reported_as_a_gap_in_the_documents():
    result = evaluate_documented("gear_reducer", card=card("gearbox-SAL023020084"), now=NOW)
    gap = next(item for item in result["rule_results"] if item["id"] == "G03")
    assert gap["status"] == "insufficient"
    assert gap["missing"] == ["documents.gearbox_oil_change_interval"]


def test_types_without_documented_rules_report_an_empty_set():
    for equipment_type in ("valve", "pipe_section"):
        assert rules_for(equipment_type) == []
        assert measurement_vocabulary(equipment_type) == {}
    result = evaluate_documented("valve", card={}, now=NOW)
    assert result["rule_results"] == [] and result["alerts"] == []


def test_api_exposes_the_input_vocabulary_on_the_card(client):
    pump = client.get("/api/equipment/pcp-21031004-1").json()
    assert set(pump["measurements"]) == set(MEASUREMENTS[PUMP])
    assert [item["id"] for item in pump["rules"]] == [rule["id"] for rule in rules_for(PUMP)]
    assert all(item["basis"] for item in pump["rules"])
    assert {item["id"] for item in pump["defect_classes"]} >= {"guard_missing", "seal_leak_excessive"}
    valve_free = client.get("/api/equipment/pump-101").json()
    assert valve_free["rules"] == [], "Демообъект оценивается сценарным движком, а не документами."


def test_card_quotes_passport_life_limits_without_inventing_a_remainder(client):
    pump = client.get("/api/equipment/pcp-21031004-1").json()
    assert pump["resource"]["resource_to_writeoff"]["value"] == 11000
    assert pump["resource"]["service_life"]["value"] == 20
    assert pump["resource"]["wear_parts_limit"]["value_hours"] == 3000
    assert pump["commissioned_at"] is None, "Без даты ввода остаток считать не от чего."
    motor = client.get("/api/equipment/motor-230201069").json()
    assert motor["resource"] == {}, "Паспорт двигателя сроков службы не задаёт — и карточка их не выдумывает."
    assert client.get("/api/equipment/pump-101").json()["resource"] == {}


def test_api_refuses_inputs_that_the_type_does_not_have(client):
    stranger = client.post("/api/analyze", json={"equipment_id": "motor-230201069", "scenario_id": None,
                                                 "measurements": {"gland_drip_rate_per_min": 7}})
    assert stranger.status_code == 422 and "не предусмотрено" in stranger.json()["detail"]

    wrong_kind = client.post("/api/analyze", json={"equipment_id": "motor-230201069", "scenario_id": None,
                                                   "measurements": {"vibration_velocity_mm_s": True}})
    assert wrong_kind.status_code == 422

    wrong_class = client.post("/api/analyze", json={"equipment_id": "gearbox-SAL023020084",
                                                    "scenario_id": None,
                                                    "findings": [{"class_id": "guard_missing", "present": True}]})
    assert wrong_class.status_code == 422 and "неприменим" in wrong_class.json()["detail"]


def test_recorded_inspection_keeps_the_inputs_it_was_judged_on(client):
    run = client.post("/api/analyze", json={
        "equipment_id": "pcp-21031004-1", "scenario_id": None,
        "measurements": {"dts_temperature_c": 101.5},
        "findings": [{"class_id": "guard_missing", "present": False}]}).json()
    assert run["measurements"] == {"dts_temperature_c": 101.5}
    assert run["findings"] == [{"class_id": "guard_missing", "present": False}]
    assert run["evaluation"]["rules_version"].startswith("documented-")
    client.post("/api/inspections", json={"analysis_id": run["id"], "equipment_id": "pcp-21031004-1",
                                          "component_id": "stator", "action": "defect",
                                          "notes": "Сработала защита", "author": "Инженер"})
    saved = client.get("/api/inspections", params={"equipment_id": "pcp-21031004-1"}).json()[0]
    assert saved["analysis"]["measurements"] == {"dts_temperature_c": 101.5}


def test_weekly_rule_closes_after_the_engineer_records_an_inspection(client):
    first = client.post("/api/analyze", json={"equipment_id": "pcp-21031004-1", "scenario_id": None}).json()
    assert statuses(first["evaluation"])["P05"] == "insufficient"
    client.post("/api/inspections", json={"analysis_id": first["id"], "equipment_id": "pcp-21031004-1",
                                          "component_id": "pump_casing", "action": "inspection",
                                          "notes": "Герметичность проверена", "author": "Инженер"})
    second = client.post("/api/analyze", json={"equipment_id": "pcp-21031004-1", "scenario_id": None}).json()
    assert statuses(second["evaluation"])["P05"] == "clear"
