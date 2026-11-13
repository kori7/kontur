"""Append-only SQLite storage for analysis evidence and inspection events."""

import json
import sqlite3
from contextlib import contextmanager
from hashlib import sha256
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4


class Store:
    def __init__(self, path: str | Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as db:
            db.execute("CREATE TABLE IF NOT EXISTS analyses (id TEXT PRIMARY KEY, created_at TEXT, payload TEXT)")
            db.execute("""CREATE TABLE IF NOT EXISTS events (
                id TEXT PRIMARY KEY, created_at TEXT, analysis_id TEXT REFERENCES analyses(id),
                component_id TEXT, action TEXT, notes TEXT, author TEXT,
                equipment_id TEXT NOT NULL DEFAULT 'pump-101')""")
            db.execute("CREATE TABLE IF NOT EXISTS images (id TEXT PRIMARY KEY, data_url TEXT NOT NULL)")
            columns = {row["name"] for row in db.execute("PRAGMA table_info(events)")}
            if "equipment_id" not in columns:
                # A database written before the catalogue existed can only hold demo-object events.
                db.execute("ALTER TABLE events ADD COLUMN equipment_id TEXT NOT NULL DEFAULT 'pump-101'")

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

    def save_image(self, image: str) -> str:
        image_id = sha256(image.encode()).hexdigest()
        with self._connect() as db:
            db.execute("INSERT OR IGNORE INTO images VALUES (?, ?)", (image_id, image))
        return image_id

    def image(self, image_id: str) -> str:
        with self._connect() as db:
            row = db.execute("SELECT data_url FROM images WHERE id = ?", (image_id,)).fetchone()
        if row is None:
            raise KeyError(image_id)
        return row["data_url"]

    def save_analysis(self, payload: dict) -> dict:
        result = {**payload, "id": str(uuid4()), "created_at": datetime.now(timezone.utc).isoformat()}
        with self._connect() as db:
            db.execute("INSERT INTO analyses VALUES (?, ?, ?)",
                       (result["id"], result["created_at"], json.dumps(result, ensure_ascii=False)))
        return result

    def analysis(self, analysis_id: str) -> dict:
        with self._connect() as db:
            row = db.execute("SELECT payload FROM analyses WHERE id = ?", (analysis_id,)).fetchone()
        if row is None:
            raise KeyError(analysis_id)
        return json.loads(row["payload"])

    def add_event(self, analysis_id: str, equipment_id: str, component_id: str,
                  action: str, notes: str, author: str) -> dict:
        self.analysis(analysis_id)
        event = {"id": str(uuid4()), "created_at": datetime.now(timezone.utc).isoformat(),
                 "analysis_id": analysis_id, "equipment_id": equipment_id, "component_id": component_id,
                 "action": action, "notes": notes, "author": author}
        with self._connect() as db:
            db.execute("""INSERT INTO events (id, created_at, analysis_id, equipment_id, component_id,
                                              action, notes, author)
                          VALUES (:id, :created_at, :analysis_id, :equipment_id, :component_id,
                                  :action, :notes, :author)""", event)
        return event

    def events(self, equipment_id: str | None = None) -> list[dict]:
        """Return history, newest first; ``equipment_id`` keeps one object's history separate."""
        query = """SELECT e.*, a.payload FROM events e JOIN analyses a ON a.id = e.analysis_id"""
        parameters: tuple = ()
        if equipment_id is not None:
            query += " WHERE e.equipment_id = ?"
            parameters = (equipment_id,)
        with self._connect() as db:
            rows = db.execute(query + " ORDER BY e.created_at DESC, e.rowid DESC", parameters).fetchall()
        return [{**{key: row[key] for key in row.keys() if key != "payload"},
                 "analysis": json.loads(row["payload"])} for row in rows]
