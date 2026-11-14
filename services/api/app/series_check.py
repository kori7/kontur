"""How well the organizer's own stated logic reproduces the «Диагноз» column of their series.

The organizer allowed the «Диагноз» column as the reference for our logic (organizer answers §6). The
series descriptions (vibration-002, temperature-002) state thresholds in words; this module applies
exactly those thresholds to every hourly record and compares the result with the column, by level
(Норма / Пред / Тревога) and by cause. Nothing is tuned to the column: where the description has no
rule for a label, that label is counted as missed and the gap is reported, not filled in.
"""

import json
from collections import Counter
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parents[3] / "data/imported"

# Thresholds quoted from the descriptions; «выше» is read as strictly greater.
VIBRATION = (
    ("vibration_1x", 4.5, "Тревога: Выс. дисбаланс (РК)", 2.8, "Пред: Рост дисбаланса"),
    ("vibration_2x", 3.0, "Тревога: Расцентровка", 1.8, "Пред: Ухудшение центровки"),
    ("high_frequency_acceleration_g", None, None, 2.5, "Пред: Износ/Шум"),
)
TEMPERATURE = (
    ("temperature", 90.0, "Тревога: Перегрев подш. насоса", 75.0, "Пред: Рост темп. подш."),
    ("winding_temperature", 110.0, "Тревога: Перегрев обмоток ЭД", 90.0, "Пред: Рост темп. ЭД"),
)
RULES = {"vibration-001": VIBRATION, "temperature-001": TEMPERATURE}
SOURCES = {"vibration-001": "vibration-002", "temperature-001": "temperature-002"}
LEVELS = ("Норма", "Пред", "Тревога")


def level(label: str) -> str:
    return "Тревога" if label.startswith("Тревога") else "Пред" if label.startswith("Пред") else "Норма"


def classify(values: dict, rules) -> str:
    """The most severe verdict any channel gives; channels are checked in the description's order."""
    alarms, warnings = [], []
    for channel, alarm, alarm_label, warning, warning_label in rules:
        value = values.get(channel)
        if not isinstance(value, (int, float)):
            continue
        if alarm is not None and value > alarm:
            alarms.append(alarm_label)
        elif value > warning:
            warnings.append(warning_label)
    return (alarms or warnings or ["Норма"])[0]


def compare(series_id: str) -> dict:
    records = json.loads((DATA_DIR / f"{series_id}.json").read_text(encoding="utf-8"))["records"]
    rules = RULES[series_id]
    pairs = [(record["annotation"], classify(record["values"], rules)) for record in records]
    levels = Counter((level(truth), level(ours)) for truth, ours in pairs)
    by_label = {}
    for truth in sorted({truth for truth, _ in pairs}):
        ours = Counter(guess for label, guess in pairs if label == truth)
        total = sum(ours.values())
        by_label[truth] = {"records": total, "exact": ours.get(truth, 0),
                           "same_level": sum(count for guess, count in ours.items() if level(guess) == level(truth)),
                           "ours": dict(ours.most_common())}
    produced = {label for *_, alarm_label, _, warning_label in rules for label in (alarm_label, warning_label) if label}
    missed_level = sum(count for (truth, ours), count in levels.items()
                       if truth != "Норма" and ours == "Норма")
    abnormal = sum(count for (truth, _), count in levels.items() if truth != "Норма")
    return {"series": series_id, "description": SOURCES[series_id], "records": len(pairs),
            "exact": sum(truth == ours for truth, ours in pairs),
            "level_matrix": {truth: {ours: levels.get((truth, ours), 0) for ours in LEVELS} for truth in LEVELS},
            "abnormal_records": abnormal, "abnormal_missed": missed_level,
            "labels": by_label,
            "labels_without_rule": sorted(label for label in by_label if label != "Норма" and label not in produced)}


def records(series_id: str) -> list[dict]:
    return json.loads((DATA_DIR / f"{series_id}.json").read_text(encoding="utf-8"))["records"]


def merged(series_ids: list[str]) -> list[dict]:
    """One hourly record per source time with the values of every attached series."""
    by_time: dict[str, dict] = {}
    for series_id in series_ids:
        for record in records(series_id):
            entry = by_time.setdefault(record["source_time"], {"at": record["source_time"], "annotations": {}})
            entry.update(record["values"])
            entry["annotations"][series_id] = record["annotation"]
    return [by_time[key] for key in sorted(by_time)]


def running_hours(series_ids: list[str]) -> dict:
    """Motor hours count only while the unit runs (organizer answers §6): an hourly record with rpm > 0."""
    rows = merged(series_ids)
    running = sum(1 for row in rows if isinstance(row.get("rpm"), (int, float)) and row["rpm"] > 0)
    return {"running_hours": running, "recorded_hours": len(rows),
            "from": rows[0]["at"] if rows else None, "to": rows[-1]["at"] if rows else None,
            "rule": "Моточасы считаются только в режиме «в работе» (обороты больше нуля), ответы §6"}


# What each threshold means for the inspector: component, wording, recommendation (organizer answers §1.1).
CHECKS = (
    ("vibration_1x", "impeller", "Дисбаланс рабочего колеса", "vibration-002",
     "Рост вибрации на оборотной частоте: дисбаланс, налипание или эрозия рабочего колеса.",
     "Проверить рабочее колесо на налипание и эрозию; при подтверждении — балансировка или замена."),
    ("vibration_2x", "coupling", "Нарушение центровки", "vibration-002",
     "Рост вибрации на удвоенной частоте: перекос муфты, «мягкая лапа» или температурное расширение труб.",
     "Выполнить проверку и коррекцию соосности насоса и двигателя лазерным методом."),
    ("high_frequency_acceleration_g", "bearing", "Износ подшипника или кавитационный шум", "vibration-002",
     "Высокочастотный шум выше уставки: начало износа подшипника или кавитация.",
     "Проверить подшипниковый узел и условия всасывания; при подтверждении износа — запланировать замену подшипника."),
    ("temperature", "bearing", "Перегрев подшипника насоса", "temperature-002",
     "Температура подшипникового узла выше уставки: сухое трение или разрушение сепаратора, риск заклинивания.",
     "Проверить систему смазки, при необходимости добавить/заменить смазку. Запланировать замену подшипника."),
    ("winding_temperature", "motor", "Перегрев обмоток двигателя", "temperature-002",
     "Температура обмоток выше уставки: рост тока из-за механического сопротивления или забитое охлаждение.",
     "Проверить ток и центровку, очистить крыльчатку и рёбра охлаждения двигателя."),
)


def evaluate_series(window: list[dict], hours: dict, schedule: list[dict]) -> dict:
    """Rules for an aggregate whose telemetry is the organizer's series: their thresholds, our wording."""
    latest = window[-1] if window else {}
    thresholds = {channel: (alarm, warning) for channel, alarm, _, warning, _ in VIBRATION + TEMPERATURE}
    alerts, results = [], []
    for channel, component, title, source, hypothesis, recommendation in CHECKS:
        rule_id = f"S-{channel}"
        alarm, warning = thresholds[channel]
        value = latest.get(channel)
        if not isinstance(value, (int, float)):
            results.append({"id": rule_id, "status": "insufficient", "missing": [f"series.{channel}"], "title": title})
            continue
        severity = "critical" if alarm is not None and value > alarm else "warning" if value > warning else None
        results.append({"id": rule_id, "status": "triggered" if severity else "clear", "missing": [], "title": title,
                        "basis": f"Описание ряда организатора ({source})"})
        if severity:
            limit = alarm if severity == "critical" else warning
            alerts.append({"id": f"alert-{channel}", "rule_ids": [rule_id], "title": title, "component_id": component,
                           "severity": severity, "hypothesis": hypothesis, "recommendation": recommendation,
                           "requires_inspection": True,
                           "evidence": [{"label": title, "value": value, "threshold": f"> {limit:g}",
                                         "source": f"Ряд организатора, запись {latest.get('at')}; уставка — {source}"}]})
    running = hours["running_hours"]
    next_service = next((item for item in schedule if item["hours"] > running), None)
    due = [item for item in schedule if item["hours"] <= running]
    results.append({"id": "S-maintenance", "status": "triggered" if due else "clear", "missing": [],
                    "title": "Регламентный межремонтный интервал", "basis": "Рубежи 4000 / 8000 / 16000 ч, принято командой"})
    if due:
        alerts.append({"id": "alert-maintenance", "rule_ids": ["S-maintenance"], "component_id": "pump",
                       "title": f"Достигнут рубеж {due[-1]['name']} ({due[-1]['hours']} ч)", "severity": "info",
                       "hypothesis": "Наработка в режиме «в работе» достигла регламентного рубежа.",
                       "recommendation": "Достигнут регламентный межремонтный интервал. " + due[-1]["work"],
                       "requires_inspection": True,
                       "evidence": [{"label": "Наработка, ч", "value": running, "threshold": f"≥ {due[-1]['hours']}",
                                     "source": hours["rule"]}]})
    order = {"critical": 0, "warning": 1, "info": 2}
    alerts.sort(key=lambda alert: (order[alert["severity"]], alert["id"]))
    norm = schedule[-1]["hours"] if schedule else None
    return {"alerts": alerts, "rule_results": results, "source": "series", "rules_version": "series-1.0.0",
            "features": {key: latest.get(key) for key in ("rpm", "vibration", "vibration_1x", "vibration_2x",
                                                          "high_frequency_acceleration_g", "temperature",
                                                          "winding_temperature")},
            "maintenance": {"runtime_hours": running, "norm_hours": norm,
                            "remaining_hours": max(norm - running, 0) if norm else None,
                            "next_service_hours": next_service["hours"] if next_service else None,
                            "due_in_hours": next_service["hours"] - running if next_service else None}}
