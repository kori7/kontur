"""Read independent organizer series with explicit floating-clock replay semantics."""

from copy import deepcopy
from datetime import datetime, timezone
import json
from pathlib import Path


DATA_DIR = Path(__file__).resolve().parents[3] / "data/imported"
TECHNICAL_TIME_BASIS = "floating_clock_technical_utc_coordinate"


def list_reference_series() -> list[dict]:
    """Return fresh metadata, observed channels, source clocks and limitations."""
    catalog = json.loads((DATA_DIR / "catalog.json").read_text(encoding="utf-8"))
    return catalog["series"]


def _technical_coordinate(source_time):
    if source_time is None:
        return None
    floating = datetime.fromisoformat(source_time)
    if floating.tzinfo is not None:
        raise ValueError("A floating source clock must not assert a measurement timezone.")
    return floating.replace(tzinfo=timezone.utc).isoformat()


def get_reference_window(identifier: str, end_index: int | None = None, limit: int = 10) -> dict:
    """Select consecutive source records; ``end_index`` is inclusive and zero based.

    Aware timestamps are technical coordinates retaining the original hourly gaps.
    Callers can use ``evaluation_time`` as the diagnostic clock only while retaining
    ``timestamp_is_technical`` and the original unzoned ``source_time`` metadata.
    """
    metadata = next((item for item in list_reference_series() if item["id"] == identifier), None)
    if metadata is None:
        raise KeyError(identifier)
    if isinstance(limit, bool) or not isinstance(limit, int) or limit <= 0:
        raise ValueError("limit must be a positive integer.")
    if end_index is None:
        end_index = metadata["record_count"] - 1
    if isinstance(end_index, bool) or not isinstance(end_index, int) or not 0 <= end_index < metadata["record_count"]:
        raise ValueError("end_index must identify an existing source record.")
    series = json.loads((DATA_DIR / metadata["data_file"]).read_text(encoding="utf-8"))
    records = series["records"][max(0, end_index - limit + 1):end_index + 1]
    samples = [{"at": _technical_coordinate(record["source_time"]), **deepcopy(record["values"])}
               for record in records]
    evaluation_time = samples[-1]["at"]
    source_time = {
        **metadata["source_time"],
        "first_raw": records[0]["raw_date"], "last_raw": records[-1]["raw_date"],
        "first": records[0]["source_time"], "last": records[-1]["source_time"],
        "missing_timestamp_count": sum(record["source_time"] is None for record in records),
    }
    return {
        "id": metadata["id"], "title": metadata["title"], "source": "reference",
        "category": metadata["category"], "equipment_id": None, "channels": metadata["channels"],
        "provenance": metadata["provenance"], "source_time": source_time, "records": records,
        "start_index": records[0]["index"], "end_index": end_index, "evaluation_time": evaluation_time,
        "telemetry": {"timestamp": evaluation_time, "source": "reference", "samples": samples,
                      "time_basis": TECHNICAL_TIME_BASIS, "timestamp_is_technical": True},
        "observations": [], "limitations": metadata["limitations"],
    }
