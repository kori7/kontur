"""The catalogue must keep objects apart and must not let pump rules speak for other equipment."""

from fastapi.testclient import TestClient
import pytest

from app.catalog import card, component_ids, equipment_type_of, list_catalog
from app.main import create_app


@pytest.fixture
def client(tmp_path):
    with TestClient(create_app(tmp_path / "inspection.db")) as client:
        yield client


def test_catalog_lists_every_registry_object_and_the_demo_object(client):
    catalog = client.get("/api/catalog").json()
    identifiers = {item["id"] for item in catalog["objects"]}
    assert {"pcp-21031004-1", "pcp-21031004-4", "motor-230201069", "gearbox-SAL023020084"} <= identifiers
    assert "pump-101" in identifiers
    assert catalog["default_object_id"] == "pump-101"


def test_only_the_demo_object_offers_scenarios(client):
    for item in client.get("/api/catalog").json()["objects"]:
        assert item["scenarios_available"] is (item["id"] == "pump-101")


def test_tag_positions_are_reference_entries_not_inspection_targets(client):
    catalog = {item["id"]: item for item in client.get("/api/catalog").json()["objects"]}
    assert catalog["tag-860-P-0201"]["inspectable"] is False
    refused = client.post("/api/analyze", json={"equipment_id": "tag-860-P-0201", "scenario_id": None})
    assert refused.status_code == 422
    assert "серийным номером" in refused.json()["detail"]


def test_documented_card_reports_the_pump_speed_from_its_passport(client):
    documented = client.get("/api/equipment/pcp-21031004-1").json()
    assert documented["model"] == "AMS PCP60S12/3 01 Ex B1 HNBR DTS"
    assert documented["speed_rpm"] == 260, "Обороты насоса берутся из паспорта, а не из демонстрационной карточки."
    assert documented["equipment_type"] == "pcp_pump_unit"


def test_documented_card_keeps_an_absent_commissioning_date_unknown(client):
    documented = client.get("/api/equipment/pcp-21031004-1").json()
    assert documented["commissioned_at"] is None
    assert documented["commissioned_at_status"] == "unknown"
    assert any("Дата ввода в эксплуатацию" in text for text in documented["limitations"])


def test_card_states_which_component_norms_the_passport_does_not_give(client):
    components = {item["id"]: item for item in client.get("/api/equipment/pcp-21031004-1").json()["components"]}
    assert components["stator"]["norm_hours"] == 3000, "Статор — быстроизнашиваемая деталь с нормативом 3000 ч."
    assert components["adapter"]["norm_hours"] is None
    assert "не задаёт норматив этого узла" in components["adapter"]["norm_source"]


def test_card_marks_components_that_are_invisible_from_outside(client):
    components = {item["id"]: item for item in client.get("/api/equipment/pcp-21031004-1").json()["components"]}
    assert components["stator"]["externally_visible"] is True
    assert components["rotor"]["externally_visible"] is False
    assert components["rotor"]["ar_anchor"] is False


def test_unconfirmed_links_reach_the_card_as_a_limitation(client):
    documented = client.get("/api/equipment/pcp-21031004-1").json()
    assert any("Связи не подтверждены документами" in text for text in documented["limitations"])


def test_undocumented_type_says_so_on_the_card():
    valve_type = card("pump-101")
    assert valve_type["documented"] is False
    assert "демонстрац" in valve_type["notice"].lower()


def test_unknown_object_is_not_invented(client):
    assert client.get("/api/equipment/nope").status_code == 404
    assert client.post("/api/analyze", json={"equipment_id": "nope"}).status_code == 404
    with pytest.raises(KeyError):
        component_ids("nope")


def test_demo_scenarios_cannot_be_replayed_against_documented_equipment(client):
    refused = client.post("/api/analyze", json={"equipment_id": "pcp-21031004-1", "scenario_id": "r06"})
    assert refused.status_code == 422
    assert "pump-101" in refused.json()["detail"]


def test_inspection_without_telemetry_runs_but_claims_nothing(client):
    run = client.post("/api/analyze", json={"equipment_id": "pcp-21031004-1", "scenario_id": None})
    assert run.status_code == 200
    payload = run.json()
    assert payload["equipment_id"] == "pcp-21031004-1"
    assert payload["evaluation"]["alerts"] == []
    statuses = {item["id"]: item["status"] for item in payload["evaluation"]["rule_results"]}
    assert set(statuses.values()) == {"not_applicable"}, "Насосные правила к этому типу применяться не должны."


def test_not_applicable_is_distinct_from_clear_and_carries_a_reason(client):
    documented = client.post("/api/analyze", json={"equipment_id": "pcp-21031004-1",
                                                   "scenario_id": None}).json()
    demo = client.post("/api/analyze", json={"equipment_id": "pump-101", "scenario_id": "normal"}).json()
    documented_rules = {item["id"]: item for item in documented["evaluation"]["rule_results"]}
    demo_rules = {item["id"]: item for item in demo["evaluation"]["rule_results"]}
    assert documented_rules["R02"]["status"] == "not_applicable"
    assert "объёмному насосу" in documented_rules["R02"]["reason"]
    assert demo_rules["R02"]["status"] == "clear", "На демообъекте правило по-прежнему оценивается."
    assert "reason" not in demo_rules["R02"]


def test_pump_observation_vocabulary_is_refused_for_another_type(client):
    refused = client.post("/api/analyze", json={
        "equipment_id": "motor-230201069", "scenario_id": None,
        "observations": [{"kind": "liquid_leak", "present": True}]})
    assert refused.status_code == 422
    assert "seal" in refused.json()["detail"]


def test_history_is_recorded_and_read_back_per_object(client):
    demo = client.post("/api/analyze", json={"equipment_id": "pump-101", "scenario_id": "r06"}).json()
    documented = client.post("/api/analyze", json={"equipment_id": "pcp-21031004-1", "scenario_id": None}).json()
    assert client.post("/api/inspections", json={
        "analysis_id": demo["id"], "equipment_id": "pump-101", "component_id": "seal",
        "action": "inspection", "notes": "Демообъект", "author": "Инженер"}).status_code == 201
    assert client.post("/api/inspections", json={
        "analysis_id": documented["id"], "equipment_id": "pcp-21031004-1", "component_id": "joint_boot",
        "action": "defect", "notes": "Паспортный объект", "author": "Инженер"}).status_code == 201

    assert len(client.get("/api/inspections").json()) == 2
    demo_history = client.get("/api/inspections", params={"equipment_id": "pump-101"}).json()
    documented_history = client.get("/api/inspections", params={"equipment_id": "pcp-21031004-1"}).json()
    assert [item["component_id"] for item in demo_history] == ["seal"]
    assert [item["component_id"] for item in documented_history] == ["joint_boot"]
    assert client.get("/api/inspections", params={"equipment_id": "pcp-21031004-2"}).json() == []


def test_event_cannot_attach_to_an_inspection_of_another_object(client):
    demo = client.post("/api/analyze", json={"equipment_id": "pump-101", "scenario_id": "normal"}).json()
    refused = client.post("/api/inspections", json={
        "analysis_id": demo["id"], "equipment_id": "pcp-21031004-1", "component_id": "stator",
        "action": "inspection", "notes": "", "author": "Инженер"})
    assert refused.status_code == 422
    assert "другому объекту" in refused.json()["detail"]


def test_event_component_must_belong_to_the_selected_object(client):
    documented = client.post("/api/analyze", json={"equipment_id": "pcp-21031004-1", "scenario_id": None}).json()
    refused = client.post("/api/inspections", json={
        "analysis_id": documented["id"], "equipment_id": "pcp-21031004-1", "component_id": "impeller",
        "action": "inspection", "notes": "", "author": "Инженер"})
    assert refused.status_code == 422, "У одновинтового агрегата рабочего колеса нет."


def test_component_history_counts_only_its_own_object(client):
    documented = client.post("/api/analyze", json={"equipment_id": "pcp-21031004-1", "scenario_id": None}).json()
    client.post("/api/inspections", json={
        "analysis_id": documented["id"], "equipment_id": "pcp-21031004-1", "component_id": "stator",
        "action": "replacement", "notes": "Замена статора", "author": "Инженер"})
    first = {item["id"]: item for item in client.get("/api/equipment/pcp-21031004-1").json()["components"]}
    second = {item["id"]: item for item in client.get("/api/equipment/pcp-21031004-2").json()["components"]}
    assert first["stator"]["events_count"] == 1
    assert first["stator"]["last_replacement"] is not None
    assert second["stator"]["events_count"] == 0, "История однотипных объектов не должна смешиваться."
    assert second["stator"]["last_replacement"] is None


def test_catalog_helpers_agree_with_the_registry():
    assert equipment_type_of("pump-101") == "centrifugal_pump_unit"
    assert equipment_type_of("motor-230201070") == "induction_motor"
    assert "terminal_box" in component_ids("motor-230201069")
    assert "impeller" not in component_ids("pcp-21031004-1")
    types = {item["id"] for item in list_catalog()["types"]}
    assert "pcp_pump_unit" in types and "valve" in types
