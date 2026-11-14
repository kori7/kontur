"""Import organizer XLSX series and DOCX threshold notes without joining sensors."""

import argparse
from datetime import date, datetime
import hashlib
import json
from math import isfinite
from pathlib import Path
import re
import xml.etree.ElementTree as ET
from zipfile import ZipFile


ROOT = Path(__file__).resolve().parents[2]
SCHEMA_VERSION = 1
NAMESPACE = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
CHANNELS = {
    "vibration": (
        ("rpm", "Обороты (об/мин)", "rpm"),
        ("vibration", "СКЗ общее (мм/с)", "mm/s"),
        ("vibration_1x", "Ампл. 1x (мм/с)", "mm/s"),
        ("vibration_2x", "Ампл. 2x (мм/с)", "mm/s"),
        ("high_frequency_acceleration_g", "ВЧ шум (g)", "g"),
    ),
    "temperature": (
        ("rpm", "Обороты (об/мин)", "rpm"),
        ("temperature", "Темп. подшипника насоса (°C)", "degC"),
        ("winding_temperature", "Темп. обмоток ЭД (°C)", "degC"),
    ),
}
TITLES = {"vibration": "Вибрация · данные организатора", "temperature": "Температура · данные организатора"}
LIMITATIONS = [
    "Идентификатор оборудования в таблице отсутствует; принадлежность серии конкретному насосу не подтверждена.",
    "Серии вибрации и температуры независимы: совпадение даты, номера строки или RPM не подтверждает общий агрегат.",
    "Часовой пояс исходных строк неизвестен. UTC в телеметрии — техническая координата floating clock для расчёта, а не установленный часовой пояс измерений.",
    "Часовой шаг сохраняется. Такие записи не дают трёх измерений в десятиминутном окне демонстрационных трендов.",
    "Исходный диагноз — пометка организатора; он не подтверждает визуальный осмотр и не становится наблюдением системы.",
    "Недоступные датчики, визуальные признаки, наработка и подтверждённые базовые значения остаются неизвестными.",
    "Уставки DOCX хранятся отдельно как справочные данные и не заменяют демонстрационные правила или паспортные уставки.",
]


def raw_value(value):
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, float) and not isfinite(value):
        return None
    return value


def numeric_value(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return value if isfinite(value) else None


def source_date(value):
    if value is None or value == "":
        return None
    parsed = datetime.fromisoformat(str(value))
    if parsed.tzinfo is not None:
        raise ValueError("Reference series contract expects floating dates without an asserted timezone.")
    return parsed.isoformat()


def clock_metadata(records):
    dated = [record for record in records if record["source_time"] is not None]
    times = [datetime.fromisoformat(record["source_time"]) for record in dated]
    intervals = sorted({(right - left).total_seconds() for left, right in zip(times, times[1:])})
    return {
        "first_raw": dated[0]["raw_date"] if dated else None,
        "last_raw": dated[-1]["raw_date"] if dated else None,
        "first": dated[0]["source_time"] if dated else None,
        "last": dated[-1]["source_time"] if dated else None,
        "timezone": None,
        "time_basis": "floating_local_unknown_timezone",
        "sample_interval_seconds": intervals[0] if len(intervals) == 1 and intervals[0] > 0 else None,
        "observed_intervals_seconds": intervals,
        "missing_timestamp_count": len(records) - len(dated),
    }


def verified_path(entry, source_root):
    path = (source_root / entry["path"]).resolve()
    if not path.is_relative_to(source_root.resolve()):
        raise ValueError(f"Reference path escapes source root: {entry['id']}")
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    if digest != entry["sha256"]:
        raise ValueError(f"SHA-256 mismatch for {entry['id']}: organizer source does not match its manifest.")
    if path.stat().st_size != entry["bytes"]:
        raise ValueError(f"Byte count mismatch for {entry['id']}.")
    return path


def read_workbook(entry, path):
    from openpyxl import load_workbook

    category = entry["category"]
    channels = [{"key": key, "label": header, "unit": unit, "raw_header": header}
                for key, header, unit in CHANNELS[category]]
    annotation_header = "Диагноз по вибрации" if category == "vibration" else "Диагноз по температуре"
    workbook = load_workbook(path, read_only=True, data_only=True)
    result = []
    try:
        for sheet_index, sheet in enumerate(workbook.worksheets):
            rows = sheet.iter_rows(values_only=True)
            headers = next(rows, ())
            required = {"Дата и время", annotation_header} | {channel["raw_header"] for channel in channels}
            if set(headers) != required or len(headers) != len(required):
                raise ValueError(f"Unsupported reference headers in {entry['id']}, sheet {sheet.title}.")
            identifier = entry["id"] if len(workbook.worksheets) == 1 else f"{entry['id']}-sheet-{sheet_index + 1}"
            records = []
            for row_number, values in enumerate(rows, 2):
                if all(value is None for value in values):
                    continue
                raw = {header: raw_value(value) for header, value in zip(headers, values)}
                records.append({
                    "index": len(records), "row": row_number, "sheet": sheet.title,
                    "raw_date": raw["Дата и время"], "source_time": source_date(raw["Дата и время"]),
                    "values": {channel["key"]: numeric_value(raw[channel["raw_header"]]) for channel in channels},
                    "raw_values": raw, "annotation": raw[annotation_header],
                    "original_path": entry["original_path"], "path": entry["path"], "sha256": entry["sha256"],
                })
            limitations = list(LIMITATIONS)
            if category == "vibration":
                limitations.append("ВЧ шум измерен как ускорение в g; его нельзя подставлять в канал ВЧ виброскорости в мм/с. Амплитуды 1x/2x не задают осевое направление датчика.")
            else:
                limitations.append("Температура подшипника насоса и температура обмоток двигателя — отдельные каналы; температура обмоток не заменяет температуру корпуса двигателя.")
            metadata = {
                "id": identifier, "title": TITLES[category], "category": category, "source": "reference",
                "equipment_id": None, "channels": channels, "record_count": len(records),
                "sheet": sheet.title, "source_time": clock_metadata(records), "provenance": dict(entry),
                "limitations": limitations, "data_file": f"{identifier}.json",
            }
            result.append({"schema_version": SCHEMA_VERSION, "metadata": metadata, "records": records})
    finally:
        workbook.close()
    return result


def read_document(entry, path):
    with ZipFile(path) as document:
        tree = ET.fromstring(document.read("word/document.xml"))
    paragraphs = [{"paragraph": index, "text": "".join(node.text or "" for node in paragraph.findall(".//w:t", NAMESPACE))}
                  for index, paragraph in enumerate(tree.findall(".//w:p", NAMESPACE), 1)]
    return {"provenance": dict(entry), "paragraphs": paragraphs}


def document_thresholds(documents):
    thresholds = []
    baselines = []
    patterns = {
        "vibration": (
            ("vibration_1x", "mm/s", r"При росте 1x выше ([\d.]+).*?тревога при >([\d.]+)", ("warning", "alarm")),
            ("vibration_2x", "mm/s", r"При росте 2x выше ([\d.]+).*?тревога при >([\d.]+)", ("warning", "alarm")),
            ("high_frequency_acceleration_g", "g", r"При росте ВЧ шума выше ([\d.]+)", ("indication",)),
        ),
        "temperature": (
            ("temperature", "degC", r"Подшипник:.*?выше ([\d.]+).*?Выше ([\d.]+)", ("warning", "alarm")),
            ("winding_temperature", "degC", r"Электродвигатель \(ЭД\):.*?>[ ]*([\d.]+).*?>[ ]*([\d.]+)", ("warning", "alarm")),
        ),
    }
    for document in documents:
        category = document["provenance"]["category"]
        for channel, unit, pattern, levels in patterns[category]:
            matching = [(paragraph, re.search(pattern, paragraph["text"])) for paragraph in document["paragraphs"]]
            matching = [(paragraph, match) for paragraph, match in matching if match is not None]
            if len(matching) != 1:
                raise ValueError(f"Expected one threshold paragraph for {channel}; found {len(matching)}.")
            paragraph, match = matching[0]
            citation = {**document["provenance"], **paragraph}
            for level, value in zip(levels, match.groups()):
                thresholds.append({"channel": channel, "unit": unit, "level": level, "operator": ">",
                                   "value": float(value), "citation": citation})
        if category == "temperature":
            for paragraph in document["paragraphs"]:
                match = re.search(r"Базовая норма ~([\d.]+)", paragraph["text"])
                if match:
                    channel = "temperature" if "подшипника" in paragraph["text"] else "winding_temperature"
                    baselines.append({"channel": channel, "unit": "degC", "value": float(match[1]),
                                      "approximate": True, "equipment_confirmed": False,
                                      "citation": {**document["provenance"], **paragraph}})
    return {
        "schema_version": SCHEMA_VERSION, "source": "reference", "applied_to_demo_rules": False,
        "equipment_confirmed": False, "documents": documents, "thresholds": thresholds,
        "approximate_baselines": baselines,
        "limitations": ["Текст DOCX описывает учебный датасет. Эти числа не являются подтверждёнными паспортными уставками конкретного оборудования.",
                        "Общая СКЗ виброскорость и RPM не имеют числовых уставок в прочитанных DOCX; дополнительные пороги не выведены."],
    }


def write_json(path, value):
    # newline="\n" keeps the output byte-identical on Windows, where text mode would write CRLF.
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n",
                    encoding="utf-8", newline="\n")


def import_reference(manifest_path, output_dir, *, source_root=None):
    manifest_path, output_dir = Path(manifest_path), Path(output_dir)
    source_root = Path(source_root) if source_root is not None else manifest_path.parent
    manifest_bytes = manifest_path.read_bytes()
    entries = json.loads(manifest_bytes)
    selected = [entry for entry in entries if entry["category"] in CHANNELS
                and Path(entry["path"]).suffix.lower() in {".xlsx", ".docx"}]
    verified = [(entry, verified_path(entry, source_root)) for entry in selected]
    series, documents = [], []
    for entry, path in verified:
        if path.suffix.lower() == ".xlsx":
            series.extend(read_workbook(entry, path))
        else:
            documents.append(read_document(entry, path))
    if not series:
        raise ValueError("Organizer manifest contains no supported reference series.")
    thresholds = document_thresholds(documents)
    # Hash with LF line endings: git checks the same manifest out as CRLF on Windows and LF
    # elsewhere, and the recorded digest must not depend on which machine ran the import.
    manifest_digest = hashlib.sha256(manifest_bytes.replace(b"\r\n", b"\n")).hexdigest()
    catalog = {
        "schema_version": SCHEMA_VERSION, "source": "reference",
        "manifest": {"path": "manifest.json", "sha256": manifest_digest,
                     "entry_count": len(entries)},
        "inventory": entries, "imported_source_ids": [entry["id"] for entry in selected],
        "series": [item["metadata"] for item in series], "thresholds_file": "reference-thresholds.json",
    }
    output_dir.mkdir(parents=True, exist_ok=True)
    for item in series:
        write_json(output_dir / item["metadata"]["data_file"], item)
    write_json(output_dir / "reference-thresholds.json", thresholds)
    write_json(output_dir / "catalog.json", catalog)
    return {"manifest_entry_count": len(entries), "series_count": len(series),
            "record_count": sum(len(item["records"]) for item in series), "document_count": len(documents)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=ROOT / "data/reference/organizer/manifest.json")
    parser.add_argument("--output", type=Path, default=ROOT / "data/imported")
    parser.add_argument("--source-root", type=Path, help="Directory containing manifest-relative source paths.")
    args = parser.parse_args()
    print(json.dumps(import_reference(args.manifest, args.output, source_root=args.source_root), ensure_ascii=True))


if __name__ == "__main__":
    main()
