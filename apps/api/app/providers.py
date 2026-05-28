from __future__ import annotations

import json
import re

import httpx
from bs4 import BeautifulSoup

from .models import BillDraft, BillItem
from .parser import categorize, normalize_space


INVOICE_RE = re.compile(r"InvoiceNumber\('([^']+)'\)")
TOKEN_RE = re.compile(r"Token\('([^']+)'\)")
ROOT_PATH_RE = re.compile(r"rootPath\s*=\s*'([^']+)'")
SERBIAN_DATE_RE = re.compile(r"\b(\d{1,2})\.(\d{1,2})\.(20\d{2}|19\d{2})\.\s+(\d{1,2}):(\d{2}):(\d{2})")


async def parse_serbian_taxcore_receipt(client: httpx.AsyncClient, source_url: str, html: str) -> BillDraft | None:
    invoice_number = extract_match(INVOICE_RE, html)
    token = extract_match(TOKEN_RE, html)
    root_path = extract_match(ROOT_PATH_RE, html) or "https://suf.purs.gov.rs"
    if not invoice_number or not token:
        return None

    response = await client.post(
        f"{root_path}/specifications",
        data={"invoiceNumber": invoice_number, "token": token},
        headers={"X-Requested-With": "XMLHttpRequest"},
    )
    response.raise_for_status()
    payload = response.json()
    if not payload.get("success"):
        return None

    text = visible_text(html)
    vendor = extract_labeled_value(text, "Предузеће") or extract_journal_vendor(text) or "Unknown vendor"
    location = build_location(text)
    purchased_at = extract_serbian_date(text)
    items = [
        BillItem(
            description=normalize_space(str(item.get("name") or "Unknown item")),
            quantity=round(float(item.get("quantity") or 1), 3),
            amount=round(float(item.get("total") or 0), 2),
            category=categorize(str(item.get("name") or "")),
            raw_text=json.dumps(item, ensure_ascii=False),
        )
        for item in payload.get("items", [])
    ]
    total = round(sum(item.amount for item in items), 2)

    return BillDraft(
        source_url=source_url,
        vendor=vendor,
        purchased_at=purchased_at,
        location=location,
        currency="RSD",
        total=total,
        items=items,
    )


def extract_match(pattern: re.Pattern[str], value: str) -> str | None:
    match = pattern.search(value)
    return match.group(1) if match else None


def visible_text(html: str) -> str:
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style", "noscript"]):
        tag.decompose()
    lines = [normalize_space(line) for line in soup.get_text("\n").splitlines()]
    return "\n".join(line for line in lines if line)


def extract_labeled_value(text: str, label: str) -> str | None:
    lines = text.splitlines()
    for index, line in enumerate(lines[:-1]):
        if line.strip(":") == label:
            return lines[index + 1]
    return None


def extract_journal_vendor(text: str) -> str | None:
    lines = text.splitlines()
    for index, line in enumerate(lines):
        if line == "============ ФИСКАЛНИ РАЧУН ============" and index + 2 < len(lines):
            return lines[index + 2]
    return None


def build_location(text: str) -> str | None:
    place = extract_labeled_value(text, "Место продаје") or extract_labeled_value(text, "Име продајног места")
    address = extract_labeled_value(text, "Адреса")
    city = extract_labeled_value(text, "Општина") or extract_labeled_value(text, "Град")
    parts = [part for part in (place, address, city) if part]
    return ", ".join(parts) if parts else None


def extract_serbian_date(text: str) -> str | None:
    match = SERBIAN_DATE_RE.search(text)
    if not match:
        return None
    day, month, year, hour, minute, second = match.groups()
    return f"{year}-{month.zfill(2)}-{day.zfill(2)}T{hour.zfill(2)}:{minute}:{second}"
