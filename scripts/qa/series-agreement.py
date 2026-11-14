"""Write docs/reports/series-vs-diagnosis.md: the organizer's stated thresholds against their «Диагноз».

    python scripts/qa/series-agreement.py

The comparison itself lives in services/api/app/series_check.py and is covered by tests; this script
only renders it, so the published numbers always come from the code that serves the application.
"""

import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "services" / "api"))

from app.series_check import LEVELS, compare  # noqa: E402

TITLES = {"vibration-001": "Вибрация", "temperature-001": "Температура"}


def section(result: dict) -> list[str]:
    exact = result["exact"] / result["records"]
    lines = [f"## {TITLES[result['series']]} · {result['series']}", "",
             f"Записей: {result['records']}. Совпадение с колонкой «Диагноз» до причины: "
             f"**{result['exact']} из {result['records']} ({exact:.1%})**. Записей с отклонением по разметке: "
             f"{result['abnormal_records']}, из них отнесено к «Норме»: **{result['abnormal_missed']}**.", "",
             "Уровень по разметке (строки) и по уставкам описания (столбцы):", "",
             "| Разметка \\ уставки | " + " | ".join(LEVELS) + " |", "|---|" + "---|" * len(LEVELS)]
    for truth in LEVELS:
        row = result["level_matrix"][truth]
        lines.append(f"| {truth} | " + " | ".join(str(row[ours]) for ours in LEVELS) + " |")
    lines += ["", "| Метка организатора | Записей | Совпало точно | Тот же уровень | Что дали уставки |", "|---|---|---|---|---|"]
    for label, item in result["labels"].items():
        ours = ", ".join(f"{name}: {count}" for name, count in item["ours"].items())
        lines.append(f"| {label} | {item['records']} | {item['exact']} | {item['same_level']} | {ours} |")
    if result["labels_without_rule"]:
        lines += ["", "В описании ряда нет правила для меток: " + ", ".join(f"«{label}»" for label in
                  result["labels_without_rule"]) + ". Порог под разметку не подбирался: расхождение — это "
                  "пробел описания, а не настройка."]
    return lines + [""]


def main() -> None:
    results = [compare("vibration-001"), compare("temperature-001")]
    lines = ["# Уставки описания рядов против колонки «Диагноз»", "",
             f"Сформировано {date.today():%d.%m.%Y} скриптом `scripts/qa/series-agreement.py` из "
             "`services/api/app/series_check.py`.", "",
             "Организатор разрешил считать колонку «Диагноз» эталоном для проверки логики (ответы §6). К каждой "
             "часовой записи применены ровно те уставки, которые написаны в описаниях рядов (`vibration-002`, "
             "`temperature-002`): «выше» читается как строго больше, при нескольких превышениях берётся более "
             "серьёзный уровень. Ничего не подбиралось под разметку.", ""]
    for result in results:
        lines += section(result)
    lines += ["## Что это значит и чего не значит", "",
              "- Ни одна запись с отклонением по разметке не отнесена к норме: для заказчика пропуск хуже ложной "
              "тревоги (ответы §5).",
              "- Это проверка согласованности логики с разметкой организатора на его же сгенерированных данных, а не "
              "точность диагностики реального насоса.",
              "- Ряды прикреплены к основному агрегату Wilo решением команды, которое разрешил заказчик; "
              "принадлежность рядов агрегату не доказана.", ""]
    target = ROOT / "docs" / "reports" / "series-vs-diagnosis.md"
    target.write_text("\n".join(lines), encoding="utf-8")
    print(f"Записано: {target.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
