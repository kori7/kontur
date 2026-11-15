from fastapi.testclient import TestClient

from app.main import create_app


def test_full_inspection_flow_and_validation(tmp_path):
    with TestClient(create_app(tmp_path / "app.db")) as client:
        assert client.get("/api/bootstrap").status_code == 200
        analysis = client.post("/api/analyze", json={"scenario_id": "r06"})
        assert analysis.status_code == 200, analysis.text
        run = analysis.json()
        assert any("R06" in alert["rule_ids"] for alert in run["evaluation"]["alerts"])
        event = client.post("/api/inspections", json={"analysis_id": run["id"], "component_id": "seal",
                                                    "action": "inspection", "notes": "Проверено"})
        assert event.status_code == 201
        assert len(client.get("/api/inspections").json()) == 1
        assert client.post("/api/analyze", json={"scenario_id": "nope"}).status_code == 404
        assert client.post("/api/inspections", json={"analysis_id": run["id"], "component_id": "unknown",
                                                    "action": "replacement"}).status_code == 422


def test_manual_observation_cannot_claim_model_origin(tmp_path):
    with TestClient(create_app(tmp_path / "app.db")) as client:
        run = client.post("/api/analyze", json={"scenario_id": "normal", "observations": [
            {"kind": "guard_missing", "present": True, "source": "model"}]}).json()
        assert run["observations"][-1]["source"] == "manual"
        assert any("R11" in alert["rule_ids"] for alert in run["evaluation"]["alerts"])


def test_unknown_vision_id_and_invalid_image_are_rejected(tmp_path):
    with TestClient(create_app(tmp_path / "app.db")) as client:
        assert client.post("/api/analyze", json={"scenario_id": "normal", "vision_id": "missing"}).status_code == 404
        assert client.post("/api/vision", json={"image": "http://localhost/private"}).status_code == 422


def test_bootstrap_never_returns_credentials(tmp_path, monkeypatch):
    monkeypatch.setenv("VISION_API_KEY", "secret-test-value")
    with TestClient(create_app(tmp_path / "app.db")) as client:
        response = client.get("/api/bootstrap")
        assert "secret-test-value" not in response.text
        assert response.json()["vision"]["configured"] is True


def test_missing_runtime_after_maintenance_remains_unknown(tmp_path):
    with TestClient(create_app(tmp_path / "app.db")) as client:
        run = client.post("/api/analyze", json={"scenario_id": "r05"}).json()
        client.post("/api/inspections", json={"analysis_id": run["id"], "component_id": "pump",
                                             "action": "maintenance"})
        result = client.post("/api/analyze", json={"scenario_id": "missing_data"})
        assert result.status_code == 200
        assert result.json()["telemetry"]["runtime_hours"] is None


def test_aggregate_maintenance_closes_reached_interval(tmp_path):
    with TestClient(create_app(tmp_path / "app.db")) as client:
        run = client.post("/api/analyze", json={"scenario_id": "r05"}).json()
        alert = next(item for item in run["evaluation"]["alerts"] if "R05" in item["rule_ids"])
        client.post("/api/inspections", json={"analysis_id": run["id"], "component_id": alert["component_id"],
                                             "action": "maintenance"})
        updated = client.post("/api/analyze", json={"scenario_id": "r05"}).json()
        assert not any("R05" in item["rule_ids"] for item in updated["evaluation"]["alerts"])


def test_manual_image_evidence_is_retrievable_after_recording(tmp_path):
    from test_vision import IMAGE
    with TestClient(create_app(tmp_path / "app.db")) as client:
        run = client.post("/api/analyze", json={"scenario_id": "normal", "image": IMAGE,
                                                "observations": [{"kind": "guard_missing", "present": True}]}).json()
        response = client.post("/api/inspections", json={"analysis_id": run["id"], "component_id": "guard",
                                                        "action": "defect", "notes": "Виден вал"})
        assert response.status_code == 201
        saved = client.get("/api/inspections").json()[0]["analysis"]
        image = client.get("/api/images/" + saved["image_id"])
        assert image.status_code == 200
        assert image.content.startswith(b"\x89PNG")
        assert "image/png" in image.headers["content-type"]
        assert client.get("/api/images/missing").status_code == 404


def test_a_record_states_its_result_as_a_field(tmp_path):
    with TestClient(create_app(tmp_path / "app.db")) as client:
        normal = client.post("/api/analyze", json={"scenario_id": "normal"}).json()
        warned = client.post("/api/analyze", json={"scenario_id": "r06"}).json()
        for run, extra in ((normal, {}), (warned, {}), (normal, {"result": "rejected", "source": "camera",
                                                                  "finding": "Жидкость, течь"})):
            client.post("/api/inspections", json={"analysis_id": run["id"], "component_id": "seal",
                                                  "action": "inspection", **extra})
        client.post("/api/inspections", json={"analysis_id": normal["id"], "component_id": "pump",
                                              "action": "maintenance"})
        events = client.get("/api/inspections").json()
    assert [event["result"] for event in events] == ["done", "rejected", "remark", "ok"]
    assert events[1]["source"] == "camera" and events[1]["finding"] == "Жидкость, течь"
