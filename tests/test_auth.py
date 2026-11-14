"""Sign-in by email and password, roles and authorship of journal entries."""

from fastapi.testclient import TestClient

from app.auth import Accounts
from app.main import create_app

PASSWORD = "inspect-2026"


def app(tmp_path):
    return TestClient(create_app(tmp_path / "app.db", auth=True))


def first_admin(client, email="admin@plant.local"):
    answer = client.post("/api/auth/setup", json={"email": email, "name": "Анна Админ", "password": PASSWORD})
    assert answer.status_code == 201, answer.text
    return answer.json()


def test_nothing_but_sign_in_is_open_without_a_session(tmp_path):
    with app(tmp_path) as client:
        assert client.get("/api/health").status_code == 200
        me = client.get("/api/auth/me").json()
        assert me == {"auth_enabled": True, "setup_required": True, "user": None}
        for path in ("/api/bootstrap", "/api/catalog", "/api/inspections", "/api/library"):
            assert client.get(path).status_code == 401, path


def test_first_account_is_an_administrator_and_only_once(tmp_path):
    with app(tmp_path) as client:
        admin = first_admin(client)
        assert admin["role"] == "admin" and "users" in admin["permissions"]
        assert client.get("/api/bootstrap").status_code == 200
        again = client.post("/api/auth/setup", json={"email": "x@plant.local", "name": "X", "password": PASSWORD})
        assert again.status_code == 409


def test_engineer_cannot_open_service_areas_or_record_maintenance(tmp_path):
    with app(tmp_path) as client:
        first_admin(client)
        created = client.post("/api/users", json={"email": "Ivan@Plant.local ", "name": "Иван Обходчик",
                                                  "role": "engineer", "password": PASSWORD})
        assert created.status_code == 201 and created.json()["email"] == "ivan@plant.local"
        client.post("/api/auth/logout")
        assert client.get("/api/bootstrap").status_code == 401
        assert client.post("/api/auth/login", json={"email": "ivan@plant.local", "password": PASSWORD}).status_code == 200
        for path in ("/api/reference/series", "/api/library", "/api/users"):
            assert client.get(path).status_code == 403, path
        run = client.post("/api/analyze", json={"scenario_id": "normal"}).json()
        body = {"analysis_id": run["id"], "component_id": "seal", "notes": "Капли у вала", "author": "Кто-то другой"}
        assert client.post("/api/inspections", json=body | {"action": "maintenance"}).status_code == 403
        saved = client.post("/api/inspections", json=body | {"action": "defect"})
        assert saved.status_code == 201
        assert saved.json()["author"] == "Иван Обходчик"


def test_wrong_password_is_vague_and_repeated_failures_lock_the_address(tmp_path):
    with app(tmp_path) as client:
        first_admin(client)
        client.post("/api/auth/logout")
        unknown = client.post("/api/auth/login", json={"email": "nobody@plant.local", "password": PASSWORD})
        wrong = client.post("/api/auth/login", json={"email": "admin@plant.local", "password": "wrong-password"})
        assert unknown.status_code == wrong.status_code == 401
        assert unknown.json()["detail"] == wrong.json()["detail"]
        for _ in range(4):
            client.post("/api/auth/login", json={"email": "admin@plant.local", "password": "wrong-password"})
        locked = client.post("/api/auth/login", json={"email": "admin@plant.local", "password": PASSWORD})
        assert locked.status_code == 429


def test_session_cookie_is_http_only_and_ends_on_logout(tmp_path):
    with app(tmp_path) as client:
        answer = client.post("/api/auth/setup", json={"email": "admin@plant.local", "name": "А", "password": PASSWORD})
        cookie = answer.headers["set-cookie"].lower()
        assert "httponly" in cookie and "samesite=strict" in cookie
        client.post("/api/auth/logout")
        assert client.get("/api/auth/me").json()["user"] is None


def test_admin_cannot_lock_themselves_out_and_disabled_users_cannot_sign_in(tmp_path):
    with app(tmp_path) as client:
        admin = first_admin(client)
        assert client.patch(f"/api/users/{admin['id']}", json={"role": "engineer"}).status_code == 422
        assert client.patch(f"/api/users/{admin['id']}", json={"active": False}).status_code == 422
        master = client.post("/api/users", json={"email": "m@plant.local", "name": "Мастер", "role": "master",
                                                 "password": PASSWORD}).json()
        assert client.patch(f"/api/users/{master['id']}", json={"active": False}).json()["active"] is False
        client.post("/api/auth/logout")
        assert client.post("/api/auth/login", json={"email": "m@plant.local", "password": PASSWORD}).status_code == 401


def test_passwords_and_tokens_are_not_stored_in_clear(tmp_path):
    accounts = Accounts(tmp_path / "app.db")
    accounts.create("a@plant.local", "А", "admin", PASSWORD)
    _, token = accounts.login("a@plant.local", PASSWORD)
    raw = (tmp_path / "app.db").read_bytes()
    assert PASSWORD.encode() not in raw and token.encode() not in raw


def test_short_password_and_unknown_role_are_refused(tmp_path):
    with app(tmp_path) as client:
        first_admin(client)
        short = client.post("/api/users", json={"email": "s@plant.local", "name": "С", "role": "engineer",
                                                "password": "short"})
        role = client.post("/api/users", json={"email": "r@plant.local", "name": "Р", "role": "boss",
                                               "password": PASSWORD})
        assert short.status_code == 422 and role.status_code == 422
