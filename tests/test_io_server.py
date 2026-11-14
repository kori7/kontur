"""I/O server over Modbus TCP: register map round trip and the API reading «now» from it."""

import pytest
from fastapi.testclient import TestClient

from app.io_server import REGISTERS, configured_address, decode, encode
from app.main import create_app

RECORD = {"rpm": 2939, "vibration": 1.04, "vibration_1x": 0.8, "vibration_2x": 0.42,
          "high_frequency_acceleration_g": 0.03, "temperature": 48.0, "winding_temperature": 117.7}


def test_registers_round_trip_with_their_scale():
    registers = encode(RECORD, 496)
    assert len(registers) == len(REGISTERS) and all(0 <= value <= 65535 for value in registers)
    values = decode(registers)
    assert values["record_index"] == 496 and values["running"] is True
    for key, value in RECORD.items():
        assert values[key] == pytest.approx(value, abs=0.01)


def test_a_stopped_unit_reads_as_not_running():
    assert decode(encode({**RECORD, "rpm": 0}, 3))["running"] is False


def test_address_comes_from_the_environment(monkeypatch):
    monkeypatch.delenv("KONTUR_IO", raising=False)
    assert configured_address() is None
    monkeypatch.setenv("KONTUR_IO", "modbus://10.0.0.5:5020")
    assert configured_address() == ("10.0.0.5", 5020)
    monkeypatch.setenv("KONTUR_IO", "http://x")
    with pytest.raises(ValueError):
        configured_address()


def test_analysis_takes_now_from_the_io_server_and_says_so(tmp_path, monkeypatch):
    from app import main

    monkeypatch.setenv("KONTUR_IO", "modbus://127.0.0.1:5020")
    monkeypatch.setattr(main, "read_io", lambda address: {**RECORD, "record_index": 496, "running": True,
                                                          "read_at": "2026-11-14T13:46:15+00:00",
                                                          "address": "modbus://127.0.0.1:5020"})
    with TestClient(create_app(tmp_path / "app.db")) as client:
        run = client.post("/api/analyze", json={"equipment_id": "wilo-il65-160", "scenario_id": None}).json()
    telemetry = run["telemetry"]
    assert telemetry["source"] == "modbus" and telemetry["record_index"] == 496
    assert telemetry["io"]["address"] == "modbus://127.0.0.1:5020"
    assert telemetry["samples"][-1]["winding_temperature"] == 117.7
    assert run["scenario_title"] == "Сервер ввода/вывода · запись 497 из 500"
    assert [alert["title"] for alert in run["evaluation"]["alerts"]] == ["Перегрев обмоток двигателя"]


def test_unreachable_io_server_is_reported_not_hidden(tmp_path, monkeypatch):
    from app import main

    def down(address):
        raise OSError("Сервер ввода/вывода 127.0.0.1:5020 не отвечает")

    monkeypatch.setenv("KONTUR_IO", "modbus://127.0.0.1:5020")
    monkeypatch.setattr(main, "read_io", down)
    with TestClient(create_app(tmp_path / "app.db")) as client:
        run = client.post("/api/analyze", json={"equipment_id": "wilo-il65-160", "scenario_id": None}).json()
    assert run["telemetry"]["source"] == "series"
    assert "не отвечает" in run["telemetry"]["io_error"]
