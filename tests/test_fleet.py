"""The round across objects: the object list for everyone and the master's service plan."""

from fastapi.testclient import TestClient

from app.main import create_app


def test_plan_lists_objects_soonest_service_first_without_storing_analyses(tmp_path):
    with TestClient(create_app(tmp_path / "app.db")) as client:
        plan = client.get("/api/maintenance/plan").json()
        stored = client.get("/api/inspections").json()
    ids = [row["equipment_id"] for row in plan]
    assert "tag-860-P-0201" not in ids, "Позиция по проекту не машина и в план не попадает"
    wilo = next(row for row in plan if row["equipment_id"] == "wilo-il65-160")
    assert wilo["runtime_hours"] > 0 and wilo["next_service_hours"] is not None
    pcp = next(row for row in plan if row["equipment_id"] == "pcp-21031004-1")
    assert pcp["runtime_hours"] is None, "Без даты ввода наработка неизвестна, а не ноль"
    known = [row["due_in_hours"] for row in plan if row["due_in_hours"] is not None]
    assert known == sorted(known)
    assert plan.index(pcp) > max(plan.index(row) for row in plan if row["due_in_hours"] is not None)
    assert stored == []


def test_plan_is_closed_to_the_engineer(tmp_path, monkeypatch):
    monkeypatch.setenv("KONTUR_AUTH", "on")
    with TestClient(create_app(tmp_path / "app.db")) as client:
        client.post("/api/auth/setup", json={"email": "admin@example.test", "name": "Админ", "password": "admin-pass-1"})
        client.post("/api/users", json={"email": "eng@example.test", "name": "Инженер", "role": "engineer",
                                        "password": "engineer-pass-1"})
        client.post("/api/auth/logout")
        client.post("/api/auth/login", json={"email": "eng@example.test", "password": "engineer-pass-1"})
        assert client.get("/api/maintenance/plan").status_code == 403


def test_object_list_puts_attention_first_and_follows_the_journal(tmp_path):
    with TestClient(create_app(tmp_path / "app.db")) as client:
        before = client.get("/api/objects").json()
        run = client.post("/api/analyze", json={"scenario_id": "r06"}).json()
        client.post("/api/inspections", json={"analysis_id": run["id"], "component_id": "seal", "action": "defect"})
        after = client.get("/api/objects").json()
    order = {"critical": 0, "warning": 1, "unknown": 2, "normal": 3}
    assert [order[row["status"]] for row in after] == sorted(order[row["status"]] for row in after)
    demo_before = next(row for row in before if row["equipment_id"] == "pump-101")
    demo_after = next(row for row in after if row["equipment_id"] == "pump-101")
    assert demo_before["status"] == "normal" and demo_before["last_event_at"] is None
    assert demo_after["status"] in ("warning", "critical"), "Статус берётся из последней записи журнала"
    pcp = next(row for row in after if row["equipment_id"] == "pcp-21031004-1")
    assert pcp["status"] == "unknown", "Без замеров паспортный объект не «в норме»"


def test_engineer_opens_a_passport_document_but_not_the_whole_library(tmp_path, monkeypatch):
    monkeypatch.setenv("KONTUR_AUTH", "on")
    with TestClient(create_app(tmp_path / "app.db")) as client:
        client.post("/api/auth/setup", json={"email": "admin@example.test", "name": "Админ", "password": "admin-pass-1"})
        client.post("/api/users", json={"email": "eng@example.test", "name": "Инженер", "role": "engineer",
                                        "password": "engineer-pass-1"})
        client.post("/api/auth/logout")
        client.post("/api/auth/login", json={"email": "eng@example.test", "password": "engineer-pass-1"})
        card = client.get("/api/equipment/pcp-21031004-1").json()
        assert card["document_links"] and all(link["title"] for link in card["document_links"])
        assert client.get("/api/library").status_code == 403
        assert client.get("/api/objects").status_code == 200
        answer = client.get(f"/api/library/{card['document_links'][0]['id']}/file")
        assert answer.status_code in (200, 404), "Доступ есть; 404 — только если файла организатора нет на диске"
