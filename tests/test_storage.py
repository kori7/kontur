import pytest

from app.storage import Store


def test_history_survives_restart_and_preserves_evidence(tmp_path):
    path = tmp_path / "inspection.db"
    store = Store(path)
    analysis = store.save_analysis({"scenario_id": "r06", "evaluation": {"alerts": [{"id": "R06"}]}})
    event = store.add_event(analysis["id"], "pump-101", "seal", "inspection", "Проверено", "Инженер")
    reopened = Store(path)
    assert reopened.events()[0]["id"] == event["id"]
    assert reopened.events()[0]["analysis"]["evaluation"]["alerts"][0]["id"] == "R06"


def test_unknown_analysis_is_not_accepted(tmp_path):
    with pytest.raises(KeyError):
        Store(tmp_path / "inspection.db").add_event("missing", "pump-101", "seal", "inspection", "", "Инженер")


def test_new_event_does_not_overwrite_previous_event(tmp_path):
    store = Store(tmp_path / "inspection.db")
    analysis = store.save_analysis({"scenario_id": "normal"})
    store.add_event(analysis["id"], "pump-101", "seal", "inspection", "Первый осмотр", "Инженер")
    store.add_event(analysis["id"], "pump-101", "seal", "replacement", "Заменено", "Инженер")
    assert len(store.events()) == 2


def test_old_service_event_is_not_lost_after_many_inspections(tmp_path):
    store = Store(tmp_path / "inspection.db")
    analysis = store.save_analysis({"scenario_id": "r05"})
    store.add_event(analysis["id"], "pump-101", "pump", "maintenance", "ТО", "Инженер")
    for _ in range(201):
        store.add_event(analysis["id"], "pump-101", "seal", "inspection", "Осмотр", "Инженер")
    assert any(event["action"] == "maintenance" for event in store.events())


def test_history_of_different_objects_stays_separate(tmp_path):
    store = Store(tmp_path / "inspection.db")
    analysis = store.save_analysis({"scenario_id": "normal"})
    store.add_event(analysis["id"], "pump-101", "seal", "inspection", "Демообъект", "Инженер")
    store.add_event(analysis["id"], "pcp-21031004-1", "stator", "inspection", "Паспортный объект", "Инженер")
    assert len(store.events()) == 2
    demo = store.events("pump-101")
    documented = store.events("pcp-21031004-1")
    assert [event["component_id"] for event in demo] == ["seal"]
    assert [event["component_id"] for event in documented] == ["stator"]
    assert store.events("pcp-21031004-2") == []


def test_database_written_before_the_catalogue_keeps_its_events(tmp_path):
    """An older database has no equipment_id column; its events can only belong to the demo object."""
    import sqlite3

    path = tmp_path / "legacy.db"
    legacy = sqlite3.connect(path)
    with legacy:
        legacy.execute("CREATE TABLE analyses (id TEXT PRIMARY KEY, created_at TEXT, payload TEXT)")
        legacy.execute("""CREATE TABLE events (
            id TEXT PRIMARY KEY, created_at TEXT, analysis_id TEXT REFERENCES analyses(id),
            component_id TEXT, action TEXT, notes TEXT, author TEXT)""")
        legacy.execute("INSERT INTO analyses VALUES ('a1', '2026-01-01T00:00:00+00:00', '{\"scenario_id\": \"r06\"}')")
        legacy.execute("INSERT INTO events VALUES ('e1', '2026-01-01T00:00:00+00:00', 'a1', 'seal', "
                       "'inspection', 'Старая запись', 'Инженер')")
    legacy.close()

    store = Store(path)
    events = store.events()
    assert len(events) == 1
    assert events[0]["equipment_id"] == "pump-101"
    assert store.events("pump-101")[0]["notes"] == "Старая запись"


def test_image_evidence_survives_restart_and_is_deduplicated(tmp_path):
    store = Store(tmp_path / "inspection.db")
    image = "data:image/png;base64,dGVzdA=="
    image_id = store.save_image(image)
    assert store.save_image(image) == image_id
    assert Store(tmp_path / "inspection.db").image(image_id) == image
