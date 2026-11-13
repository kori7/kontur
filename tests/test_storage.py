import pytest

from app.storage import Store


def test_history_survives_restart_and_preserves_evidence(tmp_path):
    path = tmp_path / "inspection.db"
    store = Store(path)
    analysis = store.save_analysis({"scenario_id": "r06", "evaluation": {"alerts": [{"id": "R06"}]}})
    event = store.add_event(analysis["id"], "seal", "inspection", "Проверено", "Инженер")
    reopened = Store(path)
    assert reopened.events()[0]["id"] == event["id"]
    assert reopened.events()[0]["analysis"]["evaluation"]["alerts"][0]["id"] == "R06"


def test_unknown_analysis_is_not_accepted(tmp_path):
    with pytest.raises(KeyError):
        Store(tmp_path / "inspection.db").add_event("missing", "seal", "inspection", "", "Инженер")


def test_new_event_does_not_overwrite_previous_event(tmp_path):
    store = Store(tmp_path / "inspection.db")
    analysis = store.save_analysis({"scenario_id": "normal"})
    store.add_event(analysis["id"], "seal", "inspection", "Первый осмотр", "Инженер")
    store.add_event(analysis["id"], "seal", "replacement", "Заменено", "Инженер")
    assert len(store.events()) == 2


def test_old_service_event_is_not_lost_after_many_inspections(tmp_path):
    store = Store(tmp_path / "inspection.db")
    analysis = store.save_analysis({"scenario_id": "r05"})
    store.add_event(analysis["id"], "pump", "maintenance", "ТО", "Инженер")
    for _ in range(201):
        store.add_event(analysis["id"], "seal", "inspection", "Осмотр", "Инженер")
    assert any(event["action"] == "maintenance" for event in store.events())


def test_image_evidence_survives_restart_and_is_deduplicated(tmp_path):
    store = Store(tmp_path / "inspection.db")
    image = "data:image/png;base64,dGVzdA=="
    image_id = store.save_image(image)
    assert store.save_image(image) == image_id
    assert Store(tmp_path / "inspection.db").image(image_id) == image
