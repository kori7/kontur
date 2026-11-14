"""Reading current values from the plant's I/O server over Modbus TCP.

On site current values come from the I/O (integration) server over OPC UA or Modbus (organizer answers
§4); for the prototype an emulator is enough. scripts/dev/io-emulator.py plays the organizer's series
as that server, and the API reads it here exactly as it would read the real one: holding registers
over Modbus TCP, nothing from files.

Register map, holding registers from address 0, one unsigned 16-bit value each:

    0  номер записи ряда (с нуля)        5  ВЧ-шум, g × 100
    1  режим: 1 — в работе, 0 — остановлен 6  температура подшипника насоса, °C × 10
    2  обороты, об/мин                    7  температура обмоток двигателя, °C × 10
    3  вибрация СКЗ, мм/с × 100           8  амплитуда 1x, мм/с × 100
    4  амплитуда 2x, мм/с × 100
"""

import os
from datetime import datetime, timezone
from urllib.parse import urlparse

REGISTERS = (
    ("record_index", 1), ("running", 1), ("rpm", 1), ("vibration", 100), ("vibration_2x", 100),
    ("high_frequency_acceleration_g", 100), ("temperature", 10), ("winding_temperature", 10),
    ("vibration_1x", 100),
)
DEVICE_ID = 1


def encode(record: dict, index: int) -> list[int]:
    """Register values for one record; a missing value is written as 0 and the mode says whether it runs."""
    running = 1 if (record.get("rpm") or 0) > 0 else 0
    values = {"record_index": index, "running": running}
    registers = []
    for key, scale in REGISTERS:
        value = values.get(key, record.get(key))
        registers.append(max(0, min(65535, round((value or 0) * scale))))
    return registers


def decode(registers: list[int]) -> dict:
    values = {key: registers[position] / scale for position, (key, scale) in enumerate(REGISTERS)}
    values["record_index"] = int(values["record_index"])
    values["running"] = bool(values["running"])
    return values


def configured_address() -> tuple[str, int] | None:
    """KONTUR_IO=modbus://host:port, or None when the API reads the series file directly."""
    raw = os.getenv("KONTUR_IO", "").strip()
    if not raw:
        return None
    parsed = urlparse(raw)
    if parsed.scheme != "modbus" or not parsed.hostname:
        raise ValueError(f"KONTUR_IO должен иметь вид modbus://host:port, получено «{raw}»")
    return parsed.hostname, parsed.port or 502


def read_current(address: tuple[str, int], timeout: float = 1.5) -> dict:
    """One read of all registers; raises OSError with a plain reason if the server does not answer."""
    from pymodbus.client import ModbusTcpClient

    client = ModbusTcpClient(address[0], port=address[1], timeout=timeout, retries=0)
    try:
        if not client.connect():
            raise OSError(f"Сервер ввода/вывода {address[0]}:{address[1]} не отвечает")
        answer = client.read_holding_registers(0, count=len(REGISTERS), device_id=DEVICE_ID)
        if answer.isError():
            raise OSError(f"Сервер ввода/вывода вернул ошибку Modbus: {answer}")
        values = decode(list(answer.registers))
    finally:
        client.close()
    return {**values, "read_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "address": f"modbus://{address[0]}:{address[1]}"}
