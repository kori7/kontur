"""Accounts by email and password, three roles, sessions in an HttpOnly cookie.

The customer asked for roles and sign-in by email and password (organizer answers §7). Passwords are
stored only as scrypt hashes with a per-user salt; a session is a random token whose SHA-256 is kept
in the database, so a copied database file does not let anyone sign in.

The first account is created from the sign-in screen while the database has no users at all, and it
is always an administrator; after that only an administrator adds people. Everything runs on the
local server, nothing is sent outside.

Roles:
- инженер (engineer) — осмотр, камера, записи «Проверка» и «Замечание», карточки и история;
- мастер (master) — всё инженера, «Обслуживание» и «Замена», ряды измерений, материалы, отчёты;
- администратор (admin) — всё мастера и учётные записи.
"""

import hashlib
import hmac
import secrets
import sqlite3
import threading
import time
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4

ROLES = {"engineer": "Инженер", "master": "Мастер", "admin": "Администратор"}
PERMISSIONS = {
    "engineer": {"inspect", "record"},
    "master": {"inspect", "record", "record_maintenance", "series", "library", "reports"},
    "admin": {"inspect", "record", "record_maintenance", "series", "library", "reports", "users"},
}
SESSION_COOKIE = "kontur_session"
SESSION_HOURS = 12
MIN_PASSWORD = 8
LOCK_AFTER_FAILURES = 5
LOCK_SECONDS = 60
# Used when sign-in is switched off (KONTUR_AUTH=off): tests and the e2e server run without accounts.
DEMO_USER = {"id": "demo", "email": "demo@kontur.local", "name": "Демо-инженер", "role": "admin", "active": True}


class AuthError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


def _hash(password: str, salt: bytes) -> bytes:
    return hashlib.scrypt(password.encode(), salt=salt, n=2 ** 14, r=8, p=1, dklen=32)


def _normal_email(email: str) -> str:
    email = email.strip().lower()
    if "@" not in email or email.startswith("@") or email.endswith("@") or len(email) > 120:
        raise AuthError(422, "Укажите адрес почты")
    return email


def public(user: dict) -> dict:
    return {"id": user["id"], "email": user["email"], "name": user["name"], "role": user["role"],
            "role_name": ROLES[user["role"]], "active": bool(user["active"]),
            "permissions": sorted(PERMISSIONS[user["role"]])}


class Accounts:
    def __init__(self, path: str | Path):
        self.path = Path(path)
        self._failures: dict[str, list[float]] = {}
        self._lock = threading.Lock()
        with self._connect() as db:
            db.execute("""CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL,
                salt BLOB NOT NULL, password_hash BLOB NOT NULL, active INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL)""")
            db.execute("""CREATE TABLE IF NOT EXISTS sessions (
                token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
                expires_at TEXT NOT NULL)""")

    @contextmanager
    def _connect(self):
        db = sqlite3.connect(self.path, timeout=10)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys = ON")
        try:
            with db:
                yield db
        finally:
            db.close()

    def setup_required(self) -> bool:
        with self._connect() as db:
            return db.execute("SELECT COUNT(*) FROM users").fetchone()[0] == 0

    def create(self, email: str, name: str, role: str, password: str, *, first: bool = False) -> dict:
        email, name = _normal_email(email), name.strip()
        if role not in ROLES:
            raise AuthError(422, "Неизвестная роль")
        if not name:
            raise AuthError(422, "Укажите имя")
        if len(password) < MIN_PASSWORD:
            raise AuthError(422, f"Пароль — не короче {MIN_PASSWORD} символов")
        salt = secrets.token_bytes(16)
        user = {"id": str(uuid4()), "email": email, "name": name, "role": role, "active": 1}
        with self._connect() as db:
            if first and db.execute("SELECT COUNT(*) FROM users").fetchone()[0]:
                raise AuthError(409, "Первая учётная запись уже создана. Войдите или обратитесь к администратору")
            try:
                db.execute("INSERT INTO users VALUES (?, ?, ?, ?, ?, ?, 1, ?)",
                           (user["id"], email, name, role, salt, _hash(password, salt),
                            datetime.now(timezone.utc).isoformat()))
            except sqlite3.IntegrityError as exc:
                raise AuthError(409, "Учётная запись с этой почтой уже есть") from exc
        return public(user)

    def users(self) -> list[dict]:
        with self._connect() as db:
            rows = db.execute("SELECT id, email, name, role, active FROM users ORDER BY created_at").fetchall()
        return [public(dict(row)) for row in rows]

    def _user(self, user_id: str) -> dict:
        with self._connect() as db:
            row = db.execute("SELECT id, email, name, role, active FROM users WHERE id = ?", (user_id,)).fetchone()
        if row is None:
            raise AuthError(404, "Учётная запись не найдена")
        return dict(row)

    def update(self, actor: dict, user_id: str, role: str | None = None, active: bool | None = None,
               password: str | None = None) -> dict:
        self._user(user_id)  # 404 for an unknown account before anything changes
        if user_id == actor["id"] and (role not in (None, "admin") or active is False):
            raise AuthError(422, "Нельзя снять с себя роль администратора или отключить свою учётную запись")
        if role is not None and role not in ROLES:
            raise AuthError(422, "Неизвестная роль")
        if password is not None and len(password) < MIN_PASSWORD:
            raise AuthError(422, f"Пароль — не короче {MIN_PASSWORD} символов")
        with self._connect() as db:
            if role is not None:
                db.execute("UPDATE users SET role = ? WHERE id = ?", (role, user_id))
            if active is not None:
                db.execute("UPDATE users SET active = ? WHERE id = ?", (int(active), user_id))
                if not active:
                    db.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
            if password is not None:
                salt = secrets.token_bytes(16)
                db.execute("UPDATE users SET salt = ?, password_hash = ? WHERE id = ?",
                           (salt, _hash(password, salt), user_id))
                db.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
        return public(self._user(user_id))

    def login(self, email: str, password: str) -> tuple[dict, str]:
        email = _normal_email(email)
        now = time.monotonic()
        with self._lock:
            recent = [moment for moment in self._failures.get(email, []) if now - moment < LOCK_SECONDS]
            self._failures[email] = recent
            if len(recent) >= LOCK_AFTER_FAILURES:
                raise AuthError(429, "Слишком много попыток. Подождите минуту")
        with self._connect() as db:
            row = db.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
        # The hash is computed even for an unknown address, so timing does not reveal who has an account.
        salt = row["salt"] if row else b"\0" * 16
        valid = hmac.compare_digest(_hash(password, salt), row["password_hash"] if row else b"\0" * 32)
        if not row or not valid or not row["active"]:
            with self._lock:
                self._failures.setdefault(email, []).append(now)
            raise AuthError(401, "Неверная почта или пароль")
        token = secrets.token_urlsafe(32)
        expires = datetime.now(timezone.utc) + timedelta(hours=SESSION_HOURS)
        with self._connect() as db:
            db.execute("INSERT INTO sessions VALUES (?, ?, ?)",
                       (hashlib.sha256(token.encode()).hexdigest(), row["id"], expires.isoformat()))
        return public(dict(row)), token

    def session_user(self, token: str | None) -> dict | None:
        if not token:
            return None
        with self._connect() as db:
            row = db.execute("""SELECT users.id, email, name, role, active, expires_at FROM sessions
                                JOIN users ON users.id = sessions.user_id WHERE token_hash = ?""",
                             (hashlib.sha256(token.encode()).hexdigest(),)).fetchone()
        if row is None or not row["active"] or datetime.fromisoformat(row["expires_at"]) < datetime.now(timezone.utc):
            return None
        return public(dict(row))

    def logout(self, token: str | None) -> None:
        if token:
            with self._connect() as db:
                db.execute("DELETE FROM sessions WHERE token_hash = ?", (hashlib.sha256(token.encode()).hexdigest(),))
