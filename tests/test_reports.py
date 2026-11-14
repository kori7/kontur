"""Reports: Excel workbook and printable page from the same inspection and journal."""

from io import BytesIO

from fastapi.testclient import TestClient
from openpyxl import load_workbook

from app.main import create_app


def inspected(client):
    run = client.post("/api/analyze", json={"scenario_id": "r06"}).json()
    client.post("/api/inspections", json={"analysis_id": run["id"], "component_id": "seal", "action": "defect",
                                          "notes": "Капли у вала <b>не HTML</b>"})
    return run


def test_excel_has_the_object_alerts_rules_journal_and_components(tmp_path):
    with TestClient(create_app(tmp_path / "app.db")) as client:
        run = inspected(client)
        answer = client.get("/api/reports/pump-101.xlsx", params={"analysis_id": run["id"]})
    assert answer.status_code == 200
    assert "attachment" in answer.headers["content-disposition"]
    book = load_workbook(BytesIO(answer.content))
    assert book.sheetnames == ["Объект", "Предупреждения", "Правила", "Журнал", "Узлы"]
    alerts = [row for row in book["Предупреждения"].iter_rows(min_row=2, values_only=True)]
    assert any("R06" in (row[1] or "") for row in alerts)
    journal = list(book["Журнал"].iter_rows(min_row=2, values_only=True))
    assert journal[0][1:4] == ("Замечание", "Торцевое уплотнение", "Демо-инженер")


def test_print_page_escapes_text_and_states_the_limits(tmp_path):
    with TestClient(create_app(tmp_path / "app.db")) as client:
        inspected(client)
        page = client.get("/api/reports/pump-101/print").text
    assert "Отчёт об осмотре" in page and "Сохранить как PDF" in page
    assert "&lt;b&gt;не HTML&lt;/b&gt;" in page and "<b>не HTML</b>" not in page
    assert "не подтверждает исправность" in page


def test_report_refuses_another_objects_inspection_and_unknown_objects(tmp_path):
    with TestClient(create_app(tmp_path / "app.db")) as client:
        run = inspected(client)
        assert client.get("/api/reports/pcp-21031004-1.xlsx", params={"analysis_id": run["id"]}).status_code == 422
        assert client.get("/api/reports/nope.xlsx").status_code == 404


def test_engineer_cannot_export_reports(tmp_path):
    with TestClient(create_app(tmp_path / "app.db", auth=True)) as client:
        client.post("/api/auth/setup", json={"email": "a@plant.local", "name": "А", "password": "inspect-2026"})
        client.post("/api/users", json={"email": "e@plant.local", "name": "Е", "role": "engineer",
                                        "password": "inspect-2026"})
        client.post("/api/auth/logout")
        client.post("/api/auth/login", json={"email": "e@plant.local", "password": "inspect-2026"})
        assert client.get("/api/reports/pump-101.xlsx").status_code == 403
