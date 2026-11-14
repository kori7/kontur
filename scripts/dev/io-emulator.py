"""Emulator of the plant's I/O server: serves the organizer's series over Modbus TCP.

    python scripts/dev/io-emulator.py [--port 5020] [--seconds-per-record 2] [--start 0]

The organizer allowed an emulator instead of a real server (organizer answers §4). Every
--seconds-per-record seconds the "current" record moves one hour forward through the series attached
to the main pump, looping at the end; each read returns that record in the register map documented
in services/api/app/io_server.py. Start the API with KONTUR_IO=modbus://127.0.0.1:5020 to read it.
"""

import argparse
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "services" / "api"))

from app.io_server import DEVICE_ID, REGISTERS, encode  # noqa: E402
from app.registry import registry_object  # noqa: E402
from app.series_check import merged  # noqa: E402


def build_server_context(rows: list[dict], seconds_per_record: float, start: int):
    from pymodbus.simulator import DataType, SimData, SimDevice

    started = time.monotonic()

    async def current(function_code, start_address, address, count, current_registers, set_values):
        index = (start + int((time.monotonic() - started) / seconds_per_record)) % len(rows)
        values = encode(rows[index], index)
        for position in range(len(current_registers)):
            register = start_address + position
            if register < len(values):
                current_registers[position] = values[register]
        return None

    return SimDevice(id=DEVICE_ID, simdata=[SimData(address=0, count=len(REGISTERS), values=0,
                                                    datatype=DataType.UINT16)], action=current)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=5020)
    parser.add_argument("--seconds-per-record", type=float, default=2.0)
    parser.add_argument("--start", type=int, default=0, help="с какой записи начать, с нуля")
    parser.add_argument("--equipment", default="wilo-il65-160")
    args = parser.parse_args()
    series = registry_object(args.equipment)["telemetry_series"]
    rows = merged(series)
    from pymodbus.server import StartTcpServer

    print(f"Сервер ввода/вывода (эмулятор): modbus://{args.host}:{args.port}, ряды {', '.join(series)}, "
          f"{len(rows)} записей, одна запись в {args.seconds_per_record:g} с. Остановка: Ctrl+C", flush=True)
    StartTcpServer(build_server_context(rows, args.seconds_per_record, args.start), address=(args.host, args.port))


if __name__ == "__main__":
    main()
