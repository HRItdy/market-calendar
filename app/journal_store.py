"""Storage for the trade log: Postgres when DATABASE_URL is set, otherwise a local SQLite file.

Render's free web service loses its disk on every deploy or restart, so a public deployment
needs DATABASE_URL (Neon Postgres, see neon.ts) to keep the log.

On Neon, DATABASE_URL is the pooled (-pooler, PgBouncer) endpoint used for queries, and
DATABASE_URL_UNPOOLED the direct one used to create the table. The pool keeps no idle
connections (min_size=0) so the database can scale to zero while nobody is trading.
"""
from __future__ import annotations

import json
import os
import sqlite3
import threading
from pathlib import Path

DEFAULT_SQLITE = Path(__file__).resolve().parent / "data" / "journal.db"
SCHEMA = "CREATE TABLE IF NOT EXISTS journal_orders (id TEXT PRIMARY KEY, placed_at BIGINT NOT NULL, active INTEGER NOT NULL, data TEXT NOT NULL)"
UPSERT = ("INSERT INTO journal_orders (id, placed_at, active, data) VALUES ({p}, {p}, {p}, {p}) "
          "ON CONFLICT (id) DO UPDATE SET active = EXCLUDED.active, data = EXCLUDED.data")


class Store:
    persistent = False
    kind = "sqlite"
    p = "?"

    def _rows(self, sql: str, args: tuple = ()) -> list[tuple]:
        raise NotImplementedError

    def _write(self, sql: str, rows: list[tuple]) -> None:
        raise NotImplementedError

    def all(self) -> list[dict]:
        return [json.loads(r[0]) for r in self._rows("SELECT data FROM journal_orders ORDER BY placed_at, id")]

    def active(self) -> list[dict]:
        return [json.loads(r[0]) for r in self._rows("SELECT data FROM journal_orders WHERE active = 1 ORDER BY placed_at, id")]

    def get(self, order_id: str) -> dict | None:
        rows = self._rows(f"SELECT data FROM journal_orders WHERE id = {self.p}", (order_id,))
        return json.loads(rows[0][0]) if rows else None

    def save(self, orders: list[dict]) -> None:
        if orders:
            self._write(UPSERT.format(p=self.p), [
                (o["id"], int(o["placedAt"]), int(o["status"] in ("open", "pending")), json.dumps(o)) for o in orders])

    def clear(self) -> None:
        self._write("DELETE FROM journal_orders", [()])


class SqliteStore(Store):
    def __init__(self, path: Path | str, persistent: bool = False):
        self.path = str(path)
        self.persistent = persistent
        self._lock = threading.Lock()
        Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        self._db = sqlite3.connect(self.path, check_same_thread=False)
        self._db.execute(SCHEMA)
        self._db.commit()

    def _rows(self, sql, args=()):
        with self._lock:
            return self._db.execute(sql, args).fetchall()

    def _write(self, sql, rows):
        with self._lock, self._db:
            self._db.executemany(sql, rows)


class PostgresStore(Store):
    kind = "postgres"
    persistent = True
    p = "%s"

    def __init__(self, url: str, direct_url: str | None = None):
        import psycopg  # only needed when DATABASE_URL is set
        from psycopg_pool import ConnectionPool

        # DDL over the direct connection, as Neon recommends for schema changes.
        with psycopg.connect(direct_url or url, autocommit=True, connect_timeout=15) as c:
            c.execute(SCHEMA)
        # prepare_threshold=None: no server-side prepared statements through PgBouncer.
        self._pool = ConnectionPool(url, min_size=0, max_size=4, max_idle=60, timeout=20, open=True,
                                    kwargs={"autocommit": True, "prepare_threshold": None, "connect_timeout": 15})

    def _rows(self, sql, args=()):
        with self._pool.connection() as c:
            return c.execute(sql, args).fetchall()

    def _write(self, sql, rows):
        with self._pool.connection() as c, c.transaction(), c.cursor() as cur:
            cur.executemany(sql, rows)


def open_store() -> Store:
    url = os.environ.get("DATABASE_URL", "").strip()
    if url:
        return PostgresStore(url, os.environ.get("DATABASE_URL_UNPOOLED", "").strip() or None)
    path = os.environ.get("MC_JOURNAL_DB", "").strip()
    # An explicit path is taken to be on a persistent disk; the default one is not on Render.
    return SqliteStore(path or DEFAULT_SQLITE, persistent=bool(path))
