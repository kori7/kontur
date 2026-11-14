"""Inspection reports: one data set, two forms — an Excel workbook and a printable page for PDF.

The customer asked for export to PDF and Excel (organizer answers §7). The PDF is the browser's own
«Сохранить как PDF» of a page laid out for A4: no PDF library and no fonts to ship, and the Cyrillic
text, frames and evidence images print exactly as shown.

A report states where each value comes from and repeats the limits the screen states: rules give
hypotheses for an engineer, the absence of warnings does not prove the equipment is sound.
"""

from datetime import datetime, timezone
from html import escape
from io import BytesIO

ACTIONS = {"inspection": "Проверка", "defect": "Замечание", "maintenance": "Обслуживание", "replacement": "Замена"}
SEVERITY = {"critical": "Критично", "warning": "Внимание", "info": "Информация"}
STATUS = {"triggered": "Сработало", "clear": "Не сработало", "insufficient": "Недостаточно данных",
          "not_applicable": "Не применяется"}
LIMITS = ("Правила формируют гипотезы для инженера и не являются диагнозом. Отсутствие предупреждений "
          "не подтверждает исправность оборудования. Нормы требуют сверки с документацией изготовителя.")


def _local(stamp: str | None) -> str:
    if not stamp:
        return "—"
    try:
        moment = datetime.fromisoformat(stamp.replace("Z", "+00:00"))
    except ValueError:
        return stamp
    return moment.astimezone().strftime("%d.%m.%Y %H:%M")


def build(card: dict, events: list[dict], analysis: dict | None, author: str) -> dict:
    """Everything a report shows, in display form. ``analysis`` is the inspection the report is about."""
    components = {item["id"]: item for item in card["components"]}
    evaluation = (analysis or {}).get("evaluation") or {}
    return {
        "generated_at": _local(datetime.now(timezone.utc).isoformat()),
        "generated_by": author,
        "equipment": [("Объект", card["name"]), ("Тип", card.get("type_name") or "—"),
                      ("Модель", card.get("model") or "—"), ("Заводской номер", card.get("serial") or "—"),
                      ("Идентификатор", card["id"]), ("Место", card.get("location") or "—"),
                      ("Источник данных", card.get("source") or "—")],
        "inspection": None if analysis is None else {
            "at": _local(analysis.get("created_at")), "scenario": analysis.get("scenario_title") or "—",
            "image_id": analysis.get("image_id"),
            "alerts": [{"severity": SEVERITY.get(alert["severity"], alert["severity"]), "level": alert["severity"],
                        "rules": ", ".join(alert["rule_ids"]), "title": alert["title"],
                        "component": components.get(alert["component_id"], {}).get("name", alert["component_id"]),
                        "hypothesis": alert["hypothesis"], "recommendation": alert["recommendation"]}
                       for alert in evaluation.get("alerts", [])],
            "rules": [{"id": item["id"], "status": STATUS.get(item["status"], item["status"]),
                       "missing": ", ".join(item.get("missing") or []), "reason": item.get("reason") or ""}
                      for item in evaluation.get("rule_results", [])],
        },
        "components": [{"code": item.get("code") or "", "name": item["name"],
                        "norm": f"{item['norm_hours']:g} ч" if item.get("norm_hours") else "не задан",
                        "installed": item.get("installed_at") or "—",
                        "replaced": _local((item.get("last_replacement") or {}).get("created_at")),
                        "source": item.get("norm_source") or ""} for item in card["components"]],
        "journal": [{"at": _local(event["created_at"]), "action": ACTIONS.get(event["action"], event["action"]),
                     "component": components.get(event["component_id"], {}).get("name", event["component_id"]),
                     "author": event["author"], "notes": event["notes"] or "",
                     "alerts": len(event["analysis"].get("evaluation", {}).get("alerts", [])),
                     "image_id": event["analysis"].get("image_id")} for event in events],
    }


def to_xlsx(data: dict) -> bytes:
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Font, PatternFill

    book = Workbook()
    head = Font(bold=True, color="FFFFFF")
    fill = PatternFill("solid", fgColor="135AA6")

    def table(sheet, header, rows, widths):
        sheet.append(header)
        for cell in sheet[sheet.max_row]:
            cell.font, cell.fill = head, fill
        for row in rows:
            sheet.append(row)
        for index, width in enumerate(widths):
            sheet.column_dimensions[chr(65 + index)].width = width
        for row in sheet.iter_rows(min_row=2):
            for cell in row:
                cell.alignment = Alignment(wrap_text=True, vertical="top")
        sheet.freeze_panes = sheet.cell(row=sheet.max_row - len(rows) + 1, column=1)

    summary = book.active
    summary.title = "Объект"
    summary.append(["Отчёт об осмотре · КОНТУР"])
    summary["A1"].font = Font(bold=True, size=14)
    summary.append([f"Сформирован {data['generated_at']}, {data['generated_by']}"])
    summary.append([])
    for label, value in data["equipment"]:
        summary.append([label, value])
    inspection = data["inspection"]
    if inspection:
        summary.append([])
        summary.append(["Осмотр", inspection["at"]])
        summary.append(["Сценарий данных", inspection["scenario"]])
        summary.append(["Предупреждений", len(inspection["alerts"])])
    summary.append([])
    summary.append([LIMITS])
    summary.column_dimensions["A"].width = 22
    summary.column_dimensions["B"].width = 70

    if inspection:
        table(book.create_sheet("Предупреждения"), ["Уровень", "Правила", "Предупреждение", "Узел", "Гипотеза",
                                                     "Рекомендация"],
              [[item["severity"], item["rules"], item["title"], item["component"], item["hypothesis"],
                item["recommendation"]] for item in inspection["alerts"]], [12, 10, 34, 22, 50, 50])
        table(book.create_sheet("Правила"), ["Правило", "Результат", "Чего не хватает", "Почему не применяется"],
              [[item["id"], item["status"], item["missing"], item["reason"]] for item in inspection["rules"]],
              [10, 22, 50, 50])
    table(book.create_sheet("Журнал"), ["Дата", "Действие", "Узел", "Автор", "Комментарий", "Предупреждений",
                                         "Кадр"],
          [[item["at"], item["action"], item["component"], item["author"], item["notes"], item["alerts"],
            "есть" if item["image_id"] else ""] for item in data["journal"]], [17, 15, 24, 22, 60, 15, 8])
    table(book.create_sheet("Узлы"), ["Код", "Узел", "Норматив", "Установлен", "Последняя замена", "Источник норматива"],
          [[item["code"], item["name"], item["norm"], item["installed"], item["replaced"], item["source"]]
           for item in data["components"]], [12, 30, 12, 14, 18, 60])
    buffer = BytesIO()
    book.save(buffer)
    return buffer.getvalue()


def to_html(data: dict) -> str:
    """A self-contained A4 page; the browser prints it or saves it as PDF."""
    e = escape
    inspection = data["inspection"]
    rows = "".join(f"<tr><th>{e(label)}</th><td>{e(str(value))}</td></tr>" for label, value in data["equipment"])
    alerts = ""
    if inspection:
        alerts = "".join(
            f"<article class='alert {e(item['level'])}'><h3>{e(item['severity'])} · {e(item['title'])}</h3>"
            f"<p><b>Узел:</b> {e(item['component'])} · <b>Правила:</b> {e(item['rules'])}</p>"
            f"<p>{e(item['hypothesis'])}</p><p><b>Рекомендация:</b> {e(item['recommendation'])}</p></article>"
            for item in inspection["alerts"]) or "<p>Правила не выдали предупреждений на доступных данных.</p>"
        frame = (f"<figure><img src='/api/images/{e(inspection['image_id'])}' alt='Кадр осмотра'>"
                 "<figcaption>Кадр, сохранённый с осмотром</figcaption></figure>") if inspection["image_id"] else ""
        rules = "".join(f"<tr><td>{e(item['id'])}</td><td>{e(item['status'])}</td>"
                        f"<td>{e(item['missing'] or item['reason'])}</td></tr>" for item in inspection["rules"])
        alerts = (f"<section><h2>Осмотр {e(inspection['at'])}</h2><p class='muted'>Данные: {e(inspection['scenario'])}</p>"
                  f"{alerts}{frame}<h3>Правила</h3><table class='grid'><tr><th>Правило</th><th>Результат</th>"
                  f"<th>Чего не хватает / почему не применяется</th></tr>{rules}</table></section>")
    journal = "".join(
        f"<tr><td>{e(item['at'])}</td><td>{e(item['action'])}</td><td>{e(item['component'])}</td>"
        f"<td>{e(item['author'])}</td><td>{e(item['notes'])}</td></tr>" for item in data["journal"]
    ) or "<tr><td colspan='5'>Записей нет</td></tr>"
    components = "".join(
        f"<tr><td>{e(item['code'])}</td><td>{e(item['name'])}</td><td>{e(item['norm'])}</td>"
        f"<td>{e(item['installed'])}</td><td>{e(item['replaced'])}</td></tr>" for item in data["components"])
    return f"""<!doctype html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Отчёт об осмотре · {e(data['equipment'][0][1])}</title>
<style>
@font-face{{font-family:Geologica;src:url('/fonts/Geologica-Regular.woff2') format('woff2');font-weight:400}}
@font-face{{font-family:Geologica;src:url('/fonts/Geologica-Medium.woff2') format('woff2');font-weight:500}}
@page{{size:A4;margin:14mm}}
body{{font-family:Geologica,Arial,sans-serif;color:#313132;margin:0;background:#F4F5F8;line-height:1.45;font-size:14px}}
.page{{max-width:820px;margin:0 auto;background:#fff;padding:28px 32px}}
.bar{{max-width:820px;margin:0 auto;padding:16px 0;display:flex;gap:12px;align-items:center}}
.bar button{{border:0;border-radius:16px;background:#135AA6;color:#fff;font:500 16px Geologica,Arial;padding:12px 20px;min-height:48px;cursor:pointer}}
h1{{font-size:24px;font-weight:500;color:#063E61;margin:0 0 4px}}h2{{font-size:18px;font-weight:500;color:#063E61;margin:24px 0 6px}}
h3{{font-size:15px;font-weight:500;margin:10px 0 4px}}.muted{{color:#5B6470;margin:0 0 10px}}
table{{border-collapse:collapse;width:100%;margin:6px 0}}th,td{{text-align:left;vertical-align:top;padding:6px 8px;border-bottom:1px solid #D5D9DE}}
th{{font-weight:500;color:#063E61;width:30%}}.grid th{{width:auto;background:#E8EFF7}}
.alert{{border:1px solid #D5D9DE;border-left:5px solid #135AA6;border-radius:8px;padding:8px 12px;margin:8px 0;break-inside:avoid}}
.alert.critical{{border-left-color:#B42318}}.alert.warning{{border-left-color:#8A4B0F}}.alert p{{margin:4px 0}}
figure{{margin:10px 0}}figure img{{max-width:100%;max-height:300px;border-radius:6px}}figcaption{{font-size:12px;color:#5B6470}}
footer{{margin-top:24px;font-size:12px;color:#5B6470}}
@media print{{body{{background:#fff}}.bar{{display:none}}.page{{padding:0;max-width:none}}}}
</style></head><body>
<div class="bar"><button type="button" onclick="print()">Сохранить в PDF или распечатать</button>
<span class="muted">В окне печати выберите «Сохранить как PDF»</span></div>
<main class="page"><h1>Отчёт об осмотре</h1>
<p class="muted">КОНТУР · сформирован {e(data['generated_at'])} · {e(data['generated_by'])}</p>
<h2>Объект</h2><table>{rows}</table>{alerts}
<h2>Журнал</h2><table class="grid"><tr><th>Дата</th><th>Действие</th><th>Узел</th><th>Автор</th><th>Комментарий</th></tr>{journal}</table>
<h2>Узлы и нормативы</h2><table class="grid"><tr><th>Код</th><th>Узел</th><th>Норматив</th><th>Установлен</th><th>Последняя замена</th></tr>{components}</table>
<footer>{e(LIMITS)}</footer></main></body></html>"""
