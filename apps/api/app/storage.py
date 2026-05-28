from __future__ import annotations

import os
import sqlite3
from datetime import datetime, timezone

from .models import BillDraft, SavedBill, SpendingSummary


DATABASE_PATH = os.getenv("DATABASE_PATH", "finance_tracker.sqlite3")


def init_db() -> None:
    with connect() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS bills (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                source_url TEXT NOT NULL,
                vendor TEXT NOT NULL,
                purchased_at TEXT,
                location TEXT,
                currency TEXT NOT NULL,
                total REAL NOT NULL,
                created_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                bill_id INTEGER NOT NULL,
                description TEXT NOT NULL,
                quantity REAL NOT NULL DEFAULT 1,
                amount REAL NOT NULL,
                category TEXT NOT NULL,
                raw_text TEXT,
                FOREIGN KEY (bill_id) REFERENCES bills(id) ON DELETE CASCADE
            )
            """
        )
        ensure_column(conn, "items", "quantity", "REAL NOT NULL DEFAULT 1")


def save_bill(draft: BillDraft) -> SavedBill:
    created_at = datetime.now(timezone.utc).isoformat()
    total = round(sum(item.amount for item in draft.items), 2)
    with connect() as conn:
        cursor = conn.execute(
            """
            INSERT INTO bills (source_url, vendor, purchased_at, location, currency, total, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (draft.source_url, draft.vendor, draft.purchased_at, draft.location, draft.currency, total, created_at),
        )
        bill_id = int(cursor.lastrowid)
        conn.executemany(
            """
            INSERT INTO items (bill_id, description, quantity, amount, category, raw_text)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            [(bill_id, item.description, item.quantity, item.amount, item.category, item.raw_text) for item in draft.items],
        )
    saved_payload = draft.model_dump()
    saved_payload["total"] = total
    return SavedBill(**saved_payload, id=bill_id, created_at=created_at)


def list_bills() -> list[SavedBill]:
    with connect() as conn:
        bill_rows = conn.execute("SELECT * FROM bills ORDER BY COALESCE(purchased_at, created_at) DESC").fetchall()
        bills: list[SavedBill] = []
        for row in bill_rows:
            item_rows = conn.execute(
                "SELECT description, quantity, amount, category, raw_text FROM items WHERE bill_id = ?",
                (row["id"],),
            ).fetchall()
            bills.append(
                SavedBill(
                    id=row["id"],
                    source_url=row["source_url"],
                    vendor=row["vendor"],
                    purchased_at=row["purchased_at"],
                    location=row["location"],
                    currency=row["currency"],
                    total=row["total"],
                    created_at=row["created_at"],
                    items=[dict(item) for item in item_rows],
                )
            )
        return bills


def get_summary() -> SpendingSummary:
    with connect() as conn:
        lifetime_total = conn.execute("SELECT ROUND(COALESCE(SUM(total), 0), 2) FROM bills").fetchone()[0]
        currency_row = conn.execute(
            "SELECT MIN(currency) AS min_currency, MAX(currency) AS max_currency FROM bills"
        ).fetchone()
        currency = currency_row["min_currency"] or "USD"
        if currency_row["min_currency"] != currency_row["max_currency"]:
            currency = "MIXED"
        by_category = [
            dict(row)
            for row in conn.execute(
                "SELECT category, ROUND(SUM(amount), 2) AS total FROM items GROUP BY category ORDER BY total DESC"
            )
        ]
        by_month = [
            dict(row)
            for row in conn.execute(
                """
                SELECT COALESCE(substr(purchased_at, 1, 7), substr(created_at, 1, 7)) AS month,
                       ROUND(SUM(total), 2) AS total
                FROM bills
                GROUP BY month
                ORDER BY month DESC
                """
            )
        ]
    return SpendingSummary(lifetime_total=lifetime_total, currency=currency, by_category=by_category, by_month=by_month)


def connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DATABASE_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def ensure_column(conn: sqlite3.Connection, table: str, column: str, definition: str) -> None:
    columns = {row["name"] for row in conn.execute(f"PRAGMA table_info({table})")}
    if column not in columns:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")
